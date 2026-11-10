'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

module.exports = function testSqm1AudioConcurrencyProbeV1(context) {
  assert(context?.bytes && context?.build && context?.constants, 'probe build context');
  const {build, constants} = context;
  const {MODES, LOW_GAIN, PULSE_SECONDS, REALISTIC_GAINS, NOTE_MIDI,
    EXTERNAL_ASSETS, PREFIX} = constants;
  const scene = read(context.bytes);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks, confirmed: placement.confirmedPairs,
    uncertain: placement.uncertainPairs, warnings: placement.warnings},
  {invalid: [], confirmed: [], uncertain: [], warnings: []});

  assert.deepEqual(scene.r.externalAssets(), EXTERNAL_ASSETS);
  assert.equal(scene.bricks.length, 606);
  assert.equal(scene.edges.length, 1106);
  assert.equal(scene.links.length, 1, 'one collapsed logic microchip');
  assert.equal(bricksOf(C.Microchip.NAME).length, 1);
  assert.equal(bricksOf(C.Button.NAME).length, 10);
  assert.equal(bricksOf(C.TextDisplay.NAME).length, 3);
  assert.equal(bricksOf(C.AudioEmitter.NAME).length, 54);
  assert.equal(bricksOf(C.Var.NAME).length, 1);
  assert.equal(bricksOf(C.Expr_CompareEqual.NAME).length, 10);
  assert.equal(bricksOf(C.Expr_LogicalOR.NAME).length, 333);
  assert.equal(bricksOf(C.Expr_LogicalAND.NAME).length, 1);
  assert.equal(bricksOf(C.Expr_Select.NAME).length, 171);
  assert.equal(bricksOf(C.Expr_EdgeDetectorExec.NAME).length, 10);
  assert.equal(bricksOf(C.Exec_Var_Set.NAME).length, 10);
  assert.equal(bricksOf(C.Clock.NAME).length, 1);
  assert.equal(bricksOf(C.Exec_Toggle.NAME).length, 1);
  for (const forbidden of [C.ArrayVar.NAME, C.FunctionCall.NAME, C.Dampen.NAME,
    C.Stopwatch.NAME, C.OneShotAudioEmitter.NAME]) {
    assert.equal(bricksOf(forbidden).length, 0, `forbidden ${forbidden}`);
  }

  const targets = new Set();
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  for (const edge of scene.edges) {
    assert(byKey.get(edge.a)?.comps.some(item => item.type === edge.at),
      `source ${edge.a}:${edge.at}`);
    assert(byKey.get(edge.z)?.comps.some(item => item.type === edge.zt),
      `target ${edge.z}:${edge.zt}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `input ${edge.zt}.${edge.q}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `duplicate ${target}`);
    targets.add(target);
  }

  const buildTargets = new Set();
  for (const edge of build.edges) {
    const target = `${edge.z.id}:${edge.q}`;
    assert(!buildTargets.has(target), `duplicate live target ${target}`);
    buildTargets.add(target);
  }
  const edge = (source, sourcePort, target, targetPort, label) => one(build.edges.filter(candidate =>
    candidate.a === source && candidate.p === sourcePort
      && candidate.z === target && candidate.q === targetPort), label);
  const input = (target, port, label) => one(build.edges.filter(candidate =>
    candidate.z === target && candidate.q === port), label);

  assert.equal(context.buttons.length, MODES.length);
  assert.equal(context.controls.length, MODES.length);
  assert.equal(context.modeChecks.length, MODES.length);
  for (let index = 0; index < MODES.length; index++) {
    const specification = MODES[index];
    const control = context.controls[index];
    assert.equal(control.mode, specification);
    assert.equal(control.button.data.PromptCustomLabel, specification.label);
    edge(control.button, 'bHeld', control.edge, 'Input', `${specification.label} edge input`);
    edge(control.edge, 'OnRisingEdge', control.setter, 'Exec', `${specification.label} setter`);
    edge(context.mode, 'VarRef', control.setter, 'VarRef', `${specification.label} mode state`);
    assert.equal(scalar(control.setter.data.Value), specification.id,
      `${specification.label} setter value`);
    edge(context.mode, 'Value', context.modeChecks[index], 'InputA',
      `${specification.label} comparison state`);
    assert.equal(scalar(context.modeChecks[index].data.InputB), specification.id,
      `${specification.label} comparison constant`);
  }

  input(context.status, 'Text', 'dynamic status display');
  assert.equal(context.pulseClock.data.IntervalSeconds, PULSE_SECONDS);
  edge(context.modeChecks[9], 'bOutput', context.pulseClock, 'bEnabled', 'pulse-only Clock');
  edge(context.pulseClock, 'Pulse', context.pulseToggle, 'Exec', 'Clock toggles pulse state');
  const pulseAnd = context.pulsedEnabled[0];
  assert.equal(pulseAnd.type, C.Expr_LogicalAND.NAME);
  edge(context.modeChecks[9], 'bOutput', pulseAnd, 'bInputA', 'pulse mode guard');
  edge(context.pulseToggle, 'Output', pulseAnd, 'bInputB', 'pulse toggle guard');

  assert.equal(context.emitters.length, 54);
  assert.equal(NOTE_MIDI.length, 18);
  for (const specification of MODES) {
    const enabled = context.emitters.filter(emitter =>
      emitter.enabledModes.includes(specification.id)).length;
    assert.equal(enabled, specification.sources,
      `${specification.label} commands exact source count`);
  }

  const sine = {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'};
  for (const record of context.emitters) {
    assert.equal(record.sourceIndex, record.note * 3 + record.layer);
    assert.equal(record.midi, NOTE_MIDI[record.note]);
    assert.equal(record.ratio, record.layer + 1);
    const fundamental = 2 ** ((record.midi - 69) / 12);
    const expectedPitch = Math.max(0.1, Math.min(4, fundamental * record.ratio));
    assert(Math.abs(record.pitch - expectedPitch) < 1e-12);
    const emitterData = record.emitter.data;
    assert.deepEqual(EXTERNAL_ASSETS[emitterData.AudioDescriptor], sine);
    assert.equal(emitterData.bSpatialization, false);
    assert.equal(emitterData.InnerRadius, 400);
    assert.equal(emitterData.MaxDistance, 4000);
    assert.equal(scalar(emitterData.PitchMultiplier), expectedPitch);
    edge(record.enabled[0], record.enabled[1], record.emitter, 'bEnabled',
      `emitter ${record.sourceIndex} enable`);
    edge(record.finalVolume, 'Output', record.emitter, 'VolumeMultiplier',
      `emitter ${record.sourceIndex} volume`);

    assert.equal(scalar(record.lowVolume.data.InputA), 0);
    assert.equal(scalar(record.lowVolume.data.InputB), LOW_GAIN);
    edge(context.lowVolumeMode[0], context.lowVolumeMode[1], record.lowVolume, 'bSelectB',
      `emitter ${record.sourceIndex} low selector`);
    edge(record.lowVolume, 'Output', record.realisticVolume, 'InputA',
      `emitter ${record.sourceIndex} low-to-realistic`);
    assert(Math.abs(scalar(record.realisticVolume.data.InputB)
      - REALISTIC_GAINS[record.layer]) < 1e-12);
    edge(context.modeChecks[7], 'bOutput', record.realisticVolume, 'bSelectB',
      `emitter ${record.sourceIndex} realistic selector`);
    edge(record.realisticVolume, 'Output', record.finalVolume, 'InputA',
      `emitter ${record.sourceIndex} realistic-to-quarter`);
    assert(Math.abs(scalar(record.finalVolume.data.InputB)
      - REALISTIC_GAINS[record.layer] * 0.25) < 1e-12);
    edge(context.modeChecks[8], 'bOutput', record.finalVolume, 'bSelectB',
      `emitter ${record.sourceIndex} quarter selector`);

    const expectedModes = MODES.filter(specification =>
      (specification.kind === 'low' && record.sourceIndex < specification.sources)
        || ['realistic', 'quarter', 'pulse'].includes(specification.kind))
      .map(specification => specification.id);
    assert.deepEqual(record.enabledModes, expectedModes,
      `emitter ${record.sourceIndex} mode membership`);
  }

  const packagedButtons = bricksOf(C.Button.NAME).map(brick => ({
    label: component(brick, C.Button.NAME).data.PromptCustomLabel,
    marker: component(brick, C.Interact.NAME)?.data.Message,
  })).sort((a, z) => a.label.localeCompare(z.label));
  const expectedButtons = MODES.map(specification => ({
    label: specification.label,
    marker: `${PREFIX}:button.mode_${specification.id}`,
  })).sort((a, z) => a.label.localeCompare(z.label));
  assert.deepEqual(packagedButtons, expectedButtons);

  const rebuilt = require('./build-sqm1-audio-concurrency-probe-v1.cjs')();
  assert.equal(crypto.createHash('sha256').update(rebuilt.bytes).digest('hex'),
    crypto.createHash('sha256').update(context.bytes).digest('hex'), 'deterministic build');

  console.log('SQM1 audio concurrency probe V1 checks passed: one 54-emitter pool, exact '
    + '18/30/33/36/48/54 static source modes, realistic/quarter/pulsed comparisons, no '
    + 'MIDI scheduler or envelopes, strict placement, valid unique wiring and deterministic output.');
};

if (require.main === module) {
  const context = require('./build-sqm1-audio-concurrency-probe-v1.cjs')();
  module.exports(context);
}
