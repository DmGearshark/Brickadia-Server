'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV102 = require('./build-sqm1-piano-player-v10-2.cjs');
const testV102 = require('./test-sqm1-piano-player-v10-2.cjs');

const V10_2_HASH = '2008a674854490a923d4f6d4a861fdbc283ccc8d0129e177ed444276d850b97a';
const V10_3_HASH = 'c7f1aeefd0e89901bd60788773528284f2c972fc499f95024712b9345dc95e68';
const VOICES = 24;
const HIT_MIN = 0.1;
const HIT_MAX = 1;
const HARDNESS_SCALE = 1 / 0.9;
const BODY_STRIKE_GAIN = 0.50;
const H2_STRIKE_GAIN = 0.40;
const H2_FROM_BODY_STRIKE = 0.8;
const STRIKE_RATE = -18;
const H2_ENABLE_THRESHOLD = 0.001;
const H2_RESIDUAL_THRESHOLD = 0.0001;
const H2_RATIO = 2;
const ATTACK_SECONDS = 0.006;
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.65;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const DENOMINATOR_FLOOR = RMS_NUMERATOR / MAX_HEADROOM;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
const sourceId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p});

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

module.exports = function testSqm1PianoPlayerV103(context) {
  assert(context?.bytes && context?.scene && context?.outputScene && context?.v10_2Bytes
    && context?.velocityImpactPatch && context?.compactHeadroomPatch
    && context?.singleSourcePatch && context?.pianoPatch && context?.inactivePartialPatch,
  'V10.3 builder context');

  const baseline = buildV102();
  testV102(baseline);
  assert.equal(sha256(baseline.bytes), V10_2_HASH, 'exact approved V10.2 baseline');
  assert.deepEqual(Buffer.from(context.v10_2Bytes), Buffer.from(baseline.bytes),
    'V10.3 starts from the exact serialized V10.2 player');
  assert.equal(sha256(context.bytes), V10_3_HASH, 'exact deterministic V10.3 build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V10.3 artifact exists');
  const artifact = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifact), V10_3_HASH, 'exact V10.3 artifact hash');
  assert.deepEqual(artifact, Buffer.from(context.bytes), 'artifact equals fresh V10.3 build');

  const scene = context.scene;
  const serialized = context.outputScene;
  const patch = context.velocityImpactPatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const baselineIncoming = (brick, type, port) => baseline.scene.edges.filter(edge =>
    edge.z === brick.key && (!type || edge.zt === type) && (!port || edge.q === port));

  assert.deepEqual(patch.constants, {
    VOICES,
    HIT_MIN,
    HIT_MAX,
    HARDNESS_SCALE,
    BODY_STRIKE_GAIN,
    H2_STRIKE_GAIN,
    H2_FROM_BODY_STRIKE,
    STRIKE_RATE,
    H2_ENABLE_THRESHOLD,
    H2_RESIDUAL_THRESHOLD,
    H2_RATIO,
    ATTACK_SMOOTH_SECONDS: ATTACK_SECONDS,
    MAX_HEADROOM,
    RMS_CEILING,
    RMS_NUMERATOR,
    DENOMINATOR_FLOOR,
    MAX_PIANO_SOURCES: VOICES * 2,
    ADDED_GATES_PER_VOICE: 9,
    ADDED_LIMITER_GATES: 16,
  }, 'exact velocity-impact contract');
  assert.equal(patch.voices.length, VOICES, 'all 24 Piano voices patched');
  assert.deepEqual(patch.voices.map(voice => voice.voice),
    Array.from({length: VOICES}, (_, voice) => voice), 'contiguous patched voices');
  assert.equal(patch.addedBricks, 232, '216 per-voice gates plus 16 limiter gates');
  assert.equal(patch.addedEdges.length, 545, 'exact declared added wiring');
  assert.equal(patch.removedEdges.length, 121, 'exact declared replaced wiring');
  assert.equal(patch.changedGates.length, VOICES * 2,
    'one Clamp and one Subtract conversion per voice');
  assert.equal(new Set(patch.changedGates.map(change => change.brick.key)).size, VOICES * 2,
    'all changed velocity gates are distinct');
  assert.equal(scene.bricks.filter(brick => brick.key.startsWith('sqm1p103:')).length, 232,
    'all and only declared V10.3 gates were added');

  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    baseline.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V10.2');
  assert.deepEqual(serialized.r.externalAssets(), baseline.outputScene.r.externalAssets(),
    'external assets are exact V10.2');
  assert.deepEqual(serialized.r.prefabJson(), baseline.outputScene.r.prefabJson(),
    'interfaces and prefab metadata are exact V10.2');
  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 6907, edges: 11787, components: 6915},
  'exact dynamic-hammer graph budget');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, 'same 72 physical emitters');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 49, '24 body plus 24 H2 and one limiter Dampens');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0, 'no one-shot or click source introduced');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, VOICES, 'same 24 scheduler calls');
  const execCount = serialized.bricks.flatMap(brick => brick.comps).filter(item =>
    item.type.startsWith('BrickComponentType_Exec_')).length
    + serialized.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length;
  assert.equal(execCount, 691, 'no execution-time work was added');

  const h2ActiveKeys = new Set();
  for (const voice of patch.voices) {
    const pianoVoice = context.pianoPatch.voices[voice.voice];
    const singleVoice = context.singleSourcePatch.voices[voice.voice];
    const baselineSingle = baseline.singleSourcePatch.voices[voice.voice];
    const h3 = one(singleVoice.harmonics.filter(harmonic => harmonic.ratio === 3),
      `voice ${voice.voice} H3`);
    const baselineH2 = one(baselineSingle.harmonics.filter(harmonic => harmonic.ratio === 2),
      `voice ${voice.voice} baseline H2`);
    const baselineH3 = one(baselineSingle.harmonics.filter(harmonic => harmonic.ratio === 3),
      `voice ${voice.voice} baseline H3`);

    assert(component(voice.hit, C.Expr_MathClamp.NAME), `voice ${voice.voice} hit Clamp`);
    assert.equal(scalar(component(voice.hit, C.Expr_MathClamp.NAME).data.Min), HIT_MIN);
    assert.equal(scalar(component(voice.hit, C.Expr_MathClamp.NAME).data.Max), HIT_MAX);
    assert.equal(sourceId(one(incoming(voice.hit, C.Expr_MathClamp.NAME, 'Input'),
      `voice ${voice.voice} decoded velocity`)), sourceId({a: pianoVoice.velocityHold.key,
      at: C.Var.NAME, p: 'Value'}));
    assert(component(voice.hardnessOffset, C.Expr_MathSubtract.NAME),
      `voice ${voice.voice} hardness offset`);
    assert.equal(scalar(component(voice.hardnessOffset,
      C.Expr_MathSubtract.NAME).data.InputB), HIT_MIN);
    assert.equal(sourceId(one(incoming(voice.hardnessOffset,
      C.Expr_MathSubtract.NAME, 'InputA'))), sourceId({a: voice.hit.key,
      at: C.Expr_MathClamp.NAME, p: 'Output'}));
    assert.equal(scalar(component(voice.hardness,
      C.Expr_MathMultiply.NAME).data.InputB), HARDNESS_SCALE);
    assert.equal(sourceId(one(incoming(voice.hardness,
      C.Expr_MathMultiply.NAME, 'InputA'))), sourceId({a: voice.hardnessOffset.key,
      at: C.Expr_MathSubtract.NAME, p: 'Output'}));
    assert.deepEqual(incoming(voice.impact, C.Expr_MathMultiply.NAME).map(sourceId).sort(),
      [sourceId({a: voice.hardness.key, at: C.Expr_MathMultiply.NAME, p: 'Output'}),
        sourceId({a: voice.hardness.key, at: C.Expr_MathMultiply.NAME, p: 'Output'})].sort(),
    `voice ${voice.voice} hardness squared`);
    assert.equal(scalar(component(voice.impactPass,
      C.Expr_MathAdd.NAME).data.InputB), 0, `voice ${voice.voice} impact passthrough`);
    assert.deepEqual(incoming(voice.transientWeight,
      C.Expr_MathMultiply.NAME).map(sourceId).sort(), [
      sourceId({a: voice.hit.key, at: C.Expr_MathClamp.NAME, p: 'Output'}),
      sourceId({a: voice.impactPass.key, at: C.Expr_MathAdd.NAME, p: 'Output'}),
    ].sort(), `voice ${voice.voice} hit times impact`);
    assert.equal(sourceId(one(incoming(pianoVoice.body.withVelocity,
      C.Expr_MathMultiply.NAME, 'InputB'))), sourceId({a: voice.hit.key,
      at: C.Expr_MathClamp.NAME, p: 'Output'}),
    `voice ${voice.voice} body uses exact hit strength`);

    assert.equal(scalar(component(voice.h2.exponent,
      C.Expr_MathMultiply.NAME).data.InputB), STRIKE_RATE,
    `voice ${voice.voice} faster strike decay`);
    assert.equal(scalar(component(voice.h2.decayGain,
      C.Expr_MathMultiply.NAME).data.InputB), BODY_STRIKE_GAIN,
    `voice ${voice.voice} folded body strike gain`);
    assert.equal(sourceId(one(incoming(voice.h2.withVelocity,
      C.Expr_MathMultiply.NAME, 'InputB'))), sourceId({a: voice.transientWeight.key,
      at: C.Expr_MathMultiply.NAME, p: 'Output'}),
    `voice ${voice.voice} strike has nonlinear velocity weight`);
    assert.equal(scalar(component(voice.h2Scale,
      C.Expr_MathMultiply.NAME).data.InputB), H2_FROM_BODY_STRIKE,
    `voice ${voice.voice} H2 is 0.40 from 0.50 strike`);
    assert.equal(sourceId(one(incoming(voice.h2Scale,
      C.Expr_MathMultiply.NAME, 'InputA'))), sourceId({a: voice.h2.withVelocity.key,
      at: C.Expr_MathMultiply.NAME, p: 'Output'}));
    assert.equal(scalar(component(voice.h2Audible,
      C.Expr_CompareGreater.NAME).data.InputB), H2_ENABLE_THRESHOLD);
    assert.deepEqual(incoming(voice.pianoH2On,
      C.Expr_LogicalAND.NAME).map(sourceId).sort(), [
      sourceId({a: pianoVoice.pianoActive.key, at: C.Expr_LogicalAND.NAME, p: 'bOutput'}),
      sourceId({a: voice.h2Audible.key, at: C.Expr_CompareGreater.NAME, p: 'bOutput'}),
    ].sort(), `voice ${voice.voice} Piano-only audible H2 window`);
    assert.equal(scalar(component(voice.h2Active, C.Expr_Select.NAME).data.InputA), 0);
    assert.equal(sourceId(one(incoming(voice.h2Active, C.Expr_Select.NAME, 'bSelectB'))),
      sourceId({a: voice.pianoH2On.key, at: C.Expr_LogicalAND.NAME, p: 'bOutput'}));
    assert.equal(sourceId(one(incoming(voice.h2Active, C.Expr_Select.NAME, 'InputB'))),
      sourceId({a: voice.h2Scale.key, at: C.Expr_MathMultiply.NAME, p: 'Output'}));
    assert(!h2ActiveKeys.has(voice.h2Active.key), `voice ${voice.voice} distinct H2 energy`);
    h2ActiveKeys.add(voice.h2Active.key);

    assert.deepEqual(incoming(voice.h2Master,
      C.Expr_MathMultiply.NAME).map(sourceId).sort(), [
      sourceId({a: voice.h2Active.key, at: C.Expr_Select.NAME, p: 'Output'}),
      sourceId({a: context.headroomPatch.headroom.key,
        at: C.Expr_MathMultiply.NAME, p: 'Output'}),
    ].sort(), `voice ${voice.voice} H2 shares master volume and headroom`);
    assert.equal(scalar(component(voice.h2Envelope, C.Dampen.NAME).data.SmoothTime),
      ATTACK_SECONDS, `voice ${voice.voice} six-millisecond H2 smoothing`);
    assert.equal(scalar(component(voice.h2Envelope, C.Dampen.NAME).data.Value), 0,
      `voice ${voice.voice} H2 starts silent`);
    assert.equal(sourceId(one(incoming(voice.h2Envelope, C.Dampen.NAME, 'Target'))),
      sourceId({a: voice.h2Master.key, at: C.Expr_MathMultiply.NAME, p: 'Output'}));
    assert.equal(incoming(voice.h2Envelope, C.Dampen.NAME, 'SmoothTime').length, 0,
      `voice ${voice.voice} fixed H2 smoothing`);
    assert.equal(scalar(component(voice.h2Residual,
      C.Expr_CompareGreater.NAME).data.InputB), H2_RESIDUAL_THRESHOLD,
    `voice ${voice.voice} inaudible residual cutoff`);
    assert.equal(sourceId(one(incoming(voice.h2Residual,
      C.Expr_CompareGreater.NAME, 'InputA'))), sourceId({a: voice.h2Envelope.key,
      at: C.Dampen.NAME, p: 'Value'}));
    assert.deepEqual(incoming(voice.h2SoundOn, C.Expr_LogicalOR.NAME).map(sourceId).sort(), [
      sourceId({a: voice.pianoH2On.key, at: C.Expr_LogicalAND.NAME, p: 'bOutput'}),
      sourceId({a: voice.h2Residual.key, at: C.Expr_CompareGreater.NAME, p: 'bOutput'}),
    ].sort(), `voice ${voice.voice} H2 remains enabled through its fade`);

    assert.deepEqual(incoming(voice.h2Enable, C.Expr_Select.NAME).map(sourceId).sort(), [
      sourceId({a: pianoVoice.isPiano.key, at: C.Expr_CompareEqual.NAME, p: 'bOutput'}),
      sourceId({a: singleVoice.partialEnable.key, at: C.Expr_Select.NAME, p: 'Output'}),
      sourceId({a: voice.h2SoundOn.key, at: C.Expr_LogicalOR.NAME, p: 'bOutput'}),
    ].sort(), `voice ${voice.voice} profile-aware H2 enable`);
    assert.equal(sourceId(one(incoming(voice.h2.emitter,
      C.AudioEmitter.NAME, 'bEnabled'))), sourceId({a: voice.h2Enable.key,
      at: C.Expr_Select.NAME, p: 'Output'}));
    assert.equal(sourceId(one(incoming(voice.h2.volumeSelect,
      C.Expr_Select.NAME, 'InputB'))), sourceId({a: voice.h2Envelope.key,
      at: C.Dampen.NAME, p: 'Value'}));
    assert.equal(sourceId(one(incoming(voice.h2.volumeSelect,
      C.Expr_Select.NAME, 'InputA'))), sourceId(one(baselineIncoming(baselineH2.volumeSelect,
      C.Expr_Select.NAME, 'InputA'))), `voice ${voice.voice} non-Piano H2 volume exact`);
    assert.equal(scalar(component(voice.ratioBranch.select,
      C.Expr_Select.NAME).data.InputB), H2_RATIO, `voice ${voice.voice} H2 Piano ratio`);
    assert.equal(scalar(component(voice.ratioBranch.select,
      C.Expr_Select.NAME).data.InputA), 1.5,
    `voice ${voice.voice} non-Piano H2 ratio exact`);
    assert.equal(sourceId(one(incoming(h3.emitter, C.AudioEmitter.NAME, 'bEnabled'))),
      sourceId(one(baselineIncoming(baselineH3.emitter,
        C.AudioEmitter.NAME, 'bEnabled'))), `voice ${voice.voice} H3 enable unchanged`);
    assert.equal(incoming(h3.volumeSelect, C.Expr_Select.NAME, 'InputB').length, 0,
      `voice ${voice.voice} H3 Piano volume stays constant`);
    assert.equal(scalar(component(h3.volumeSelect, C.Expr_Select.NAME).data.InputB), 0,
      `voice ${voice.voice} H3 remains silent for Piano`);
  }
  assert.equal(h2ActiveKeys.size, VOICES, '24 distinct H2 amplitudes');

  assert.equal(patch.h2MagnitudeGroups.length, VOICES / 3,
    'eight three-lane H2 energy groups');
  assert.equal(patch.h2EnergyAdders.length, VOICES / 3 - 1,
    'balanced H2 energy tree');
  const measuredH2 = [];
  for (const group of patch.h2MagnitudeGroups) {
    const edges = incoming(group.magnitude, C.Expr_VecMagnitudeSquared.NAME);
    assert.equal(edges.length, 3, 'three H2 amplitudes per magnitude group');
    measuredH2.push(...edges.map(edge => edge.a));
  }
  assert.deepEqual(measuredH2.sort(), [...h2ActiveKeys].sort(),
    'each H2 amplitude enters limiter energy exactly once');
  const measuredBodies = context.compactHeadroomPatch.magnitudeGroups.flatMap(group =>
    incoming(group.magnitude, C.Expr_VecMagnitudeSquared.NAME).map(edge => edge.a));
  assert.deepEqual(measuredBodies.sort(), context.singleSourcePatch.voices
    .map(voice => voice.body.active.key).sort(),
  'each body amplitude enters limiter energy exactly once');
  assert.deepEqual(incoming(patch.totalEnergy, C.Expr_MathAdd.NAME).map(sourceId).sort(), [
    sourceId({a: context.compactHeadroomPatch.energy.key,
      at: primaryType(context.compactHeadroomPatch.energy), p: 'Output'}),
    sourceId({a: patch.h2Energy.key, at: primaryType(patch.h2Energy), p: 'Output'}),
  ].sort(), 'body and H2 energy are summed exactly');
  assert.equal(sourceId(one(incoming(context.compactHeadroomPatch.rootEnergy,
    C.Expr_MathSqrt.NAME, 'Input'))), sourceId({a: patch.totalEnergy.key,
    at: C.Expr_MathAdd.NAME, p: 'Output'}), 'limiter root reads total two-frequency energy');
  assert.equal(scalar(component(context.compactHeadroomPatch.adaptiveScale,
    C.Expr_MathDivide.NAME).data.InputA), RMS_NUMERATOR, 'peak-safe RMS numerator');
  assert.equal(scalar(component(context.compactHeadroomPatch.safeDenominator,
    C.Expr_MathMax.NAME).data.InputB), DENOMINATOR_FLOOR, 'matching limiter floor');

  const targets = new Set();
  for (const edge of scene.edges) {
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `duplicate driver ${target}`);
    targets.add(target);
    assert(byKey.get(edge.a)?.comps.some(item => item.type === edge.at),
      `missing source component ${edge.a}:${edge.at}`);
    assert(byKey.get(edge.z)?.comps.some(item => item.type === edge.zt),
      `missing target component ${edge.z}:${edge.zt}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `invalid source port ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `invalid target port ${edge.zt}.${edge.q}`);
  }

  const sample = midi => {
    const decoded = (midi / 127) ** 1.4;
    const hit = Math.min(HIT_MAX, Math.max(HIT_MIN, decoded));
    const hardness = (hit - HIT_MIN) * HARDNESS_SCALE;
    const impact = hardness ** 2;
    const weight = hit * impact;
    return {decoded, hit, hardness, impact, weight,
      body: hit + BODY_STRIKE_GAIN * weight,
      h2: H2_STRIKE_GAIN * weight};
  };
  const table = [
    [1, 0.1, 0], [24, 0.1, 0],
    [32, 0.14517263520584975, 0.0025192184832602167],
    [48, 0.25610173636534017, 0.03008364456330144],
    [64, 0.3831128811637326, 0.09895420182818487],
    [80, 0.5236013678794541, 0.2215285418140057],
    [96, 0.6758565341934811, 0.40939598515225667],
    [112, 0.8386485924214856, 0.6735823988719036],
    [127, 1, 1],
  ];
  for (const [midi, expectedHit, expectedImpact] of table) {
    const actual = sample(midi);
    assert(Math.abs(actual.hit - expectedHit) < 1e-14, `MIDI ${midi} hit strength`);
    assert(Math.abs(actual.impact - expectedImpact) < 1e-14, `MIDI ${midi} impact`);
  }
  for (let midi = 2; midi <= 127; midi++) {
    assert(sample(midi).hit >= sample(midi - 1).hit, `monotone hit at MIDI ${midi}`);
    assert(sample(midi).impact >= sample(midi - 1).impact,
      `monotone impact at MIDI ${midi}`);
  }
  const hard = sample(127);
  const middle = sample(64);
  const soft = sample(32);
  assert(hard.h2 / hard.body >= 0.25, 'hard H2/body onset ratio is clearly audible');
  assert(middle.h2 / middle.body < 0.10, 'middle H2 color remains restrained');
  assert(soft.h2 < H2_ENABLE_THRESHOLD, 'soft H2 remains below sound-slot threshold');
  assert(Math.exp(STRIKE_RATE * 0.1) < 0.20, 'strike falls below 20% by 100 ms');

  for (const midi of [32, 64, 96, 127]) {
    const note = sample(midi);
    assert.equal(2 * note.body / note.body, 2, `MIDI ${midi} body volume 1-to-2`);
    if (note.h2 > 0) assert.equal(2 * note.h2 / note.h2, 2,
      `MIDI ${midi} H2 volume 1-to-2`);
    assert.equal((2 * note.h2) / (2 * note.body), note.h2 / note.body,
      `MIDI ${midi} timbre independent of master volume`);
  }
  const modelScale = (notes, volume) => {
    const energy = notes.reduce((sum, note) => sum + note.body ** 2 + note.h2 ** 2, 0);
    const root = Math.sqrt(energy);
    return {root, scale: Math.min(MAX_HEADROOM,
      RMS_NUMERATOR / Math.max(DENOMINATOR_FLOOR, volume * root))};
  };
  const modelRms = (notes, volume) => {
    const {root, scale} = modelScale(notes, volume);
    return volume * root * scale / Math.sqrt(2);
  };
  for (const volume of [1, 2]) {
    assert(modelRms(Array.from({length: VOICES}, () => hard), volume)
      <= RMS_CEILING + 1e-12, `24 hard notes stay within RMS ceiling at volume ${volume}`);
    assert(modelRms([soft, middle, sample(96), hard], volume)
      <= RMS_CEILING + 1e-12, `mixed chord stays within RMS ceiling at volume ${volume}`);
  }
  const hardScale = modelScale([hard], 2).scale;
  let harmonicPeak = 0;
  for (let index = 0; index <= 200000; index++) {
    const phase = 2 * Math.PI * index / 200000;
    harmonicPeak = Math.max(harmonicPeak,
      Math.abs(hard.body * Math.sin(phase) + hard.h2 * Math.sin(2 * phase)));
  }
  assert(2 * hardScale * harmonicPeak < 1,
    `hard phase-aligned peak remains below unity: ${2 * hardScale * harmonicPeak}`);

  assert.equal(context.constants.ATTACK_SMOOTH_SECONDS, ATTACK_SECONDS);
  assert.equal(context.silentFlushPatch.constants.SILENT_FLUSH_SECONDS, ATTACK_SECONDS,
    'existing body silent flush remains six milliseconds');
  assert.equal(patch.constants.MAX_PIANO_SOURCES, 48,
    '24 bodies plus at most 24 thresholded H2 transients');

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0},
  'strict placement remains clean');

  console.log('SQM1 piano player V10.3 checks passed: exact V10.2 ancestry and artifact, '
    + '24 explicit 0.1-to-1 hit lanes, nonlinear hard-hit body and thresholded H2 attacks, '
    + 'six-millisecond click-safe H2 residual fades, exact two-frequency limiter energy, '
    + '48-source Piano maximum, independent 1-to-2 master volume, peak-safe hard strikes, '
    + 'unchanged UI/interfaces/non-Piano/H3 routes, deterministic wiring and strict placement.');
  return {baseline, placement, table, hard, middle, soft, harmonicPeak};
};

if (require.main === module) {
  const buildV103 = require('./build-sqm1-piano-player-v10-3.cjs');
  const first = buildV103();
  module.exports(first);
  const second = buildV103();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'V10.3 build is byte-for-byte deterministic');
}
