'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV7 = require('./build-sqm1-piano-player-v7.cjs');
const testV7 = require('./test-sqm1-piano-player-v7.cjs');
const buildHisThemeV3 = require('./build-sqm1-his-theme-cartridge-v3.cjs');
const testHisThemeV3 = require('./test-sqm1-his-theme-cartridge-v3.cjs');
const scoreContract = require('./build-sqm1-song-cartridge-v1.cjs');

const HASHES = Object.freeze({
  v4: '05ed069ca44dc54545298347ddbf37ab6b278dbccffd7198ae26df35d0450111',
  v5: 'a657bb76e9c1d31c15c5e9d87f546fdb97fca7d91a491b346a6ef8f283f1da0f',
  v6: '43ea07f07eb11da2b6ccd536004c1b7d947a02fa6e9467a48eb31cacd024f4ae',
  v7: 'be33eadd99bdeb5916ed184bd4acf1c36425a718da6b0c0f43f4112090d44e0d',
  v8: '32165a0309098baac7bc5de0cfaec729e890f0d275e775f8fa7f327c9b0a339b',
  hisThemeV3: 'adccc10096f1668476359d8bd02b27d94833f18bd136d7fee16ed1005531a08b',
});
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const bricksOf = (scene, type) => scene.bricks.filter(brick => component(brick, type));
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function edgeId(edge) {
  return JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
    z: edge.z, zt: edge.zt, q: edge.q});
}

module.exports = function testSqm1PianoPlayerV8(context) {
  assert(context?.bytes && context?.scene && context?.outputScene && context?.assembly
    && context?.pianoPatch && context?.releasePatch && context?.decayPatch
    && context?.singleSourcePatch && context?.denseProfilePatch, 'V8 builder context');

  // One default V7 build contains the exact V4-V7 ancestry. Recursively run
  // the production suite and independently pin every default artifact hash.
  const v7 = buildV7();
  testV7(v7);
  const defaults = {
    v7,
    v6: v7.v6Context,
    v5: v7.v6Context.v5Context,
    v4: v7.v6Context.v5Context.v4Context,
  };
  for (const version of ['v4', 'v5', 'v6', 'v7']) {
    assert.equal(sha256(defaults[version].bytes), HASHES[version],
      `exact default ${version.toUpperCase()} build`);
  }
  assert.equal(sha256(context.bytes), HASHES.v8, 'exact V8 production build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V8 production artifact exists');
  const artifactBytes = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifactBytes), HASHES.v8, 'exact V8 production artifact');
  assert.deepEqual(artifactBytes, Buffer.from(context.bytes),
    'V8 artifact equals a fresh build');

  const scene = context.scene;
  const serialized = context.outputScene;
  const assembly = context.assembly;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const resolve = (reference, label = 'brick') => {
    const key = typeof reference === 'string' ? reference : reference?.key;
    assert.equal(typeof key, 'string', `${label} key`);
    const brick = byKey.get(key);
    assert(brick, `${label} ${key}`);
    return brick;
  };
  const incoming = (target, type, port) => scene.edges.filter(edge =>
    edge.z === resolve(target).key && edge.zt === type && edge.q === port);
  const outgoing = (source, type, port) => scene.edges.filter(edge =>
    edge.a === resolve(source).key && edge.at === type && edge.p === port);
  const input = (target, type, port, label) => one(incoming(target, type, port), label);
  const wire = (source, sourceType, sourcePort, target, targetType, targetPort, label) =>
    one(scene.edges.filter(edge => edge.a === resolve(source).key && edge.at === sourceType
      && edge.p === sourcePort && edge.z === resolve(target).key
      && edge.zt === targetType && edge.q === targetPort), label);
  const constant = (target, type, port, expected, label) => {
    assert.equal(incoming(target, type, port).length, 0, `${label} is constant`);
    assert.equal(scalar(component(resolve(target), type).data[port]), expected, label);
  };
  const marked = label => {
    const donor = one(assembly.scene.bricks.filter(brick =>
      component(brick, C.Interact.NAME)?.data.Message === `MWSP5:${label}`),
    `assembly marker ${label}`);
    return resolve(donor.key, `retained ${label}`);
  };

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  // The outer presentation is the literal donor UI; expanding the backend did
  // not redraw, resize, recolor, reorder, or replace any visible root brick.
  const visible = value => value.bricks.filter(brick => brick.g === 1);
  assert.deepEqual(visible(scene), visible(assembly.shell), 'exact visible UI transplant');
  assert.deepEqual(context.originalUi, visible(assembly.shell), 'control patch preserved donor UI');
  assert.deepEqual(scene.r.externalAssets(), assembly.shell.r.externalAssets(),
    'preserved shell assets');
  assert.deepEqual(scene.r.prefabJson(), assembly.shell.r.prefabJson(),
    'preserved shell prefab metadata');

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized), emitters: bricksOf(serialized, C.AudioEmitter.NAME).length,
    dampens: bricksOf(serialized, C.Dampen.NAME).length,
    calls: bricksOf(serialized, C.FunctionCall.NAME).length},
  {bricks: 7709, edges: 12920, components: 7717, emitters: 72, dampens: 72, calls: 24},
  'exact 24-lane production graph budget');
  assert.equal(bricksOf(serialized, C.OneShotAudioEmitter.NAME).length, 0);
  assert.equal(bricksOf(serialized, C.Stopwatch.NAME).length, 1);

  const laneOrder = Array.from({length: 24}, (_, index) => index);
  for (const patch of [context.pianoPatch, context.releasePatch, context.decayPatch,
    context.singleSourcePatch, context.denseProfilePatch]) {
    assert.deepEqual(patch.voices.map(voice => voice.voice), laneOrder,
      'contiguous lanes 0..23 in every Piano patch');
  }
  assert.deepEqual(assembly.generatedContext.player.context.voiceBuilds
    .map(voice => voice.voiceIndex), laneOrder, 'contiguous scheduler lanes 0..23');
  assert.equal(assembly.generatedContext.player.context.constants.MAX_VOICES, 24);
  assert.equal(context.optimization.voiceCount, 24);

  const emitterKeys = new Set(bricksOf(scene, C.AudioEmitter.NAME).map(brick => brick.key));
  const dampenKeys = new Set(bricksOf(scene, C.Dampen.NAME).map(brick => brick.key));
  const bodyEmitters = new Set();
  const partialEmitters = new Set();
  const envelopeKeys = new Set();
  for (const voice of context.singleSourcePatch.voices) {
    bodyEmitters.add(voice.body.emitter.key);
    envelopeKeys.add(voice.body.envelope.key);
    for (const harmonic of voice.harmonics) {
      partialEmitters.add(harmonic.emitter.key);
      envelopeKeys.add(harmonic.envelope.key);
    }
  }
  assert.equal(bodyEmitters.size, 24, 'one body source per lane');
  assert.equal(partialEmitters.size, 48, 'two physical partial sources per lane');
  assert.deepEqual(new Set([...bodyEmitters, ...partialEmitters]), emitterKeys,
    'all 72 physical emitters classified');
  assert.deepEqual(envelopeKeys, dampenKeys, 'all 72 physical Dampens classified');

  // V7's profile Select keeps both partial emitters false for Piano, while the
  // body retains V5's guarded release/post-roll window. The V8 gate affects H3
  // only for non-Piano scores wider than the legacy 18-lane budget.
  const dense = context.denseProfilePatch;
  assert.equal(dense.addedBricks, 25);
  assert.equal(dense.removedEdges.length, 24);
  assert.deepEqual(dense.constants, {LEGACY_LAYER_LIMIT: 18, VOICES: 24});
  const p8Bricks = scene.bricks.filter(brick => brick.key.startsWith('sqm1p8:'));
  assert.equal(p8Bricks.length, 25);
  assert.equal(p8Bricks.filter(brick => component(brick,
    C.Expr_CompareLessOrEqual.NAME)).length, 1);
  assert.equal(p8Bricks.filter(brick => component(brick, C.Expr_LogicalAND.NAME)).length, 24);
  wire(dense.activeGlobalSplit, C.Expr_SplitQuaternion.NAME, 'Z', dense.legacyLayerSong,
    C.Expr_CompareLessOrEqual.NAME, 'InputA', 'active score width policy input');
  constant(dense.legacyLayerSong, C.Expr_CompareLessOrEqual.NAME, 'InputB', 18,
    'legacy three-layer score limit');

  for (const policyVoice of dense.voices) {
    const voice = context.singleSourcePatch.voices[policyVoice.voice];
    const pianoVoice = context.decayPatch.voices[policyVoice.voice];
    const releaseVoice = context.releasePatch.voices[policyVoice.voice];
    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2),
      `voice ${voice.voice} H2`);
    const h3 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 3),
      `voice ${voice.voice} H3`);
    assert.equal(voice.partialEnable.key, h2.active.key, `voice ${voice.voice} reused Select`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', voice.partialEnable,
      C.Expr_Select.NAME, 'bSelectB', `voice ${voice.voice} Piano partial selector`);
    wire(releaseVoice.enableSelect, C.Expr_Select.NAME, 'Output', voice.partialEnable,
      C.Expr_Select.NAME, 'InputA', `voice ${voice.voice} non-Piano enable fallback`);
    constant(voice.partialEnable, C.Expr_Select.NAME, 'InputB', false,
      `voice ${voice.voice} Piano partial false branch`);
    wire(releaseVoice.enableSelect, C.Expr_Select.NAME, 'Output', voice.body.emitter,
      C.AudioEmitter.NAME, 'bEnabled', `voice ${voice.voice} V5 guarded body window`);
    wire(voice.partialEnable, C.Expr_Select.NAME, 'Output', h2.emitter,
      C.AudioEmitter.NAME, 'bEnabled', `voice ${voice.voice} H2 profile enable`);
    assert.equal(policyVoice.h3DensePolicy.key,
      dense.voices[voice.voice].h3DensePolicy.key);
    wire(voice.partialEnable, C.Expr_Select.NAME, 'Output', policyVoice.h3DensePolicy,
      C.Expr_LogicalAND.NAME, 'bInputA', `voice ${voice.voice} H3 profile enable`);
    wire(dense.legacyLayerSong, C.Expr_CompareLessOrEqual.NAME, 'bOutput',
      policyVoice.h3DensePolicy, C.Expr_LogicalAND.NAME, 'bInputB',
      `voice ${voice.voice} H3 score-width budget`);
    wire(policyVoice.h3DensePolicy, C.Expr_LogicalAND.NAME, 'bOutput', h3.emitter,
      C.AudioEmitter.NAME, 'bEnabled', `voice ${voice.voice} budgeted H3 enable`);
  }
  const enabledSources = (profile, scoreVoices) => profile === 'Piano'
    ? scoreVoices : scoreVoices * (scoreVoices <= 18 ? 3 : 2);
  assert.deepEqual([
    enabledSources('Piano', 24), enabledSources('NonPiano', 1),
    enabledSources('NonPiano', 18), enabledSources('NonPiano', 19),
    enabledSources('NonPiano', 24),
  ], [24, 3, 54, 38, 48], 'exact structural source ceilings');
  assert.equal(Math.max(...Array.from({length: 24}, (_, index) =>
    enabledSources('Piano', index + 1))), 24, 'Piano maximum is 24 enabled bodies');
  assert.equal(Math.max(...Array.from({length: 6}, (_, index) =>
    enabledSources('NonPiano', index + 19))), 48, 'dense non-Piano maximum is 48');

  // Request and header contracts advertise 24 lanes, accept exactly 1..24,
  // and force the eight unused format-1 voice slots 24..31 to sentinels.
  const request = one(bricksOf(scene, C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
    component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Request'),
  'one V8 SQM1 request');
  const requestData = component(request, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(requestData.DataIn5), 24, 'V8 request capacity');
  assert.equal(scalar(requestData.DataIn6), 65536, 'V8 score array capacity');
  assert.equal(scalar(requestData.DataIn7), 1, 'SQM1 format 1 request');

  const splitFor = label => {
    const variable = marked(label);
    assert(component(variable, C.Var.NAME), `${label} retained Var`);
    const edge = one(outgoing(variable, C.Var.NAME, 'Value').filter(candidate =>
      candidate.zt === C.Expr_SplitQuaternion.NAME && candidate.q === 'Input'),
    `${label} SplitQuaternion`);
    return resolve(edge.z, `${label} split`);
  };
  for (const label of ['header.q0', 'active.header.q0']) {
    const split = splitFor(label);
    const values = [];
    for (const edge of outgoing(split, C.Expr_SplitQuaternion.NAME, 'Z')
      .filter(candidate => candidate.zt === C.Expr_CompareEqual.NAME)) {
      const compare = resolve(edge.z);
      const other = edge.q === 'InputA' ? 'InputB' : 'InputA';
      if (incoming(compare, C.Expr_CompareEqual.NAME, other).length === 0) {
        values.push(scalar(component(compare, C.Expr_CompareEqual.NAME).data[other]));
      }
    }
    assert.deepEqual([...new Set(values)].sort((a, z) => a - z), laneOrder.map(x => x + 1),
      `${label} accepts exactly voice counts 1..24`);
    assert.equal(values.length, 48, `${label} complete validation and final-lane checks`);
  }
  for (const [prefix, lengthLabel] of [
    ['header', 'staging.length'], ['active.header', 'active.length'],
  ]) {
    const length = marked(lengthLabel);
    for (let voice = 24; voice < 32; voice++) {
      const split = splitFor(`${prefix}.q${voice + 2}`);
      for (const [port, expected] of [['Y', 0], ['Z', -1], ['W', -1]]) {
        const edge = one(outgoing(split, C.Expr_SplitQuaternion.NAME, port).filter(candidate =>
          candidate.zt === C.Expr_CompareEqual.NAME),
        `${prefix} inactive voice ${voice} ${port}`);
        const compare = resolve(edge.z);
        const other = edge.q === 'InputA' ? 'InputB' : 'InputA';
        constant(compare, C.Expr_CompareEqual.NAME, other, expected,
          `${prefix} voice ${voice} ${port} sentinel`);
      }
      const xEdge = one(outgoing(split, C.Expr_SplitQuaternion.NAME, 'X').filter(candidate =>
        candidate.zt === C.Expr_CompareEqual.NAME), `${prefix} inactive voice ${voice} offset`);
      const xCompare = resolve(xEdge.z);
      const other = xEdge.q === 'InputA' ? 'InputB' : 'InputA';
      wire(length, C.Var.NAME, 'Value', xCompare, C.Expr_CompareEqual.NAME, other,
        `${prefix} inactive voice ${voice} offset equals score length`);
    }
  }
  assert.equal(context.releasePatch.voices.length, 24);
  assert.equal(context.releasePatch.addedBricks, 437);
  assert.equal(context.decayPatch.addedBricks, 72);
  assert.equal(context.decayPatch.removedBricks, 48);
  assert.equal(context.singleSourcePatch.addedBricks, 216);
  assert.equal(context.singleSourcePatch.removedEdges.length, 144);

  // Real cartridges exercise the same complete format-1 contract. Legacy
  // scores remain valid at 24 lanes; V3 passes V8 and is rejected by 18 lanes.
  const maxArrayEntries = scalar(requestData.DataIn6);
  const legacyDocuments = [
    JSON.parse(fs.readFileSync(path.join(__dirname,
      'viva-la-vida-single-quat-score.json'), 'utf8')),
    require('./build-sqm1-megalovania-cartridge-v1.cjs').loadScore().document,
    require('./build-sqm1-his-theme-cartridge-v1.cjs').loadScore().document,
    require('./build-sqm1-his-theme-cartridge-v2.cjs').loadScore().document,
  ];
  assert.deepEqual(legacyDocuments.map(document => scoreContract.validateScoreDocument(document, {
    maxActiveVoices: 24, maxArrayEntries,
  }).statistics.activeVoices), [18, 16, 18, 18], 'existing song cartridges remain compatible');

  const hisThemeV3 = buildHisThemeV3();
  testHisThemeV3(hisThemeV3);
  assert.equal(sha256(hisThemeV3.bytes), HASHES.hisThemeV3, 'exact His Theme V3 cartridge');
  const acceptedV3 = scoreContract.validateScoreDocument(hisThemeV3.score.document, {
    maxActiveVoices: 24, maxArrayEntries,
  });
  assert.equal(acceptedV3.statistics.activeVoices, 24);
  assert.equal(acceptedV3.values.length, 1970);
  assert.throws(() => scoreContract.validateScoreDocument(hisThemeV3.score.document, {
    maxActiveVoices: 18, maxArrayEntries,
  }), /active voice count must be 1\.\.18/, 'old 18-lane validator rejects His Theme V3');
  const oldRequest = one(bricksOf(v7.scene, C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
    component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Request'),
  'one V7 SQM1 request');
  assert.equal(scalar(component(oldRequest, C.Exec_SendCustomEventGlobal.NAME).data.DataIn5), 18,
    'old V7 advertises only 18 lanes');
  assert(scalar(requestData.DataIn5) >= hisThemeV3.score.values[0].Z
    && scalar(requestData.DataIn6) >= hisThemeV3.score.values.length,
  'V8 request accepts His Theme V3 lane and array requirements');
  assert(scalar(component(oldRequest, C.Exec_SendCustomEventGlobal.NAME).data.DataIn5)
    < hisThemeV3.score.values[0].Z, 'V7 request rejects the V3 lane requirement');

  // User controls, shared speaker controls and optimizer behavior retain their
  // production values while scaling lane-specific bookkeeping to 24.
  assert.equal(context.steps.length, 6);
  for (let index = 0; index < context.steps.length; index++) {
    const step = context.steps[index];
    const spec = context.constants.CONTROL_SPECS[index];
    const calculation = component(step.calculation, C[spec.next].NAME);
    assert(calculation, `${spec.label} operation`);
    assert.equal(scalar(calculation.data.InputA), 1, `${spec.label} retained value`);
    assert.equal(scalar(calculation.data.InputB), 0.1, `${spec.label} step`);
    const clamp = component(step.clamp, C.Expr_MathClamp.NAME);
    assert.equal(scalar(clamp.data.Min), spec.min, `${spec.label} minimum`);
    assert.equal(scalar(clamp.data.Max), spec.max, `${spec.label} maximum`);
    assert.equal(scalar(component(step.state, C.Var.NAME).data.Value), 1,
      `${spec.label} initial state`);
  }
  assert.equal(context.external.length, 2);
  for (let index = 0; index < context.external.length; index++) {
    const control = context.external[index];
    const spec = context.constants.INPUT_SPECS[index];
    const clamp = component(control.clamp, C.Expr_MathClamp.NAME);
    assert.equal(scalar(clamp.data.Min), spec.min);
    assert.equal(scalar(clamp.data.Max), spec.max);
    wire(control.input, C.MicrochipInput.NAME, 'RER_Output', control.clamp,
      C.Expr_MathClamp.NAME, 'Input', `${spec.outer} clamp`);
    wire(control.clamp, C.Expr_MathClamp.NAME, 'Output', control.selector,
      C.Expr_Select.NAME, 'InputB', `${spec.outer} override selector`);
  }
  assert.equal(scalar(component(context.volumeInput.clamp,
    C.Expr_MathClamp.NAME).data.Min), 1);
  assert.equal(scalar(component(context.volumeInput.clamp,
    C.Expr_MathClamp.NAME).data.Max), 2);
  assert.equal(context.sharedEmitterControls.emitters.length, 72);
  for (const [brick, port, value] of [
    [context.sharedEmitterControls.innerRadius, 'InnerRadius', 400],
    [context.sharedEmitterControls.maxDistance, 'MaxDistance', 4000],
    [context.sharedEmitterControls.directional, 'bSpatialization', false],
  ]) {
    assert.equal(scalar(component(brick, C.Var.NAME).data.Value), value, `${port} shared value`);
    for (const emitter of context.sharedEmitterControls.emitters) {
      wire(brick, C.Var.NAME, 'Value', emitter, C.AudioEmitter.NAME, port,
        `${port} shared emitter control`);
    }
  }
  assert.deepEqual(context.optimization.before,
    {bricks: 6462, edges: 10557, components: 7173});
  assert.deepEqual(context.optimization.after,
    {bricks: 6071, edges: 10057, components: 6079});
  assert.deepEqual(context.optimization.removed, {
    bricks: 391, edges: 500, components: 1094, orphanPure: 4,
    diagnosticVars: 146, oobBranches: 24, enableEdges: 24, deadInnerPorts: 2,
    hiddenMarkers: 703, markersStrippedFromRetainedBricks: 557,
  });

  // V5's exact-zero release and 50 ms silent guard, plus the idle-paused
  // scheduler, remain on all 24 lanes.
  const release = context.releasePatch;
  assert.equal(release.constants.MINIMUM_RELEASE_TAIL, 0.001);
  constant(release.safeReleaseTail, C.Expr_Select.NAME, 'InputA', 0.001,
    'release zero-tail divisor fallback');
  constant(release.bodyReleaseSmooth, C.Expr_MathDivide.NAME, 'InputA', 0.07,
    'body release smoothing');
  constant(release.harmonicReleaseSmooth, C.Expr_MathDivide.NAME, 'InputA', 0.05,
    'partial release smoothing');
  constant(release.guardMusical, C.Expr_MathMultiply.NAME, 'InputB', 0.05,
    '50 ms silent post-roll');
  const running = resolve(context.optimization.runningKey, 'running Var');
  const runningEdge = resolve(context.optimization.runningEdgeKey, 'running edge detector');
  const stopwatch = resolve(context.optimization.stopwatchKey, 'playback Stopwatch');
  wire(running, C.Var.NAME, 'Value', runningEdge, C.Expr_EdgeDetectorExec.NAME, 'Input',
    'running state drives scheduler edge');
  wire(runningEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', stopwatch,
    C.Stopwatch.NAME, 'Resume', 'play resumes clock');
  wire(runningEdge, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge', stopwatch,
    C.Stopwatch.NAME, 'Pause', 'idle pauses clock');
  assert.equal(context.optimization.clockControl,
    'running edge -> Stopwatch Resume/Pause');

  const serializedByKey = new Map(serialized.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of serialized.edges) {
    const source = serializedByKey.get(edge.a);
    const target = serializedByKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at), `valid source ${edge.a}`);
    assert(target?.comps.some(item => item.type === edge.zt), `valid target ${edge.z}`);
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `duplicate target ${targetId}`);
    targets.add(targetId);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
  }

  console.log('SQM1 piano player V8 checks passed: exact preserved UI, pinned V4-V8 builds, '
    + '24 contiguous scheduler/Piano lanes, 72 physical sources and envelopes, protected 24-source '
    + 'Piano, exact legacy three-layer and dense two-layer non-Piano policy, complete format-1 '
    + 'header/request compatibility, His Theme V3 acceptance, controls/release/scheduler retention, '
    + 'strict placement and deterministic valid wiring.');
  return {scene, placement, v7, hisThemeV3};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v8.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.equal(sha256(second.bytes), sha256(first.bytes),
    'V8 full-player build is byte-for-byte deterministic');
}
