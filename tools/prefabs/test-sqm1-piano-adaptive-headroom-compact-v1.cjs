'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const testV10 = require('./test-sqm1-piano-player-v10.cjs');
const compactHeadroom = require('./apply-sqm1-piano-adaptive-headroom-compact-v1.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const V10_HASH = 'db59f22fb80e1e1d2c2f797464c09299574a728c73665470939b51d6f9dc5e56';
const VOICES = 24;
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.70;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const DENOMINATOR_FLOOR = RMS_NUMERATOR / MAX_HEADROOM;
const RECOVERY_SECONDS = 0.12;
const GROUP_SIZE = 3;

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

function fixture(runV10Test = false) {
  const context = buildV10();
  if (runV10Test) testV10(context);
  const v10Bytes = Buffer.from(context.bytes);
  const v10OutputScene = context.outputScene;
  const before = {
    bricks: structuredClone(context.scene.bricks),
    edges: structuredClone(context.scene.edges),
  };
  const compactHeadroomPatch = compactHeadroom.apply(context.scene,
    context.adaptiveHeadroomPatch, context.headroomPatch, context.singleSourcePatch);
  const result = write(context.scene, {
    name: 'SQM1 V10.1 Compact Limiter Test Fixture',
    description: 'Exact V10 synthesis with its scalar energy limiter compacted into native '
      + 'three-lane vector magnitude-squared groups.',
  });
  return {
    ...context,
    bytes: result.bytes,
    outputScene: read(result.bytes),
    v10Bytes,
    v10OutputScene,
    before,
    compactHeadroomPatch,
  };
}

function test(context) {
  const {scene, outputScene: serialized, v10Bytes, v10OutputScene, before,
    compactHeadroomPatch: patch, headroomPatch, singleSourcePatch} = context;
  assert(scene && serialized && v10Bytes && v10OutputScene && before && patch
    && headroomPatch && singleSourcePatch, 'compact-headroom fixture');
  assert.equal(sha256(v10Bytes), V10_HASH, 'exact V10 input');
  assert.deepEqual({bricks: before.bricks.length, edges: before.edges.length,
    components: components({bricks: before.bricks})},
  {bricks: 7838, edges: 13196, components: 7846}, 'exact V10 graph budget');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);

  const beforeKeys = new Set(before.bricks.map(brick => brick.key));
  const afterKeys = new Set(scene.bricks.map(brick => brick.key));
  const addedBricks = scene.bricks.filter(brick => !beforeKeys.has(brick.key));
  const removedBricks = before.bricks.filter(brick => !afterKeys.has(brick.key));
  assert.equal(addedBricks.length, 21, '21-component compact limiter');
  assert.equal(removedBricks.length, 54, 'complete scalar V10 limiter removed');
  assert.equal(patch.addedBricks, 21);
  assert.equal(patch.removedBricks.length, 54);
  assert.equal(new Set(patch.removedBricks.map(brick => brick.key)).size, 54);
  assert(addedBricks.every(brick => brick.key.startsWith('sqm1p101gain:')),
    'compact patch owns every added brick');
  assert.deepEqual(removedBricks.map(brick => brick.key).sort(),
    patch.removedBricks.map(brick => brick.key).sort(), 'reported old limiter is exact');
  for (const [key, brick] of beforeByKey) {
    if (!afterKeys.has(key)) continue;
    assert.deepEqual(byKey.get(key), brick, `retained V10 brick ${key} is exact`);
  }

  const beforeEdges = new Set(before.edges.map(edgeId));
  const afterEdges = new Set(scene.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  assert.equal(removedEdges.length, 104, 'all scalar limiter wires removed');
  assert.equal(addedEdges.length, 47, 'compact limiter uses 47 wires');
  assert.deepEqual(removedEdges.map(edgeId).sort(),
    patch.removedEdges.map(edgeId).sort(), 'reported limiter wires are exact');
  const removedKeys = new Set(removedBricks.map(brick => brick.key));
  assert(scene.edges.every(edge => !removedKeys.has(edge.a) && !removedKeys.has(edge.z)),
    'no wire references a removed limiter component');

  const typeCounts = new Map();
  for (const brick of addedBricks) {
    for (const item of brick.comps) typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...typeCounts].sort()), Object.fromEntries([
    [C.Dampen.NAME, 1],
    [C.Expr_MathAdd.NAME, 7],
    [C.Expr_MathDivide.NAME, 1],
    [C.Expr_MathMax.NAME, 1],
    [C.Expr_MathMin.NAME, 1],
    [C.Expr_MathMultiply.NAME, 1],
    [C.Expr_MathSqrt.NAME, 1],
    [C.Expr_VecMagnitudeSquared.NAME, 8],
  ].sort()), 'exact compact component inventory');

  assert.equal(patch.magnitudeGroups.length, 8);
  assert.equal(patch.adders.length, 7);
  assert.equal(patch.sumDepth, 3);
  assert.deepEqual(patch.constants, {
    MAX_HEADROOM,
    RMS_CEILING,
    RMS_NUMERATOR,
    DENOMINATOR_FLOOR,
    RECOVERY_SMOOTH_SECONDS: RECOVERY_SECONDS,
    VOICES,
    GROUP_SIZE,
  });
  const vectorPorts = ['Input.X', 'Input.Y', 'Input.Z'];
  for (let groupIndex = 0; groupIndex < patch.magnitudeGroups.length; groupIndex++) {
    const group = patch.magnitudeGroups[groupIndex];
    assert(component(group.magnitude, C.Expr_VecMagnitudeSquared.NAME),
      `group ${groupIndex} native magnitude-squared gate`);
    assert.deepEqual(group.voices, [groupIndex * 3, groupIndex * 3 + 1, groupIndex * 3 + 2]);
    assert.equal(incoming(group.magnitude, C.Expr_VecMagnitudeSquared.NAME, 'Input').length, 0,
      `group ${groupIndex} has no whole-vector override`);
    for (let member = 0; member < GROUP_SIZE; member++) {
      const voice = group.voices[member];
      const active = singleSourcePatch.voices[voice].body.active;
      assert.equal(sourceId(one(incoming(group.magnitude,
        C.Expr_VecMagnitudeSquared.NAME, vectorPorts[member]),
      `group ${groupIndex} voice ${voice}`)),
      sourceId({a: active.key, at: C.Expr_Select.NAME, p: 'Output'}));
      assert.equal(outgoing(active, C.Expr_Select.NAME, 'Output')
        .filter(edge => edge.z === group.magnitude.key).length, 1,
      `voice ${voice} has one energy-detector wire`);
    }
  }
  assert.equal(patch.adders.reduce((sum, adder) => sum
    + incoming(adder, C.Expr_MathAdd.NAME, 'InputA').length
    + incoming(adder, C.Expr_MathAdd.NAME, 'InputB').length, 0), 14,
  'balanced energy sum has two inputs per adder');

  assert.equal(sourceId(one(incoming(patch.rootEnergy, C.Expr_MathSqrt.NAME, 'Input'),
    'native root input')), sourceId({a: patch.energy.key,
    at: C.Expr_MathAdd.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(patch.denominator,
    C.Expr_MathMultiply.NAME, 'InputA'), 'effective volume')),
  sourceId(headroomPatch.effectiveVolume));
  assert.equal(sourceId(one(incoming(patch.denominator,
    C.Expr_MathMultiply.NAME, 'InputB'), 'root energy')),
  sourceId({a: patch.rootEnergy.key, at: C.Expr_MathSqrt.NAME, p: 'Output'}));
  assert.equal(scalar(component(patch.safeDenominator,
    C.Expr_MathMax.NAME).data.InputB), DENOMINATOR_FLOOR);
  assert.equal(sourceId(one(incoming(patch.safeDenominator,
    C.Expr_MathMax.NAME, 'InputA'), 'raw denominator')),
  sourceId({a: patch.denominator.key, at: C.Expr_MathMultiply.NAME, p: 'Output'}));
  assert.equal(scalar(component(patch.adaptiveScale,
    C.Expr_MathDivide.NAME).data.InputA), RMS_NUMERATOR);
  assert.equal(sourceId(one(incoming(patch.adaptiveScale,
    C.Expr_MathDivide.NAME, 'InputB'), 'safe denominator')),
  sourceId({a: patch.safeDenominator.key, at: C.Expr_MathMax.NAME, p: 'Output'}));
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.SmoothTime),
    RECOVERY_SECONDS);
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.Target), MAX_HEADROOM);
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.Value), MAX_HEADROOM);
  assert.equal(sourceId(one(incoming(patch.recovery, C.Dampen.NAME, 'Target'),
    'recovery target')), sourceId({a: patch.adaptiveScale.key,
    at: C.Expr_MathDivide.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(patch.finalScale, C.Expr_MathMin.NAME, 'InputA'),
    'immediate attenuation')), sourceId({a: patch.adaptiveScale.key,
    at: C.Expr_MathDivide.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(patch.finalScale, C.Expr_MathMin.NAME, 'InputB'),
    'slow recovery')), sourceId({a: patch.recovery.key, at: C.Dampen.NAME, p: 'Value'}));
  assert.equal(sourceId(one(incoming(headroomPatch.headroom,
    C.Expr_MathMultiply.NAME, 'InputB'), 'compact headroom output')),
  sourceId({a: patch.finalScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));

  const sumSquares = amplitudes => amplitudes.reduce((sum, value) => sum + value ** 2, 0);
  const groupedSquares = amplitudes => {
    let level = [];
    for (let index = 0; index < amplitudes.length; index += GROUP_SIZE) {
      level.push(amplitudes[index] ** 2 + amplitudes[index + 1] ** 2
        + amplitudes[index + 2] ** 2);
    }
    while (level.length > 1) {
      const next = [];
      for (let index = 0; index < level.length; index += 2) {
        next.push(index + 1 === level.length ? level[index] : level[index] + level[index + 1]);
      }
      level = next;
    }
    return level[0];
  };
  const legacyScale = (volume, amplitudes) => Math.min(MAX_HEADROOM,
    RMS_NUMERATOR / (volume * Math.pow(Math.max(1e-9, sumSquares(amplitudes)), 0.5)));
  const compactScale = (volume, amplitudes) => RMS_NUMERATOR
    / Math.max(DENOMINATOR_FLOOR, volume * Math.sqrt(groupedSquares(amplitudes)));
  for (const amplitudes of [
    Array(VOICES).fill(0),
    [1.3, ...Array(VOICES - 1).fill(0)],
    Array(VOICES).fill(1.3),
    Array.from({length: VOICES}, (_, index) => index / VOICES),
  ]) for (const volume of [1, 1.5, 2]) {
    assert(Math.abs(legacyScale(volume, amplitudes) - compactScale(volume, amplitudes)) < 1e-12,
      `boundary equivalence at volume ${volume}`);
  }
  let randomState = 0x5a17c9ef;
  let maximumDifference = 0;
  for (let sample = 0; sample < 20000; sample++) {
    const amplitudes = Array.from({length: VOICES}, () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return (randomState / 0x100000000) * 1.3;
    });
    for (const volume of [1, 1.5, 2]) {
      maximumDifference = Math.max(maximumDifference,
        Math.abs(legacyScale(volume, amplitudes) - compactScale(volume, amplitudes)));
    }
  }
  assert(maximumDifference < 1e-12,
    `compact formula differs only by floating-point reassociation: ${maximumDifference}`);

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 7805, edges: 13139, components: 7813},
  'exact compact graph budget');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, 'audio sources unchanged');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 73, 'envelopes and one recovery Dampen unchanged');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, 24, 'scheduler calls unchanged');
  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    v10OutputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V10');
  assert.deepEqual(serialized.r.externalAssets(), v10OutputScene.r.externalAssets(),
    'external assets unchanged');
  assert.deepEqual(serialized.r.prefabJson(), v10OutputScene.r.prefabJson(),
    'prefab metadata unchanged');

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
  return {placement, maximumDifference, hash: sha256(context.bytes)};
}

module.exports = test;
module.exports.fixture = fixture;

if (require.main === module) {
  const first = fixture(true);
  const result = test(first);
  const second = fixture(false);
  const secondResult = test(second);
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'compact limiter rebuilds byte-for-byte');
  console.log('SQM1 compact adaptive-headroom checks passed: exact V10 ancestry, 54 scalar '
    + 'limiter components replaced by 21 native vector/scalar components, one energy wire per '
    + 'voice, equivalent non-boosting 0.70 RMS formula, immediate attenuation, initialized '
    + '120 ms recovery, exact UI/audio/scheduler retention, strict placement, deterministic '
    + `valid wiring and SHA-256 ${result.hash}.`);
}
