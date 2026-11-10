'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testSqm1PianoEnvelopeAbProbeV2(context) {
  const {bytes, b, buttons, current, punchy, currentEnvelope, currentLayers,
    velocityRoot, shapedVelocity, bodyDecay, bodySmooth, bodyEnvelope, punchyBodyEmitter,
    transientSmooth, punchyLayers, constants} = context;
  const scene = read(bytes);
  const component = (brick, type) => brick?.comps.find(item => item.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const scalar = value => value && typeof value === 'object' && 'value' in value
    ? value.value : value;
  const one = (items, label) => {
    assert.equal(items.length, 1, label);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge =>
    edge.z === brick.key && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge =>
    edge.a === brick.key && edge.at === type && edge.p === port);

  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  assert.deepEqual(scene.r.externalAssets(), constants.EXTERNAL_ASSETS);
  assert.equal(bricksOf(C.Button.NAME).length, 4, 'Four A/B strike buttons');
  assert.equal(bricksOf(C.TextDisplay.NAME).length, 4, 'Title, instructions and labels');
  assert.equal(bricksOf(C.Stopwatch.NAME).length, 2, 'Independent current/candidate clocks');
  assert.equal(bricksOf(C.Dampen.NAME).length, 4,
    'One current envelope plus three punchy envelopes');
  assert.equal(bricksOf(C.AudioEmitter.NAME).length, 6,
    'Three continuous Sine layers per model');
  assert.equal(bricksOf(C.OneShotAudioEmitter.NAME).length, 0,
    'Audition uses continuous Sine emitters only');
  assert.equal(bricksOf(C.Expr_MathExp.NAME).length, 3,
    'Punchy model has one body and two transient exponential decays');

  const expectedButtons = new Map([
    ['current.soft', 'CURRENT piano - soft strike'],
    ['current.hard', 'CURRENT piano - hard strike'],
    ['punchy.soft', 'TUNED V2 piano - soft strike'],
    ['punchy.hard', 'TUNED V2 piano - hard strike'],
  ]);
  for (const [marker, prompt] of expectedButtons) {
    const brick = one(scene.bricks.filter(candidate =>
      component(candidate, C.Interact.NAME)?.data.Message
        === `${constants.PREFIX}:button.${marker}`), marker);
    const button = component(brick, C.Button.NAME);
    assert.equal(button.data.PromptCustomLabel, prompt);
    assert.equal(button.data.bHiddenInteraction, false);
    assert.equal(outgoing(brick, C.Button.NAME, 'bHeld')
      .filter(edge => edge.zt === C.Expr_EdgeDetectorExec.NAME
        && edge.q === 'Input').length, 1, `${marker} edge detector`);
  }

  for (const clockBrick of bricksOf(C.Stopwatch.NAME)) {
    const clock = component(clockBrick, C.Stopwatch.NAME);
    assert.equal(clock.data.bRunning, false, 'Probe clocks are saved stopped');
    assert.equal(clock.data.Time, 0);
    assert.equal(clock.data.Limit, constants.PROBE_LIMIT);
    assert.equal(incoming(clockBrick, C.Stopwatch.NAME, 'Restart').length, 1,
      'Each clock has one unioned Restart input');
    assert.equal(outgoing(clockBrick, C.Stopwatch.NAME, 'Expired')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Exec').length, 1,
    'Clock expiration clears its audible latch');
  }

  const emitters = bricksOf(C.AudioEmitter.NAME);
  const pitches = [];
  for (const brick of emitters) {
    const emitter = component(brick, C.AudioEmitter.NAME);
    assert.equal(emitter.data.bEnabled, false);
    assert.equal(scalar(emitter.data.VolumeMultiplier), 0);
    assert.equal(emitter.data.AudioDescriptor, 1);
    assert.equal(emitter.data.bSpatialization, false);
    assert.equal(emitter.data.InnerRadius, 180);
    assert.equal(emitter.data.MaxDistance, 1400);
    assert.equal(incoming(brick, C.AudioEmitter.NAME, 'bEnabled').length, 1);
    assert.equal(incoming(brick, C.AudioEmitter.NAME, 'VolumeMultiplier').length, 1);
    assert.equal(incoming(brick, C.AudioEmitter.NAME, 'PitchMultiplier').length, 0);
    pitches.push(scalar(emitter.data.PitchMultiplier));
  }
  const expectedPitches = [1, 1, 2, 2, 3, 3];
  pitches.sort((a, z) => a - z).forEach((pitch, index) =>
    assert(Math.abs(pitch - expectedPitches[index]) < 1e-6,
      `Emitter pitch ${index}: ${pitch}`));

  assert.equal(currentEnvelope.data.SmoothTime, 0.028,
    'Current model preserves the production piano smoothing');
  assert.deepEqual(currentLayers.map(layer => [layer.ratio, layer.gain]),
    [[1, 1], [2, 0.18], [3, 0.06]], 'Current fixed harmonic profile');
  assert.equal(scalar(bodyDecay.data.Input), undefined,
    'Body Exp input is dynamically wired');
  assert.equal(scalar(bodyEnvelope.data.Target), undefined,
    'Punchy body target is dynamically wired');
  assert.deepEqual([
    scalar(bodySmooth[0].data.InputA), scalar(bodySmooth[0].data.InputB),
  ], [0.07, 0.006], 'Tuned body release/attack smoothing');
  assert.deepEqual([
    scalar(transientSmooth[0].data.InputA), scalar(transientSmooth[0].data.InputB),
  ], [0.05, 0.006], 'Tuned transient release/attack smoothing');
  assert.equal(velocityRoot.data.Exponent, 0.5, 'Soft velocity square-root branch');
  assert.equal(scalar(shapedVelocity.data.InputB), 0.5, 'Velocity blend average');
  assert.deepEqual(punchyLayers.map(layer =>
    [layer.ratio, layer.floor, layer.gain, layer.rate]),
  [[2, 0.05, 0.18, -6], [3, 0.015, 0.05, -8]],
  'Clean exact-harmonic transient partials with sustain floors');
  assert.equal(scalar(punchyBodyEmitter.data.PitchMultiplier), 1);
  const candidatePeak = velocity => {
    const shaped = 0.5 * (velocity + Math.sqrt(velocity));
    const brightness = 0.35 + 0.65 * shaped;
    return constants.MASTER_GAIN * (shaped + shaped * brightness * 0.295);
  };
  const currentPeak = velocity => constants.MASTER_GAIN * velocity * 1.24;
  const softPeak = candidatePeak(constants.SOFT_VELOCITY);
  const hardPeak = candidatePeak(constants.HARD_VELOCITY);
  assert(softPeak > currentPeak(constants.SOFT_VELOCITY) * 1.3,
    'Tuned soft strike is materially louder than current');
  assert(Math.abs(hardPeak / currentPeak(constants.HARD_VELOCITY) - 1) < 0.1,
    'Tuned hard strike stays close to the successful V1/current impact level');
  assert(hardPeak < 0.5, `Safe tuned hard-strike peak: ${hardPeak}`);

  for (const model of [current, punchy]) {
    assert.equal(model.clock.data.Limit, constants.PROBE_LIMIT);
    assert.equal(model.clock.data.bRunning, false);
    assert.equal(model.beforeRelease[0].data.InputB.value, constants.NOTE_SECONDS);
    assert.equal(model.restart.type, C.Exec_Union.NAME);
  }
  assert.equal(buttons.currentSoft.type, C.Button.NAME);
  assert.equal(buttons.punchyHard.type, C.Button.NAME);

  assert.equal(scene.edges.length, b.edges.length, 'All builder wires serialize');
  const brickByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const wire of scene.edges) {
    assert(brickByKey.get(wire.a)?.comps.some(item => item.type === wire.at),
      `Missing source endpoint ${wire.a}:${wire.at}`);
    assert(brickByKey.get(wire.z)?.comps.some(item => item.type === wire.zt),
      `Missing target endpoint ${wire.z}:${wire.zt}`);
    const target = `${wire.z}|${wire.zt}|${wire.q}`;
    assert(!targets.has(target), `Duplicate input wire ${target}`);
    targets.add(target);
  }

  console.log('SQM1 piano envelope A/B probe V2 checks passed: four marked strike buttons, '
    + 'exact current profile, soft-velocity compensation, clean integer harmonic transients, '
    + 'sustain floors, six safe continuous Sine emitters, strict placement and valid wiring.');
  return {scene, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-envelope-ab-probe-v2.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(second.bytes, first.bytes, 'A/B probe build must be deterministic');
}
