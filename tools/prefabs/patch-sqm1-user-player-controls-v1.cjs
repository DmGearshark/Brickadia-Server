'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {C, N} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const optimizePlayer = require('./optimize-sqm1-player-v2.cjs');

const SOURCE_DEFAULT = path.join(__dirname, 'sources', 'sqm1-working-as-intended-ui.brz');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-auto-zone-music-player-ui-optimized-v3.brz');

const CONTROL_SPECS = Object.freeze([
  Object.freeze({label: 'Pitch Down', old: 'Expr_MathDivide', next: 'Expr_MathSubtract',
    step: 0.1, min: 0.25, max: 2, initial: 1}),
  Object.freeze({label: 'Pitch Up', old: 'Expr_MathMultiply', next: 'Expr_MathAdd',
    step: 0.1, min: 0.25, max: 2, initial: 1}),
  Object.freeze({label: 'Playback speed down', old: 'Expr_MathSubtract', next: 'Expr_MathSubtract',
    step: 0.1, min: 0.1, max: 2}),
  Object.freeze({label: 'Playback speed Up', old: 'Expr_MathAdd', next: 'Expr_MathAdd',
    step: 0.1, min: 0.1, max: 2}),
  Object.freeze({label: 'Volume down', old: 'Expr_MathSubtract', next: 'Expr_MathSubtract',
    step: 0.1, min: 1, max: 2}),
  Object.freeze({label: 'Volume Up', old: 'Expr_MathAdd', next: 'Expr_MathAdd',
    step: 0.1, min: 1, max: 2}),
]);

const INPUT_SPECS = Object.freeze([
  Object.freeze({outer: 'Pitch (0=buttons)', legacy: 'Pitch (0=1)', min: 0.25, max: 2,
    marker: 'SQM1CFG:Pitch Clamp'}),
  Object.freeze({outer: 'Speed (0=buttons)', legacy: 'Speed (0=1)', min: 0.1, max: 2,
    marker: 'SQM1CFG:Speed Clamp'}),
]);

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function inferVoiceCount(scene) {
  const indices = scene.bricks.flatMap(brick => brick.comps
    .filter(item => item.type === C.Interact.NAME)
    .map(item => /^MWSP5:voice(\d+)\.cursor$/.exec(item.data.Message ?? '')))
    .filter(Boolean).map(match => Number(match[1])).sort((a, b) => a - b);
  assert(indices.length >= 1 && indices.length <= 32,
    `Player voice count must be within the 32-record header capacity; got ${indices.length}`);
  assert.deepEqual(indices, Array.from({length: indices.length}, (_, index) => index),
    'Player voice markers are contiguous');
  return indices.length;
}

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function scalar(value) {
  assert(value && value.$variant === 'f64' && Number.isFinite(value.value));
  return value.value;
}

function changeGate(scene, brick, oldKey, newKey, data) {
  const oldDefinition = C[oldKey];
  const newDefinition = C[newKey];
  assert(oldDefinition && newDefinition, `Known gate types ${oldKey}/${newKey}`);
  const gate = one(brick.comps.filter(candidate => candidate.type === oldDefinition.NAME),
    `${oldKey} component on ${brick.key}`);
  assert.equal(brick.comps.length, 1, `${oldKey} brick has only its gate component`);
  gate.type = newDefinition.NAME;
  gate.data = data;
  brick.data.asset = newDefinition.BRICK;
  for (const edge of scene.edges) {
    if (edge.a === brick.key && edge.at === oldDefinition.NAME) edge.at = newDefinition.NAME;
    if (edge.z === brick.key && edge.zt === oldDefinition.NAME) edge.zt = newDefinition.NAME;
  }
}

function findStep(scene, byKey, spec) {
  const button = one(scene.bricks.filter(brick =>
    component(brick, C.Button.NAME)?.data.PromptCustomLabel === spec.label),
  `button ${spec.label}`);
  const detectorEdge = one(scene.edges.filter(edge => edge.a === button.key
    && edge.at === C.Button.NAME && edge.p === 'bHeld'
    && edge.zt === C.Expr_EdgeDetectorExec.NAME && edge.q === 'Input'),
  `${spec.label} edge detector`);
  const detector = byKey.get(detectorEdge.z);
  const setterEdge = one(scene.edges.filter(edge => edge.a === detector.key
    && edge.at === C.Expr_EdgeDetectorExec.NAME && edge.p === 'OnRisingEdge'
    && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Exec'),
  `${spec.label} setter execution`);
  const setter = byKey.get(setterEdge.z);
  const valueEdge = one(scene.edges.filter(edge => edge.z === setter.key
    && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'
    && edge.at === C.Expr_MathClamp.NAME && edge.p === 'Output'),
  `${spec.label} clamped setter value`);
  const clamp = byKey.get(valueEdge.a);
  const inputEdge = one(scene.edges.filter(edge => edge.z === clamp.key
    && edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'),
  `${spec.label} clamp input`);
  const calculation = byKey.get(inputEdge.a);
  assert.equal(inputEdge.at, C[spec.old].NAME, `${spec.label} original calculation type`);
  const stateEdge = one(scene.edges.filter(edge => edge.z === calculation.key
    && edge.zt === C[spec.old].NAME && edge.q === 'InputA'
    && edge.at === C.Var.NAME && edge.p === 'Value'),
  `${spec.label} retained state`);
  const state = byKey.get(stateEdge.a);
  return {button, detector, setter, clamp, calculation, state};
}

function patchStep(scene, byKey, spec) {
  const match = findStep(scene, byKey, spec);
  const calculation = component(match.calculation, C[spec.old].NAME);
  assert.equal(typeof scalar(calculation.data.InputB), 'number');
  const state = component(match.state, C.Var.NAME);
  const retained = spec.initial ?? Math.max(spec.min, Math.min(spec.max, scalar(state.data.Value)));
  changeGate(scene, match.calculation, spec.old, spec.next, {
    InputA: N(retained), InputB: N(spec.step),
  });
  const clamp = component(match.clamp, C.Expr_MathClamp.NAME);
  clamp.data.Min = N(spec.min);
  clamp.data.Max = N(spec.max);
  clamp.data.Input = N(retained);
  state.data.Value = N(retained);
  component(match.setter, C.Exec_Var_Set.NAME).data.Value = N(retained);
  match.retained = retained;
  return match;
}

function outerInput(scene, label) {
  return one(scene.bricks.filter(brick =>
    component(brick, C.MicrochipInput.NAME)?.data.PortLabel === label),
  `outer input ${label}`);
}

function patchExternalClamp(scene, byKey, spec) {
  const input = outerInput(scene, spec.outer);
  const selectorEdge = one(scene.edges.filter(edge => edge.a === input.key
    && edge.at === C.MicrochipInput.NAME && edge.p === 'RER_Output'
    && edge.zt === C.Expr_Select.NAME && edge.q === 'InputB'),
  `${spec.outer} direct selector edge`);
  const selector = byKey.get(selectorEdge.z);
  const legacy = one(scene.bricks.filter(brick =>
    component(brick, C.MicrochipInput.NAME)?.data.PortLabel === spec.legacy),
  `unused legacy input ${spec.legacy}`);
  assert.equal(scene.edges.filter(edge => edge.a === legacy.key || edge.z === legacy.key).length, 0,
    `${spec.legacy} is unused before conversion`);
  changeGate(scene, legacy, 'MicrochipInput', 'Expr_MathClamp', {
    Input: N(0), Min: N(spec.min), Max: N(spec.max),
  });
  legacy.comps.push({type: C.Interact.NAME, data: {
    Message: spec.marker, bHiddenInteraction: true,
  }});
  scene.edges = scene.edges.filter(edge => edge !== selectorEdge);
  scene.edges.push({
    a: input.key, at: C.MicrochipInput.NAME, p: 'RER_Output',
    z: legacy.key, zt: C.Expr_MathClamp.NAME, q: 'Input',
  }, {
    a: legacy.key, at: C.Expr_MathClamp.NAME, p: 'Output',
    z: selector.key, zt: C.Expr_Select.NAME, q: 'InputB',
  });
  return {input, clamp: legacy, selector};
}

function patchVolumeInput(scene, byKey) {
  const input = outerInput(scene, 'Volume (0=buttons)');
  const inputEdge = one(scene.edges.filter(edge => edge.a === input.key
    && edge.at === C.MicrochipInput.NAME && edge.p === 'RER_Output'
    && edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'),
  'existing exposed volume clamp');
  const clamp = byKey.get(inputEdge.z);
  const data = component(clamp, C.Expr_MathClamp.NAME).data;
  data.Min = N(1);
  data.Max = N(2);
  data.Input = N(0);
  clamp.comps.push({type: C.Interact.NAME, data: {
    Message: 'SQM1CFG:Volume Clamp', bHiddenInteraction: true,
  }});
  const selectorEdge = one(scene.edges.filter(edge => edge.a === clamp.key
    && edge.at === C.Expr_MathClamp.NAME && edge.p === 'Output'
    && edge.zt === C.Expr_Select.NAME && edge.q === 'InputB'),
  'volume clamp to override selector');
  return {input, clamp, selector: byKey.get(selectorEdge.z)};
}

function repurposeUnusedInput(scene, label, marker, value) {
  const brick = one(scene.bricks.filter(candidate =>
    component(candidate, C.MicrochipInput.NAME)?.data.PortLabel === label
      && scene.edges.every(edge => edge.a !== candidate.key && edge.z !== candidate.key)),
  `unused internal input ${label}`);
  assert.equal(scene.edges.filter(edge => edge.a === brick.key || edge.z === brick.key).length, 0,
    `${label} has no live wiring before repurposing`);
  changeGate(scene, brick, 'MicrochipInput', 'Var', {Value: value});
  brick.comps.push({type: C.Interact.NAME, data: {
    Message: marker, bHiddenInteraction: true,
  }});
  return brick;
}

function addSharedEmitterControls(scene, voiceCount) {
  const innerRadius = repurposeUnusedInput(scene, 'Play (Pulse)',
    'SQM1CFG:Inner Radius', N(400));
  const maxDistance = repurposeUnusedInput(scene, 'Stop (Pulse)',
    'SQM1CFG:Max Distance', N(4000));
  const directional = repurposeUnusedInput(scene, 'Volume (0=.08)',
    'SQM1CFG:Directional', {$variant: 'Bool', value: false});
  const emitters = scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME));
  assert.equal(emitters.length, voiceCount * 3,
    `V2 has three Sine emitters for each of ${voiceCount} voices`);
  const controls = [
    {brick: innerRadius, port: 'InnerRadius', value: 400},
    {brick: maxDistance, port: 'MaxDistance', value: 4000},
    {brick: directional, port: 'bSpatialization', value: false},
  ];
  for (const control of controls) for (const emitter of emitters) {
    assert.equal(scene.edges.filter(edge => edge.z === emitter.key
      && edge.zt === C.AudioEmitter.NAME && edge.q === control.port).length, 0,
    `${emitter.key}.${control.port} was not already driven`);
    component(emitter, C.AudioEmitter.NAME).data[control.port] = control.value;
    scene.edges.push({
      a: control.brick.key, at: C.Var.NAME, p: 'Value',
      z: emitter.key, zt: C.AudioEmitter.NAME, q: control.port,
    });
  }
  return {innerRadius, maxDistance, directional, emitters};
}

function build(sourceFile = SOURCE_DEFAULT, options = {}) {
  const sourceIsBuffer = Buffer.isBuffer(sourceFile);
  if (!sourceIsBuffer) assert(fs.existsSync(sourceFile), `Player source not found: ${sourceFile}`);
  const sourceBytes = sourceIsBuffer ? Buffer.from(sourceFile) : fs.readFileSync(sourceFile);
  const sourceLabel = sourceIsBuffer ? (options.sourceName ?? '<buffer>') : sourceFile;
  const scene = read(sourceBytes);
  const voiceCount = inferVoiceCount(scene);
  if (options.maxVoices !== undefined) {
    assert.equal(options.maxVoices, voiceCount,
      `Requested ${options.maxVoices} voices but source contains ${voiceCount}`);
  }
  const originalUi = structuredClone(scene.bricks.filter(brick => brick.g === 1));
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const steps = CONTROL_SPECS.map(spec => patchStep(scene, byKey, spec));
  const external = INPUT_SPECS.map(spec => patchExternalClamp(scene, byKey, spec));
  const volumeInput = patchVolumeInput(scene, byKey);
  const sharedEmitterControls = addSharedEmitterControls(scene, voiceCount);
  const extensionPreparation = options.beforeOptimize?.(scene, {
    sourceBytes, sourceFile: sourceLabel, originalUi, byKey, steps, external, volumeInput,
    sharedEmitterControls, voiceCount,
  });
  const optimization = optimizePlayer(scene);
  const baselineResult = options.afterOptimize ? write(scene, {
    name: 'SQM1 Auto-Zone Music Player - Custom UI Optimized V3',
    description: 'User-adjusted V2 frame with its swapped instrument buttons and resized text preserved. '
      + 'Pitch steps by 0.1 in 0.25..2, speed steps by 0.1 in 0.1..2 and volume steps by 0.1 in 1..2. '
      + 'Positive outer numeric inputs use the same clamps; zero keeps the retained buttons active. '
      + 'Three editable shared Vars drive every emitter radius, distance and directional setting. '
      + 'Idle clock updates and diagnostic-only note bookkeeping are removed without changing transport.',
  }) : null;
  const extension = options.afterOptimize?.(scene, extensionPreparation, {
    sourceBytes, sourceFile: sourceLabel, originalUi, byKey, steps, external, volumeInput,
    sharedEmitterControls, optimization, voiceCount,
  });
  const result = write(scene, {
    name: options.name ?? 'SQM1 Auto-Zone Music Player - Custom UI Optimized V3',
    description: options.description ?? ('User-adjusted V2 frame with its swapped instrument buttons and resized text preserved. '
      + 'Pitch steps by 0.1 in 0.25..2, speed steps by 0.1 in 0.1..2 and volume steps by 0.1 in 1..2. '
      + 'Positive outer numeric inputs use the same clamps; zero keeps the retained buttons active. '
      + 'Three editable shared Vars drive every emitter radius, distance and directional setting. '
      + 'Idle clock updates and diagnostic-only note bookkeeping are removed without changing transport.'),
  });
  return {
    bytes: result.bytes,
    sourceBytes,
    sourceFile: sourceLabel,
    scene,
    outputScene: read(result.bytes),
    originalUi,
    steps,
    external,
    volumeInput,
    sharedEmitterControls,
    voiceCount,
    optimization,
    extensionPreparation,
    extension,
    baselineBytes: baselineResult?.bytes ?? null,
    baselineScene: baselineResult ? read(baselineResult.bytes) : null,
    constants: {SOURCE_DEFAULT, OUTPUT_DEFAULT, CONTROL_SPECS, INPUT_SPECS},
  };
}

module.exports = build;
module.exports.inferVoiceCount = inferVoiceCount;

if (require.main === module) {
  const [sourceFile = SOURCE_DEFAULT, outputFile = OUTPUT_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(sourceFile);
    require('./test-sqm1-user-player-controls-v1.cjs')(context);
    require('./test-sqm1-user-player-optimized-v1.cjs')(context.sourceBytes, context.bytes);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      sourceFile,
      outputFile,
      bytes: context.bytes.length,
      bricks: context.outputScene.bricks.length,
      wires: context.outputScene.edges.length,
      optimization: context.optimization,
      pitch: {step: 0.1, min: 0.25, max: 2},
      speed: {step: 0.1, min: 0.1, max: 2},
      volume: {step: 0.1, min: 1, max: 2},
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
