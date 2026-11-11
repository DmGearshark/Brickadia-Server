'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV101 = require('./build-sqm1-piano-player-v10-1.cjs');
const testV101 = require('./test-sqm1-piano-player-v10-1.cjs');

const V10_1_HASH = '476a2d385ebfa2251e4e579c3ffe6aad2a77f3e050e6fa99a16a55b168e37f40';
const V10_2_HASH = '2008a674854490a923d4f6d4a861fdbc283ccc8d0129e177ed444276d850b97a';
const VOICES = 24;
const LEGACY_STRIKE_GAIN = 0.30;
const LEGACY_STRIKE_RATE = -6;
const STRIKE_GAIN = 0.38;
const STRIKE_RATE = -10;
const ATTACK_SECONDS = 0.006;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);

function setScalar(brick, type, port, value) {
  const item = component(brick, type);
  assert(item, `${brick?.key} ${type}`);
  assert(item.data[port] && typeof item.data[port] === 'object'
    && 'value' in item.data[port], `${brick.key}.${port} scalar`);
  item.data[port].value = value;
}

module.exports = function testSqm1PianoPlayerV102(context) {
  assert(context?.bytes && context?.scene && context?.outputScene && context?.v10_1Bytes
    && context?.hammerImpactPatch && context?.singleSourcePatch
    && context?.silentFlushPatch && context?.compactHeadroomPatch,
  'V10.2 builder context');

  // Pin the complete approved lean player before testing the deliberately tiny
  // sound change. The V10.1 suite covers its scheduler, limiter, score contract,
  // controls, cartridge intake, audio graph, wiring, and placement.
  const baseline = buildV101();
  testV101(baseline);
  assert.equal(sha256(baseline.bytes), V10_1_HASH, 'exact approved V10.1 baseline');
  assert.deepEqual(Buffer.from(context.v10_1Bytes), Buffer.from(baseline.bytes),
    'V10.2 starts from the exact serialized V10.1 player');

  assert.equal(sha256(context.bytes), V10_2_HASH, 'exact deterministic V10.2 build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V10.2 artifact exists');
  const artifact = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifact), V10_2_HASH, 'exact V10.2 artifact hash');
  assert.deepEqual(artifact, Buffer.from(context.bytes), 'artifact equals fresh V10.2 build');
  assert.notDeepEqual(Buffer.from(context.bytes), Buffer.from(baseline.bytes),
    'hammer candidate differs from V10.1');

  const scene = context.scene;
  const serialized = context.outputScene;
  const patch = context.hammerImpactPatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const baselineByKey = new Map(baseline.scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);

  assert.deepEqual(patch.constants, {
    VOICES,
    STRIKE_GAIN,
    STRIKE_RATE,
    LEGACY_STRIKE_GAIN,
    LEGACY_STRIKE_RATE,
    ATTACK_SMOOTH_SECONDS: ATTACK_SECONDS,
  }, 'exact hammer-impact contract');
  assert.deepEqual({addedBricks: patch.addedBricks, removedBricks: patch.removedBricks,
    addedEdges: patch.addedEdges, removedEdges: patch.removedEdges},
  {addedBricks: 0, removedBricks: 0, addedEdges: 0, removedEdges: 0},
  'strike retune adds no topology');
  assert.equal(patch.voices.length, VOICES, 'all 24 voices retuned');
  assert.deepEqual(patch.voices.map(voice => voice.voice),
    Array.from({length: VOICES}, (_, voice) => voice), 'contiguous strike voices');

  const strikeKeys = new Set();
  for (const voice of patch.voices) {
    for (const [brick, expected, legacy, label] of [
      [voice.exponent, STRIKE_RATE, LEGACY_STRIKE_RATE, 'rate'],
      [voice.decayGain, STRIKE_GAIN, LEGACY_STRIKE_GAIN, 'gain'],
    ]) {
      assert(byKey.has(brick.key), `voice ${voice.voice} strike ${label} survives`);
      assert(!strikeKeys.has(brick.key), `voice ${voice.voice} distinct strike ${label}`);
      strikeKeys.add(brick.key);
      assert.equal(incoming(brick, C.Expr_MathMultiply.NAME, 'InputB').length, 0,
        `voice ${voice.voice} strike ${label} remains a constant`);
      assert.equal(scalar(component(brick, C.Expr_MathMultiply.NAME).data.InputB), expected,
        `voice ${voice.voice} new strike ${label}`);
      const oldBrick = baselineByKey.get(brick.key);
      assert(oldBrick, `voice ${voice.voice} V10.1 strike ${label}`);
      assert.equal(scalar(component(oldBrick, C.Expr_MathMultiply.NAME).data.InputB), legacy,
        `voice ${voice.voice} legacy strike ${label}`);
    }
  }
  assert.equal(strikeKeys.size, VOICES * 2, 'exactly 48 strike constants retuned');

  // Normalize those 48 scalar values back to V10.1 and require every brick,
  // wire, placement, component, interface and all other constant data to match.
  const normalizedBricks = structuredClone(scene.bricks);
  const normalizedByKey = new Map(normalizedBricks.map(brick => [brick.key, brick]));
  for (const voice of patch.voices) {
    setScalar(normalizedByKey.get(voice.exponent.key), C.Expr_MathMultiply.NAME,
      'InputB', LEGACY_STRIKE_RATE);
    setScalar(normalizedByKey.get(voice.decayGain.key), C.Expr_MathMultiply.NAME,
      'InputB', LEGACY_STRIKE_GAIN);
  }
  assert.deepEqual(normalizedBricks, baseline.scene.bricks,
    'only the 48 declared scalar values differ from V10.1');
  assert.deepEqual(scene.edges, baseline.scene.edges, 'wire graph is byte-structurally V10.1');
  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    baseline.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V10.1');
  assert.deepEqual(serialized.r.externalAssets(), baseline.outputScene.r.externalAssets(),
    'external assets are exact V10.1');
  assert.deepEqual(serialized.r.prefabJson(), baseline.outputScene.r.prefabJson(),
    'interfaces and prefab metadata are exact V10.1');

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 6675, edges: 11363, components: 6683},
  'exact lean graph budget retained');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, 'same 72 physical emitters');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 25, 'same 25 smoothing components');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0, 'no one-shot or click source introduced');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, VOICES, 'same 24 scheduler calls');
  const execCount = serialized.bricks.flatMap(brick => brick.comps).filter(item =>
    item.type.startsWith('BrickComponentType_Exec_')).length
    + serialized.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length;
  assert.equal(execCount, 691, 'same lean runtime execution inventory');

  // The hammer rides the existing continuously enabled sine body. Its attack
  // remains rounded by the proven six-millisecond Dampen target path, and the
  // same six-millisecond silent flush still prepares retriggered voices.
  assert.equal(context.constants.ATTACK_SMOOTH_SECONDS, ATTACK_SECONDS);
  assert.equal(context.silentFlushPatch.constants.SILENT_FLUSH_SECONDS, ATTACK_SECONDS);
  for (const voice of context.singleSourcePatch.voices) {
    const smooth = voice.body.pianoSmooth;
    assert.equal(scalar(component(smooth, C.Expr_Select.NAME).data.InputB), ATTACK_SECONDS,
      `voice ${voice.voice} six-millisecond Piano attack`);
    assert.equal(incoming(smooth, C.Expr_Select.NAME, 'InputB').length, 0,
      `voice ${voice.voice} attack time remains constant`);
  }

  // The candidate is firmer only at onset. It crosses the old strike near
  // 59 ms, then clears faster so it does not become a sustained buzz.
  const oldStrike = time => LEGACY_STRIKE_GAIN * Math.exp(LEGACY_STRIKE_RATE * time);
  const newStrike = time => STRIKE_GAIN * Math.exp(STRIKE_RATE * time);
  const crossover = Math.log(STRIKE_GAIN / LEGACY_STRIKE_GAIN)
    / (LEGACY_STRIKE_RATE - STRIKE_RATE);
  assert(crossover > 0.058 && crossover < 0.060, `expected crossover: ${crossover}`);
  assert(Math.abs(newStrike(crossover) - oldStrike(crossover)) < 1e-14,
    'strike envelopes meet at the analytic crossover');
  for (const time of [0, 0.025, 0.050]) assert(newStrike(time) > oldStrike(time),
    `candidate has more onset body at ${time}s`);
  for (const time of [0.075, 0.100, 0.250]) assert(newStrike(time) < oldStrike(time),
    `candidate clears faster by ${time}s`);
  assert(-1 / STRIKE_RATE < -1 / LEGACY_STRIKE_RATE,
    'candidate has the shorter exponential time constant');
  const oldHardPeak = context.constants.MAX_HEADROOM * 2 * (1 + LEGACY_STRIKE_GAIN);
  const newHardPeak = context.constants.MAX_HEADROOM * 2 * (1 + STRIKE_GAIN);
  assert(newHardPeak > oldHardPeak, 'hard hit gains onset weight');
  assert(newHardPeak < 1, `volume-two onset remains below unity: ${newHardPeak}`);

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0},
  'strict placement remains clean');

  console.log('SQM1 piano player V10.2 checks passed: exact V10.1 ancestry and artifact, '
    + 'only 48 declared strike scalars changed across 24 voices, 0 topology/runtime/audio-slot '
    + 'growth, six-millisecond rounded attack and flush retained, stronger first 59 ms with a '
    + 'faster tail and sub-unity volume-two peak, exact UI/interfaces, and strict placement.');
  return {baseline, placement, crossover, oldHardPeak, newHardPeak};
};

if (require.main === module) {
  const buildV102 = require('./build-sqm1-piano-player-v10-2.cjs');
  const first = buildV102();
  module.exports(first);
  const second = buildV102();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'V10.2 build is byte-for-byte deterministic');
}
