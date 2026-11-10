'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const testV5 = require('./test-sqm1-piano-player-v5.cjs');

const V5_SHA256 = 'a657bb76e9c1d31c15c5e9d87f546fdb97fca7d91a491b346a6ef8f283f1da0f';
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const bricksOf = (scene, type) => scene.bricks.filter(brick => component(brick, type));
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function close(actual, expected, label, epsilon = 1e-12) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected}, got ${actual}`);
}

function edgeId(edge) {
  return JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
    z: edge.z, zt: edge.zt, q: edge.q});
}

module.exports = function testSqm1PianoPlayerV6(context) {
  assert(context?.bytes && context?.scene && context?.outputScene
    && context?.v5Context && context?.pianoPatch && context?.releasePatch
    && context?.decayPatch, 'V6 builder context');

  testV5(context.v5Context);
  const v5Hash = crypto.createHash('sha256').update(context.v5Context.bytes).digest('hex');
  assert.equal(v5Hash, V5_SHA256, 'exact verified V5 baseline');

  const scene = context.scene;
  const baseline = context.v5Context.scene;
  const serialized = context.outputScene;
  const decay = context.decayPatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const baselineByKey = new Map(baseline.bricks.map(brick => [brick.key, brick]));
  const resolve = (reference, label = 'brick') => {
    const key = typeof reference === 'string' ? reference : reference?.key;
    assert.equal(typeof key, 'string', `${label} key`);
    const result = byKey.get(key);
    assert(result, `${label} ${key}`);
    return result;
  };
  const incoming = (target, type, port) => {
    const key = resolve(target).key;
    return scene.edges.filter(edge => edge.z === key && edge.zt === type && edge.q === port);
  };
  const input = (target, type, port, label) => one(incoming(target, type, port), label);
  const wire = (source, sourceType, sourcePort, target, targetType, targetPort, label) =>
    one(scene.edges.filter(edge => edge.a === resolve(source).key && edge.at === sourceType
      && edge.p === sourcePort && edge.z === resolve(target).key
      && edge.zt === targetType && edge.q === targetPort), label);
  const constant = (target, type, port, expected, label) => {
    assert.equal(incoming(target, type, port).length, 0, `${label} is constant`);
    close(scalar(component(resolve(target), type).data[port]), expected, label);
  };

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  assert.equal(decay.voices.length, 18);
  assert.equal(decay.addedBricks, 54, 'three slow-body gates per lane');
  assert.equal(decay.removedBricks, 36, 'two permanent harmonic-floor Adds removed per lane');
  assert.equal(decay.netBricks, 18, 'bounded net decay extension');
  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized), dampens: bricksOf(serialized, C.Dampen.NAME).length,
    emitters: bricksOf(serialized, C.AudioEmitter.NAME).length},
  {bricks: 5896, edges: 9871, components: 5904, dampens: 54, emitters: 54},
  'exact V6 graph budget');
  assert.equal(bricksOf(serialized, C.OneShotAudioEmitter.NAME).length, 0);
  assert.equal(bricksOf(serialized, C.Stopwatch.NAME).length, 1);
  assert.equal(bricksOf(serialized, C.FunctionCall.NAME).length, 18);

  const removedKeys = new Set(decay.voices.flatMap(voice =>
    voice.harmonics.map(harmonic => harmonic.legacyCurve.key)));
  assert.equal(removedKeys.size, 36);
  assert([...removedKeys].every(key => baselineByKey.has(key) && !byKey.has(key)),
    'only declared harmonic floor Adds are removed');
  const newBricks = scene.bricks.filter(brick => !baselineByKey.has(brick.key));
  const newKeys = new Set(newBricks.map(brick => brick.key));
  assert.equal(newKeys.size, 54);
  assert(newBricks.every(brick => brick.key.startsWith('sqm1p6:')
    && brick.g === decay.logicGrid && brick.comps.length === 1));
  const newTypes = Object.fromEntries([...new Set(newBricks.map(brick => brick.comps[0].type))]
    .map(type => [type, newBricks.filter(brick => brick.comps[0].type === type).length]));
  assert.deepEqual(newTypes, {
    [C.Expr_MathMultiply.NAME]: 36,
    [C.Expr_MathExp.NAME]: 18,
  }, 'exact V6 added-gate types');
  assert(newBricks.every(brick => scene.edges.some(edge => edge.a === brick.key)),
    'no orphan V6 gate');

  const modifiedKeys = new Set();
  for (const voice of decay.voices) {
    modifiedKeys.add(voice.body.exponent.key);
    modifiedKeys.add(voice.body.scaled.key);
    modifiedKeys.add(voice.body.curve.key);
    for (const harmonic of voice.harmonics) modifiedKeys.add(harmonic.decayGain.key);
  }
  assert.equal(modifiedKeys.size, 90, 'five retuned V5 gates per lane');
  for (const [key, before] of baselineByKey) {
    if (removedKeys.has(key) || modifiedKeys.has(key)) continue;
    const after = byKey.get(key);
    assert(after, `retained V5 brick ${key}`);
    assert.deepEqual({g: after.g, data: after.data, comps: after.comps},
      {g: before.g, data: before.data, comps: before.comps}, `changed unrelated V5 brick ${key}`);
  }

  const assertOnlyPortChanged = (brick, type, port, beforeValue, afterValue, label) => {
    const before = structuredClone(component(baselineByKey.get(brick.key), type).data);
    const after = structuredClone(component(resolve(brick), type).data);
    close(scalar(before[port]), beforeValue, `${label} V5 value`);
    close(scalar(after[port]), afterValue, `${label} V6 value`);
    after[port] = before[port];
    assert.deepEqual(after, before, `${label} only ${port} changed`);
  };

  const expectedRemoved = [];
  const expectedAdded = [];
  for (const voice of decay.voices) {
    const label = `voice ${voice.voice}`;
    assertOnlyPortChanged(voice.body.exponent, C.Expr_MathMultiply.NAME, 'InputB',
      -1.6, -4, `${label} body fast rate`);
    assertOnlyPortChanged(voice.body.scaled, C.Expr_MathMultiply.NAME, 'InputB',
      0.65, 0.75, `${label} body fast gain`);
    assertOnlyPortChanged(voice.body.curve, C.Expr_MathAdd.NAME, 'InputB',
      0.35, 0, `${label} removed body floor`);

    wire(voice.age, C.Expr_MathMax.NAME, 'Output', voice.body.slowExponent,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} slow-tail age`);
    constant(voice.body.slowExponent, C.Expr_MathMultiply.NAME, 'InputB', -0.5,
      `${label} slow-tail rate`);
    wire(voice.body.slowExponent, C.Expr_MathMultiply.NAME, 'Output', voice.body.slowDecay,
      C.Expr_MathExp.NAME, 'Input', `${label} slow-tail exponential`);
    wire(voice.body.slowDecay, C.Expr_MathExp.NAME, 'Output', voice.body.slowScaled,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} slow-tail decay`);
    constant(voice.body.slowScaled, C.Expr_MathMultiply.NAME, 'InputB', 0.25,
      `${label} slow-tail gain`);
    wire(voice.body.scaled, C.Expr_MathMultiply.NAME, 'Output', voice.body.curve,
      C.Expr_MathAdd.NAME, 'InputA', `${label} fast body branch`);
    wire(voice.body.slowScaled, C.Expr_MathMultiply.NAME, 'Output', voice.body.curve,
      C.Expr_MathAdd.NAME, 'InputB', `${label} slow body branch`);
    wire(voice.body.curve, C.Expr_MathAdd.NAME, 'Output', voice.body.withVelocity,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} two-stage body output`);

    expectedAdded.push(
      {a: voice.age.key, at: C.Expr_MathMax.NAME, p: 'Output',
        z: voice.body.slowExponent.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'},
      {a: voice.body.slowExponent.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.body.slowDecay.key, zt: C.Expr_MathExp.NAME, q: 'Input'},
      {a: voice.body.slowDecay.key, at: C.Expr_MathExp.NAME, p: 'Output',
        z: voice.body.slowScaled.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'},
      {a: voice.body.slowScaled.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.body.curve.key, zt: C.Expr_MathAdd.NAME, q: 'InputB'},
    );

    for (const harmonic of voice.harmonics) {
      const specification = harmonic.ratio === 2
        ? {legacyGain: 0.18, gain: 0.23, rate: -6}
        : {legacyGain: 0.05, gain: 0.065, rate: -8};
      const harmonicLabel = `${label} H${harmonic.ratio}`;
      assertOnlyPortChanged(harmonic.decayGain, C.Expr_MathMultiply.NAME, 'InputB',
        specification.legacyGain, specification.gain, `${harmonicLabel} transient gain`);
      constant(harmonic.exponent, C.Expr_MathMultiply.NAME, 'InputB', specification.rate,
        `${harmonicLabel} decay rate`);
      assert.equal(harmonic.curve.key, harmonic.decayGain.key,
        `${harmonicLabel} floorless curve aliases decaying gain`);
      assert(!byKey.has(harmonic.legacyCurve.key), `${harmonicLabel} floor Add removed`);
      wire(harmonic.decayGain, C.Expr_MathMultiply.NAME, 'Output', harmonic.withVelocity,
        C.Expr_MathMultiply.NAME, 'InputA', `${harmonicLabel} floorless transient`);

      const oldCurveInput = one(baseline.edges.filter(edge => edge.a === harmonic.decayGain.key
        && edge.at === C.Expr_MathMultiply.NAME && edge.p === 'Output'
        && edge.z === harmonic.legacyCurve.key && edge.zt === C.Expr_MathAdd.NAME
        && edge.q === 'InputA'), `${harmonicLabel} V5 decay-to-floor Add`);
      const oldCurveOutput = one(baseline.edges.filter(edge => edge.a === harmonic.legacyCurve.key
        && edge.at === C.Expr_MathAdd.NAME && edge.p === 'Output'
        && edge.z === harmonic.withVelocity.key && edge.zt === C.Expr_MathMultiply.NAME
        && edge.q === 'InputA'), `${harmonicLabel} V5 floor output`);
      expectedRemoved.push(oldCurveInput, oldCurveOutput);
      expectedAdded.push({a: harmonic.decayGain.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: harmonic.withVelocity.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'});
    }
  }

  const beforeEdges = new Set(baseline.edges.map(edgeId));
  const afterEdges = new Set(scene.edges.map(edgeId));
  const removedEdges = baseline.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  assert.equal(removedEdges.length, 72);
  assert.equal(addedEdges.length, 108);
  assert.deepEqual(removedEdges.map(edgeId).sort(), expectedRemoved.map(edgeId).sort(),
    'only harmonic floor routes removed');
  assert.deepEqual(addedEdges.map(edgeId).sort(), expectedAdded.map(edgeId).sort(),
    'only two-stage body and floorless harmonic routes added');

  const bodyAt = age => 0.75 * Math.exp(-4 * age) + 0.25 * Math.exp(-0.5 * age);
  const h2At = age => 0.23 * Math.exp(-6 * age);
  const h3At = age => 0.065 * Math.exp(-8 * age);
  const table = [
    [0, 1, 0.23, 0.065],
    [0.1, 0.740547390651908, 0.12622667630162607, 0.029206382667619404],
    [0.25, 0.4965338065247306, 0.05131993683413886, 0.008796793410379826],
    [0.5, 0.29620165819531075, 0.011451025724608708, 0.0011905165277677216],
    [1, 0.165369394094709, 0.0005701130006332625, 0.00002180507081366327],
    [2, 0.09222145726378747, 0.0000014131688412654883, 7.314786356751843e-9],
  ];
  for (const [age, body, h2, h3] of table) {
    close(bodyAt(age), body, `body at ${age}s`);
    close(h2At(age), h2, `H2 at ${age}s`);
    close(h3At(age), h3, `H3 at ${age}s`);
  }
  assert.deepEqual([bodyAt(0), h2At(0), h3At(0)], [1, 0.23, 0.065],
    'hard-strike amplitudes remain exact at note onset');
  assert(bodyAt(2) < 0.1 && h2At(1) < 0.001 && h3At(1) < 0.0001,
    'pedal-held notes decay instead of retaining permanent floors');

  // V5 release/post-roll, scheduler, controls, serialized resources and UI remain exact.
  assert([...byKey.keys()].filter(key => key.startsWith('sqm1p5:')).every(key => {
    const before = baselineByKey.get(key);
    return before && JSON.stringify(byKey.get(key)) === JSON.stringify(before);
  }), 'entire V5 release/post-roll brick graph retained');
  assert.deepEqual(scene.bricks.filter(brick => brick.g === 1),
    baseline.bricks.filter(brick => brick.g === 1), 'exact user UI');
  assert.deepEqual(scene.links, baseline.links);
  assert.deepEqual(scene.r.externalAssets(), baseline.r.externalAssets());
  assert.deepEqual(scene.r.prefabJson(), baseline.r.prefabJson());
  const arrays = value => bricksOf(value, C.ArrayVar.NAME)
    .map(brick => component(brick, C.ArrayVar.NAME).data.Value)
    .sort((a, z) => (a.$array?.length ?? 0) - (z.$array?.length ?? 0));
  assert.deepEqual(arrays(scene), arrays(baseline), 'retained score arrays');
  assert.equal(bricksOf(scene, C.Exec_ArrayVar_CopyFrom.NAME).length, 2);
  assert.equal(bricksOf(scene, C.Exec_Entity_DestroySpawnedPrefab.NAME).length, 1);

  const serializedByKey = new Map(serialized.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of serialized.edges) {
    const source = serializedByKey.get(edge.a);
    const target = serializedByKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at));
    assert(target?.comps.some(item => item.type === edge.zt));
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `duplicate target ${targetId}`);
    targets.add(targetId);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p));
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q));
  }

  console.log('SQM1 piano player V6 checks passed: exact V5 baseline and hard strike, '
    + 'eighteen two-stage decaying bodies, floorless 2x/3x strike partials, exact release and '
    + 'silent post-roll preservation, non-Piano/UI/scheduler retention, bounded net 18-gate '
    + 'cost, strict placement and deterministic valid wiring.');
  return {scene, baseline, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v6.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.equal(crypto.createHash('sha256').update(second.bytes).digest('hex'),
    crypto.createHash('sha256').update(first.bytes).digest('hex'),
  'V6 full-player build is byte-for-byte deterministic');
}
