'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV9 = require('./build-sqm1-piano-player-v9.cjs');
const testV9 = require('./test-sqm1-piano-player-v9.cjs');
const buildHisThemeV4 = require('./build-sqm1-his-theme-pitch-continuity-v4.cjs');
const testHisThemeV4 = require('./test-sqm1-his-theme-pitch-continuity-v4.cjs');
const scoreContract = require('./build-sqm1-song-cartridge-v1.cjs');

const V9_HASH = 'ad9eab5e70622696f3ff57eb6a64ffd94a36cbd40cfff9ef2f8647442e2694ae';
const V10_HASH = 'db59f22fb80e1e1d2c2f797464c09299574a728c73665470939b51d6f9dc5e56';
const HIS_THEME_V4_HASH =
  '0808c8f570b6565b921f81b7ba19d9a931806182f1ac0db15b4fd366533e3c1f';
const VOICES = 24;
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.70;
const RECOVERY_SECONDS = 0.12;
const FLUSH_SECONDS = 0.006;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});
const sourceId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p});

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

module.exports = function testSqm1PianoPlayerV10(context) {
  assert(context?.bytes && context?.scene && context?.outputScene && context?.v9Bytes
    && context?.adaptiveHeadroomPatch && context?.continuousBodyPatch
    && context?.silentFlushPatch, 'V10 builder context');

  // Re-run the complete V4..V9 player ancestry, then pin the exact V9 bytes
  // from which this graph was extended.
  const v9 = buildV9();
  testV9(v9);
  assert.equal(sha256(v9.bytes), V9_HASH, 'exact V9 baseline');
  assert.deepEqual(Buffer.from(context.v9Bytes), Buffer.from(v9.bytes),
    'V10 starts from the exact V9 bytes');
  assert.equal(sha256(context.bytes), V10_HASH, 'exact V10 build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V10 artifact exists');
  const artifact = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifact), V10_HASH, 'exact V10 artifact');
  assert.deepEqual(artifact, Buffer.from(context.bytes), 'artifact equals fresh V10 build');

  const before = v9.scene;
  const scene = context.scene;
  const serialized = context.outputScene;
  const adaptive = context.adaptiveHeadroomPatch;
  const lifecycle = context.continuousBodyPatch;
  const flush = context.silentFlushPatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);

  // V10 is a hidden backend extension: every visible brick, asset, grid and
  // prefab setting is byte-structurally the same as V9.
  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    v9.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V9');
  assert.deepEqual(serialized.r.externalAssets(), v9.outputScene.r.externalAssets(),
    'external assets unchanged');
  assert.deepEqual(scene.r.prefabJson(), before.r.prefabJson(),
    'prefab metadata unchanged');
  assert.deepEqual(serialized.r.prefabJson(), v9.outputScene.r.prefabJson(),
    'serialized prefab metadata unchanged');

  const beforeKeys = new Set(before.bricks.map(brick => brick.key));
  const afterKeys = new Set(scene.bricks.map(brick => brick.key));
  const addedBricks = scene.bricks.filter(brick => !beforeKeys.has(brick.key));
  const removedBricks = before.bricks.filter(brick => !afterKeys.has(brick.key));
  assert.equal(removedBricks.length, 0, 'no V9 bricks removed');
  assert.equal(addedBricks.length, 128, 'bounded V10 backend extension');
  assert.equal(adaptive.addedBricks, 54, '54 adaptive-headroom gates');
  assert.equal(lifecycle.addedBricks, 50, '50 lifecycle gates');
  assert.equal(flush.addedBricks, 24, '24 silent-flush gates');
  assert.equal(addedBricks.filter(brick => brick.key.startsWith('sqm1p10gain:')).length, 54);
  assert.equal(addedBricks.filter(brick => brick.key.startsWith('sqm1p10:')).length, 50);
  assert.equal(addedBricks.filter(brick => brick.key.startsWith('sqm1p10f:')).length, 24);
  for (const brick of before.bricks) {
    assert.deepEqual(byKey.get(brick.key), brick, `retained V9 brick ${brick.key} is exact`);
  }

  const beforeEdges = new Set(before.edges.map(edgeId));
  const afterEdges = new Set(scene.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  assert.equal(removedEdges.length, VOICES * 3,
    'body enable, Piano body volume and body release-smoothing routes replaced');
  assert.equal(addedEdges.length, 347, 'bounded V10 wiring extension');
  assert.deepEqual(removedEdges.map(edgeId).sort(), [
    ...lifecycle.removedEdges, ...flush.removedEdges,
  ].map(edgeId).sort(), 'patches report every removed V9 edge');

  // The stable-playback signal is true only after replay initialization and
  // stays true until playback stops. It is shared by all 24 Piano bodies.
  assert.deepEqual(lifecycle.constants,
    {VOICES, SHARED_GATES: 2, GATES_PER_VOICE: 2});
  assert(component(lifecycle.starting, C.Var.NAME), 'playback-starting state');
  assert(component(lifecycle.running, C.Var.NAME), 'running state');
  assert(component(lifecycle.notStarting, C.Expr_LogicalNOT.NAME), 'not-starting gate');
  assert(component(lifecycle.stablePlayback, C.Expr_LogicalAND.NAME),
    'stable-playback gate');
  assert.equal(sourceId(one(incoming(lifecycle.notStarting, C.Expr_LogicalNOT.NAME, 'bInput'),
    'starting -> NOT')), sourceId({a: lifecycle.starting.key, at: C.Var.NAME, p: 'Value'}));
  const stableInputs = [
    ...incoming(lifecycle.stablePlayback, C.Expr_LogicalAND.NAME, 'bInputA'),
    ...incoming(lifecycle.stablePlayback, C.Expr_LogicalAND.NAME, 'bInputB'),
  ].map(sourceId).sort();
  assert.deepEqual(stableInputs, [
    sourceId({a: lifecycle.running.key, at: C.Var.NAME, p: 'Value'}),
    sourceId({a: lifecycle.notStarting.key, at: C.Expr_LogicalNOT.NAME, p: 'bOutput'}),
  ].sort(), 'stable playback is running AND not-starting');

  const stableSource = sourceId({a: lifecycle.stablePlayback.key,
    at: C.Expr_LogicalAND.NAME, p: 'bOutput'});
  const bodyEmitterKeys = new Set();
  const partialEmitterKeys = new Set();
  for (const patched of lifecycle.voices) {
    const voice = patched.voice;
    const baseVoice = context.singleSourcePatch.voices[voice];
    const releaseVoice = context.releasePatch.voices[voice];
    assert.equal(releaseVoice.voice, voice);
    bodyEmitterKeys.add(baseVoice.body.emitter.key);
    for (const harmonic of baseVoice.harmonics) partialEmitterKeys.add(harmonic.emitter.key);

    assert(component(patched.maskedVolume, C.Expr_Select.NAME),
      `voice ${voice} exact-zero volume mask`);
    assert.equal(sourceId(one(incoming(patched.maskedVolume, C.Expr_Select.NAME, 'bSelectB'),
      `voice ${voice} volume condition`)), sourceId(releaseVoice.audibleWindow),
    `voice ${voice} mask uses complete guarded audible window`);
    assert.equal(incoming(patched.maskedVolume, C.Expr_Select.NAME, 'InputA').length, 0);
    assert.equal(scalar(component(patched.maskedVolume, C.Expr_Select.NAME).data.InputA), 0,
      `voice ${voice} hidden body is exactly silent`);
    assert.equal(sourceId(one(incoming(patched.maskedVolume, C.Expr_Select.NAME, 'InputB'),
      `voice ${voice} audible volume`)), sourceId(patched.pianoVolume),
    `voice ${voice} retains exact V9 Piano volume`);
    assert.equal(sourceId(one(incoming(releaseVoice.body.volumeSelect,
      C.Expr_Select.NAME, 'InputB'), `voice ${voice} masked Piano volume`)),
    sourceId({a: patched.maskedVolume.key, at: C.Expr_Select.NAME, p: 'Output'}));

    assert(component(patched.continuousEnable, C.Expr_Select.NAME),
      `voice ${voice} profile-aware body enable`);
    assert.equal(sourceId(one(incoming(patched.continuousEnable,
      C.Expr_Select.NAME, 'bSelectB'), `voice ${voice} enable profile`)),
    sourceId(patched.profileCondition), `voice ${voice} exact Piano profile condition`);
    assert.equal(sourceId(one(incoming(patched.continuousEnable,
      C.Expr_Select.NAME, 'InputA'), `voice ${voice} legacy non-Piano enable`)),
    sourceId(patched.legacyEnable), `voice ${voice} exact legacy non-Piano path`);
    assert.equal(sourceId(one(incoming(patched.continuousEnable,
      C.Expr_Select.NAME, 'InputB'), `voice ${voice} continuous Piano enable`)),
    stableSource, `voice ${voice} Piano body remains stable for playback`);
    assert.equal(sourceId(one(incoming(patched.bodyEmitter,
      C.AudioEmitter.NAME, 'bEnabled'), `voice ${voice} final body enable`)),
    sourceId({a: patched.continuousEnable.key, at: C.Expr_Select.NAME, p: 'Output'}));
    assert(!scene.edges.some(edge => edgeId(edge) === edgeId(patched.legacyEnable)),
      `voice ${voice} old direct enable removed`);
    assert(!scene.edges.some(edge => edgeId(edge) === edgeId(patched.pianoVolume)),
      `voice ${voice} old direct Piano volume removed`);
  }
  assert.equal(bodyEmitterKeys.size, VOICES, 'one continuously enabled Piano body per lane');
  assert.equal(partialEmitterKeys.size, VOICES * 2, 'two physical partials per lane');
  assert.equal(outgoing(lifecycle.stablePlayback,
    C.Expr_LogicalAND.NAME, 'bOutput').length, VOICES,
  'one stable-playback fanout per Piano body');

  // Partials and every non-Piano path remain exact V9 structures. The only
  // changed legacy input targets are the three documented body inputs.
  for (const emitterKey of partialEmitterKeys) {
    const emitter = byKey.get(emitterKey);
    const beforeEmitter = beforeByKey.get(emitterKey);
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier']) {
      assert.deepEqual(incoming(emitter, C.AudioEmitter.NAME, port).map(edgeId).sort(),
        before.edges.filter(edge => edge.z === beforeEmitter.key
          && edge.zt === C.AudioEmitter.NAME && edge.q === port).map(edgeId).sort(),
      `${emitterKey}.${port} exact V9 partial path`);
    }
  }

  // During the audible release use the exact V9 70 ms/speed smoothing. Once
  // the audible window closes, use a fixed 6 ms Dampen flush. Attack remains
  // V9's fixed 6 ms value.
  assert.deepEqual(flush.constants,
    {VOICES, GATES_PER_VOICE: 1, SILENT_FLUSH_SECONDS: FLUSH_SECONDS});
  assert.equal(scalar(component(context.releasePatch.bodyReleaseSmooth,
    C.Expr_MathDivide.NAME).data.InputA), 0.07, 'audible release remains 70 ms/speed');
  for (const patched of flush.voices) {
    const voice = patched.voice;
    assert(component(patched.flushSmooth, C.Expr_Select.NAME),
      `voice ${voice} flush selector`);
    assert.equal(sourceId(one(incoming(patched.flushSmooth,
      C.Expr_Select.NAME, 'bSelectB'), `voice ${voice} flush condition`)),
    sourceId(patched.audibleWindow), `voice ${voice} flush follows audible window`);
    assert.equal(incoming(patched.flushSmooth, C.Expr_Select.NAME, 'InputA').length, 0);
    assert.equal(scalar(component(patched.flushSmooth, C.Expr_Select.NAME).data.InputA),
      FLUSH_SECONDS, `voice ${voice} silent flush is 6 ms`);
    assert.equal(sourceId(one(incoming(patched.flushSmooth,
      C.Expr_Select.NAME, 'InputB'), `voice ${voice} normal release`)),
    sourceId({a: context.releasePatch.bodyReleaseSmooth.key,
      at: C.Expr_MathDivide.NAME, p: 'Output'}));
    assert.equal(sourceId(one(incoming(patched.pianoSmooth,
      C.Expr_Select.NAME, 'InputA'), `voice ${voice} selected smoothing`)),
    sourceId({a: patched.flushSmooth.key, at: C.Expr_Select.NAME, p: 'Output'}));
    assert.equal(incoming(patched.pianoSmooth, C.Expr_Select.NAME, 'InputB').length, 0);
    assert.equal(scalar(component(patched.pianoSmooth, C.Expr_Select.NAME).data.InputB),
      0.006, `voice ${voice} attack remains 6 ms`);
  }
  const oldResidual = Math.exp(-(0.2 / 0.07));
  const worstNewResidual = Math.exp(-((0.08 / 0.07) + 10));
  assert(oldResidual / worstNewResidual > 3900,
    'worst-case modeled residual falls by more than 3,900 times');

  // Energy detection happens before the shared master gain, so it cannot feed
  // back into itself. Falling gain is immediate; only recovery is smoothed.
  assert.equal(adaptive.voices.length, VOICES);
  assert.equal(adaptive.squares.length, VOICES);
  assert.equal(adaptive.adders.length, VOICES - 1);
  assert.equal(adaptive.sumDepth, 5);
  assert.deepEqual(adaptive.constants, {
    MAX_HEADROOM,
    RMS_CEILING,
    RMS_NUMERATOR: RMS_CEILING * Math.sqrt(2),
    ENERGY_FLOOR: 1e-9,
    RECOVERY_SMOOTH_SECONDS: RECOVERY_SECONDS,
    VOICES,
  });
  for (let voice = 0; voice < VOICES; voice++) {
    const square = adaptive.squares[voice];
    const active = context.singleSourcePatch.voices[voice].body.active;
    const activeSource = sourceId({a: active.key, at: C.Expr_Select.NAME, p: 'Output'});
    assert.equal(sourceId(one(incoming(square, C.Expr_MathMultiply.NAME, 'InputA'),
      `voice ${voice} energy A`)), activeSource);
    assert.equal(sourceId(one(incoming(square, C.Expr_MathMultiply.NAME, 'InputB'),
      `voice ${voice} energy B`)), activeSource);
  }
  assert.equal(scalar(component(adaptive.safeEnergy,
    C.Expr_MathMax.NAME).data.InputB), 1e-9);
  assert.equal(scalar(component(adaptive.rootEnergy,
    C.Expr_MathPow.NAME).data.Exponent), 0.5);
  assert.equal(sourceId(one(incoming(adaptive.denominator,
    C.Expr_MathMultiply.NAME, 'InputA'), 'effective visible volume')),
  sourceId(context.headroomPatch.effectiveVolume));
  assert.equal(sourceId(one(incoming(adaptive.denominator,
    C.Expr_MathMultiply.NAME, 'InputB'), 'root energy')),
  sourceId({a: adaptive.rootEnergy.key, at: C.Expr_MathPow.NAME, p: 'Output'}));
  assert.equal(scalar(component(adaptive.ceilingScale,
    C.Expr_MathDivide.NAME).data.InputA), RMS_CEILING * Math.sqrt(2));
  assert.equal(scalar(component(adaptive.adaptiveScale,
    C.Expr_MathMin.NAME).data.InputB), MAX_HEADROOM);
  assert.equal(scalar(component(adaptive.recovery,
    C.Dampen.NAME).data.SmoothTime), RECOVERY_SECONDS);
  assert.equal(scalar(component(adaptive.recovery,
    C.Dampen.NAME).data.Target), MAX_HEADROOM,
  'recovery target initializes at full V9 headroom');
  assert.equal(scalar(component(adaptive.recovery,
    C.Dampen.NAME).data.Value), MAX_HEADROOM,
  'recovery value initializes at full V9 headroom without first-note fade');
  assert.equal(sourceId(one(incoming(adaptive.recovery, C.Dampen.NAME, 'Target'),
    'recovery target')), sourceId({a: adaptive.adaptiveScale.key,
    at: C.Expr_MathMin.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(adaptive.finalScale,
    C.Expr_MathMin.NAME, 'InputA'), 'immediate attenuation')),
  sourceId({a: adaptive.adaptiveScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(adaptive.finalScale,
    C.Expr_MathMin.NAME, 'InputB'), 'smoothed recovery')),
  sourceId({a: adaptive.recovery.key, at: C.Dampen.NAME, p: 'Value'}));
  assert.equal(sourceId(one(incoming(context.headroomPatch.headroom,
    C.Expr_MathMultiply.NAME, 'InputB'), 'final adaptive headroom')),
  sourceId({a: adaptive.finalScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));

  const scale = (volume, amplitudes) => Math.min(MAX_HEADROOM,
    RMS_CEILING * Math.sqrt(2) / (volume
      * Math.sqrt(Math.max(1e-9, amplitudes.reduce((sum, value) => sum + value ** 2, 0)))));
  assert.equal(scale(1, []), MAX_HEADROOM, 'silence keeps V9 headroom');
  assert.equal(scale(2, [1.3]), MAX_HEADROOM,
    'maximum-velocity solo keeps V9 headroom at volume 2');
  const loudChord = Array(VOICES).fill(1.3);
  const chordScale = scale(2, loudChord);
  assert(chordScale < 0.08, 'dense full-level chord attenuates');
  const resultingRms = 2 * chordScale
    * Math.sqrt(loudChord.reduce((sum, value) => sum + value ** 2, 0) / 2);
  assert(Math.abs(resultingRms - RMS_CEILING) < 1e-12,
    'dense modeled RMS is capped at 0.70');

  // Controls retain the approved ranges and defaults.
  const volumeSpecs = context.constants.CONTROL_SPECS.filter(spec =>
    spec.label === 'Volume down' || spec.label === 'Volume Up');
  assert.equal(volumeSpecs.length, 2);
  for (const spec of volumeSpecs) assert.deepEqual({step: spec.step, min: spec.min, max: spec.max},
    {step: 0.1, min: 1, max: 2}, `${spec.label} range`);
  const volumeSteps = context.steps.filter(step => {
    const label = component(step.button, C.Button.NAME)?.data.PromptCustomLabel;
    return label === 'Volume down' || label === 'Volume Up';
  });
  assert.equal(volumeSteps.length, 2);
  for (const step of volumeSteps) assert.equal(scalar(component(step.state, C.Var.NAME).data.Value),
    1, 'visible volume defaults to 1');

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 7838, edges: 13196, components: 7846},
  'exact V10 graph budget');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, '72 physical emitters');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, VOICES, '24 scheduler voice calls');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0, 'no one-shot sources');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 73, '72 envelopes plus one headroom recovery Dampen');

  // The faithful 24-lane pitch-continuity cartridge remains byte-exact and
  // passes the same format-1 capacity contract advertised by the V10 player.
  const hisThemeV4 = buildHisThemeV4();
  testHisThemeV4(hisThemeV4);
  assert.equal(sha256(hisThemeV4.bytes), HIS_THEME_V4_HASH,
    'exact His Theme pitch-continuity V4 cartridge');
  const accepted = scoreContract.validateScoreDocument(hisThemeV4.score.document, {
    maxActiveVoices: VOICES,
    maxArrayEntries: 65536,
  });
  assert.equal(accepted.statistics.activeVoices, VOICES);
  assert.equal(accepted.values.length, 1970);

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  const serializedByKey = new Map(serialized.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of serialized.edges) {
    const source = serializedByKey.get(edge.a);
    const target = serializedByKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at), `valid source ${edge.a}`);
    assert(target?.comps.some(item => item.type === edge.zt), `valid target ${edge.z}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `unique target ${targetId}`);
    targets.add(targetId);
  }

  console.log('SQM1 piano player V10 checks passed: exact V4-V9 ancestry and V10 artifact, '
    + 'unchanged UI/metadata, 24 stable Piano bodies with exact-zero hidden retuning, exact '
    + 'non-Piano and partial paths, 6 ms silent residual flush, non-boosting energy limiter '
    + 'with immediate attenuation and 120 ms recovery, approved controls, His Theme V4 '
    + 'compatibility, strict placement, deterministic budget and valid unique wiring.');
  return {v9, hisThemeV4, placement, oldResidual, worstNewResidual, chordScale};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v10.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'V10 build is byte-for-byte deterministic');
}
