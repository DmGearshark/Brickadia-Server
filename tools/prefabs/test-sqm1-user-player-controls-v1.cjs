'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {C} = require('./loadboard-lib.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value?.value;

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function marker(scene, message) {
  return one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === message), message);
}

function uiSignature(scene) {
  return scene.bricks.filter(brick => brick.g === 1).map(brick => ({
    data: brick.data,
    comps: brick.comps,
  })).sort((a, z) => JSON.stringify(a).localeCompare(JSON.stringify(z)));
}

function stepGraph(scene, label) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const button = one(scene.bricks.filter(brick =>
    component(brick, C.Button.NAME)?.data.PromptCustomLabel === label), `button ${label}`);
  const detectorEdge = one(scene.edges.filter(edge => edge.a === button.key
    && edge.at === C.Button.NAME && edge.p === 'bHeld'
    && edge.zt === C.Expr_EdgeDetectorExec.NAME && edge.q === 'Input'), `${label} detector`);
  const detector = byKey.get(detectorEdge.z);
  const setterEdge = one(scene.edges.filter(edge => edge.a === detector.key
    && edge.at === C.Expr_EdgeDetectorExec.NAME && edge.p === 'OnRisingEdge'
    && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Exec'), `${label} setter`);
  const setter = byKey.get(setterEdge.z);
  const clampEdge = one(scene.edges.filter(edge => edge.z === setter.key
    && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'
    && edge.at === C.Expr_MathClamp.NAME && edge.p === 'Output'), `${label} setter value`);
  const clamp = byKey.get(clampEdge.a);
  const calculationEdge = one(scene.edges.filter(edge => edge.z === clamp.key
    && edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'), `${label} clamp source`);
  const calculation = byKey.get(calculationEdge.a);
  const stateEdge = one(scene.edges.filter(edge => edge.z === calculation.key
    && edge.q === 'InputA' && edge.at === C.Var.NAME && edge.p === 'Value'), `${label} retained state`);
  return {button, detector, setter, clamp, calculation, state: byKey.get(stateEdge.a)};
}

function assertStep(scene, spec) {
  const graph = stepGraph(scene, spec.label);
  const calculation = component(graph.calculation, C[spec.kind].NAME);
  assert(calculation, `${spec.label} uses ${spec.kind}`);
  assert.equal(scalar(calculation.data.InputB), 0.1, `${spec.label} step`);
  const clamp = component(graph.clamp, C.Expr_MathClamp.NAME).data;
  assert.equal(scalar(clamp.Min), spec.min, `${spec.label} minimum`);
  assert.equal(scalar(clamp.Max), 2, `${spec.label} maximum`);
  const retained = scalar(component(graph.state, C.Var.NAME).data.Value);
  assert(retained >= spec.min && retained <= 2, `${spec.label} retained state in range`);
  return graph;
}

function assertOuterClamp(scene, label, markerText, minimum) {
  const input = one(scene.bricks.filter(brick =>
    component(brick, C.MicrochipInput.NAME)?.data.PortLabel === label), label);
  const clamp = marker(scene, markerText);
  const data = component(clamp, C.Expr_MathClamp.NAME).data;
  assert.equal(scalar(data.Min), minimum);
  assert.equal(scalar(data.Max), 2);
  assert(scene.edges.some(edge => edge.a === input.key && edge.at === C.MicrochipInput.NAME
    && edge.p === 'RER_Output' && edge.z === clamp.key
    && edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'));
  const outgoing = scene.edges.filter(edge => edge.a === clamp.key
    && edge.at === C.Expr_MathClamp.NAME && edge.p === 'Output'
    && edge.zt === C.Expr_Select.NAME && edge.q === 'InputB');
  assert.equal(outgoing.length, 1, `${label} clamp feeds one selector`);
}

function retainedOutput(scene, label) {
  const rootChip = one(scene.bricks.filter(brick => brick.g === 1
    && component(brick, C.Microchip.NAME)), 'root microchip');
  const outerGrid = one(scene.links.filter(link => link.key === rootChip.key),
    'root microchip link').grid;
  const output = one(scene.bricks.filter(brick =>
    brick.g === outerGrid
      && component(brick, C.MicrochipOutput.NAME)?.data.PortLabel === label
      && scene.edges.some(edge => edge.z === brick.key
        && edge.zt === C.MicrochipOutput.NAME && edge.q === 'RER_Input')),
  `wired output ${label}`);
  const wire = one(scene.edges.filter(edge => edge.z === output.key
    && edge.zt === C.MicrochipOutput.NAME && edge.q === 'RER_Input'),
  `${label} source`);
  const source = scene.bricks.find(brick => brick.key === wire.a);
  return component(source, wire.at).data;
}

module.exports = function testSqm1UserPlayerControlsV1(context) {
  const source = read(context.sourceBytes);
  const output = context.outputScene;
  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.equal(context.optimization.before.bricks, source.bricks.length,
    'five dead input gates were repurposed before optimization without adding bricks');
  assert.equal(context.optimization.before.edges, source.edges.length + 164,
    'two clamp hops and 162 shared-emitter wires precede optimization');
  assert.equal(output.bricks.length, context.optimization.after.bricks);
  assert.equal(output.edges.length, context.optimization.after.edges);
  assert.deepEqual(uiSignature(output), uiSignature(source),
    'user button order, text sizes and all root UI geometry stay exact');

  const pitchDown = assertStep(output,
    {label: 'Pitch Down', kind: 'Expr_MathSubtract', min: 0.25});
  const pitchUp = assertStep(output,
    {label: 'Pitch Up', kind: 'Expr_MathAdd', min: 0.25});
  assert.equal(scalar(component(pitchDown.state, C.Var.NAME).data.Value), 1,
    'new additive pitch control starts at 1.0');
  assert.equal(scalar(component(pitchUp.state, C.Var.NAME).data.Value), 1,
    'both pitch buttons share the normalized 1.0 state');
  assertStep(output, {label: 'Playback speed down', kind: 'Expr_MathSubtract', min: 0.1});
  assertStep(output, {label: 'Playback speed Up', kind: 'Expr_MathAdd', min: 0.1});
  assertStep(output, {label: 'Volume down', kind: 'Expr_MathSubtract', min: 1});
  assertStep(output, {label: 'Volume Up', kind: 'Expr_MathAdd', min: 1});

  assertOuterClamp(output, 'Pitch (0=buttons)', 'SQM1CFG:Pitch Clamp', 0.25);
  assertOuterClamp(output, 'Speed (0=buttons)', 'SQM1CFG:Speed Clamp', 0.1);
  const volumeInput = one(output.bricks.filter(brick =>
    component(brick, C.MicrochipInput.NAME)?.data.PortLabel === 'Volume (0=buttons)'),
  'outer volume input');
  const volumeClampEdge = one(output.edges.filter(edge => edge.a === volumeInput.key
    && edge.at === C.MicrochipInput.NAME && edge.p === 'RER_Output'
    && edge.zt === C.Expr_MathClamp.NAME && edge.q === 'Input'), 'outer volume clamp');
  const volumeClamp = output.bricks.find(brick => brick.key === volumeClampEdge.z);
  assert.equal(scalar(component(volumeClamp, C.Expr_MathClamp.NAME).data.Min), 1);
  assert.equal(scalar(component(volumeClamp, C.Expr_MathClamp.NAME).data.Max), 2);

  const emitterControls = [
    ['SQM1CFG:Inner Radius', 400, 'InnerRadius'],
    ['SQM1CFG:Max Distance', 4000, 'MaxDistance'],
    ['SQM1CFG:Directional', false, 'bSpatialization'],
  ];
  const emitters = output.bricks.filter(brick => component(brick, C.AudioEmitter.NAME));
  assert.equal(emitters.length, 54);
  for (const [message, value, port] of emitterControls) {
    const variable = marker(output, message);
    assert.equal(scalar(component(variable, C.Var.NAME).data.Value), value, `${message} default`);
    const fanout = output.edges.filter(edge => edge.a === variable.key
      && edge.at === C.Var.NAME && edge.p === 'Value'
      && edge.zt === C.AudioEmitter.NAME && edge.q === port);
    assert.equal(fanout.length, 54, `${message} shared fanout`);
    assert.equal(new Set(fanout.map(edge => edge.z)).size, 54, `${message} reaches every emitter once`);
  }

  const arrays = scene => scene.bricks.filter(brick => component(brick, C.ArrayVar.NAME))
    .map(brick => component(brick, C.ArrayVar.NAME).data.Value)
    .sort((a, z) => (a.$array?.length ?? 0) - (z.$array?.length ?? 0));
  assert.deepEqual(arrays(output), arrays(source), 'both complete retained score arrays');
  assert.deepEqual(retainedOutput(output, 'Loaded'), retainedOutput(source, 'Loaded'),
    'Loaded retained state');
  assert.deepEqual(retainedOutput(output, 'Song Title'), retainedOutput(source, 'Song Title'),
    'retained song title');

  const keys = new Set(output.bricks.map(brick => brick.key));
  const targets = new Set();
  for (const edge of output.edges) {
    assert(keys.has(edge.a), `wire source ${edge.a}`);
    assert(keys.has(edge.z), `wire target ${edge.z}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `duplicate target ${target}`);
    targets.add(target);
  }

  const rebuilt = require('./patch-sqm1-user-player-controls-v1.cjs')(context.sourceFile);
  assert.equal(crypto.createHash('sha256').update(rebuilt.bytes).digest('hex'),
    crypto.createHash('sha256').update(context.bytes).digest('hex'), 'deterministic rebuild');

  console.log('SQM1 custom-UI V3 checks passed: exact UI preservation, 0.1 control steps, requested '
    + 'ranges, clamped exposed overrides, three shared 54-emitter Vars, retained full score/state, '
    + 'conservative graph optimization, deterministic output and strict placement.');
};

if (require.main === module) {
  const context = require('./patch-sqm1-user-player-controls-v1.cjs')();
  module.exports(context);
}
