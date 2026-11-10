'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const PROFILES = Object.freeze({
  1: {smooth: 0.028, ratios: [2, 3], gains: [0.18, 0.06]},
  2: {smooth: 0.018, ratios: [2.5, 4], gains: [0.30, 0.16]},
  3: {smooth: 0.055, ratios: [2, 3], gains: [0.42, 0.23]},
  4: {smooth: 0.10, ratios: [2, 3], gains: [0.14, 0.06]},
  5: {smooth: 0.04, ratios: [0.5, 1.5], gains: [0.28, 0.10]},
  6: {smooth: 0.075, ratios: [2, 3], gains: [0.06, 0.02]},
  7: {smooth: 0.025, ratios: [1.5, 2], gains: [0.24, 0.16]},
});

const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const bricksOf = (scene, type) => scene.bricks.filter(brick => component(brick, type));
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function close(actual, expected, label) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`);
}

function edgeId(edge) {
  return JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
    z: edge.z, zt: edge.zt, q: edge.q});
}

module.exports = function testSqm1PianoPlayerV4(context) {
  assert(context?.bytes && context?.baselineBytes && context?.pianoPatch,
    'V4 context must include bytes, baselineBytes and pianoPatch');
  const scene = context.outputScene?.bricks ? context.outputScene : read(context.bytes);
  const baseline = context.baselineScene?.bricks
    ? context.baselineScene : read(context.baselineBytes);
  const patch = context.pianoPatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const baselineByKey = new Map(baseline.bricks.map(brick => [brick.key, brick]));
  const prewriteByKey = new Map(context.scene.bricks.map(candidate => [candidate.key, candidate]));
  const gridSeed = patch.voices[0].pianoActive;
  const serializedLogicGrid = one(scene.bricks.filter(candidate =>
    JSON.stringify(candidate.data.position) === JSON.stringify(gridSeed.data.position)
      && component(candidate, C.Expr_LogicalAND.NAME)), 'serialized piano grid seed').g;
  const resolved = new Map();
  const brick = (reference, label = 'brick') => {
    const raw = typeof reference === 'string' ? prewriteByKey.get(reference) : reference;
    const key = typeof reference === 'string' ? reference : reference?.key;
    assert.equal(typeof key, 'string', `${label} has a key`);
    if (byKey.has(key)) return byKey.get(key);
    if (resolved.has(key)) return resolved.get(key);
    assert(raw?.data?.position && Array.isArray(raw.comps), `${label} ${key} prewrite brick`);
    const expectedGrid = raw.g === patch.logicGrid ? serializedLogicGrid : raw.g;
    const types = raw.comps.map(item => item.type).filter(type => type !== C.Interact.NAME);
    const result = one(scene.bricks.filter(candidate => candidate.g === expectedGrid
      && JSON.stringify(candidate.data.position) === JSON.stringify(raw.data.position)
      && types.every(type => component(candidate, type))), `${label} ${key} serialized by position`);
    resolved.set(key, result);
    return result;
  };
  const normalizedSource = source => ({
    a: brick(prewriteByKey.get(source.a), `legacy source ${source.a}`).key,
    at: source.at,
    p: source.p,
  });
  const incoming = (target, type, port) => {
    const key = brick(target).key;
    return scene.edges.filter(edge => edge.z === key && edge.zt === type && edge.q === port);
  };
  const outgoing = (source, type, port) => {
    const key = brick(source).key;
    return scene.edges.filter(edge => edge.a === key && edge.at === type && edge.p === port);
  };
  const input = (target, type, port, label) => one(incoming(target, type, port), label);
  const wire = (source, sourceType, sourcePort, target, targetType, targetPort, label) =>
    one(scene.edges.filter(edge => edge.a === brick(source).key && edge.at === sourceType
      && edge.p === sourcePort && edge.z === brick(target).key
      && edge.zt === targetType && edge.q === targetPort), label);
  const constant = (target, type, port, expected, label) => {
    assert.equal(incoming(target, type, port).length, 0, `${label} is constant`);
    close(scalar(component(brick(target), type).data[port]), expected, label);
  };

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  assert.equal(patch.voices.length, 18, 'eighteen piano lane patches');
  assert.deepEqual(patch.voices.map(voice => voice.voice).sort((a, z) => a - z),
    Array.from({length: 18}, (_, index) => index));
  assert.equal(patch.addedBricks, 702, '39 pure piano gates per voice');
  assert.deepEqual({bricks: baseline.bricks.length, edges: baseline.edges.length,
    components: components(baseline), dampens: bricksOf(baseline, C.Dampen.NAME).length,
    emitters: bricksOf(baseline, C.AudioEmitter.NAME).length},
  {bricks: 4847, edges: 7975, components: 4855, dampens: 18, emitters: 54},
  'known optimized V3 baseline');
  assert.deepEqual({bricks: scene.bricks.length, edges: scene.edges.length,
    components: components(scene), dampens: bricksOf(scene, C.Dampen.NAME).length,
    emitters: bricksOf(scene, C.AudioEmitter.NAME).length},
  {bricks: 5549, edges: 9127, components: 5557, dampens: 54, emitters: 54},
  'bounded V4 graph');
  assert.equal(bricksOf(scene, C.OneShotAudioEmitter.NAME).length, 0);
  assert.equal(bricksOf(scene, C.Stopwatch.NAME).length, 1);
  assert.equal(bricksOf(scene, C.FunctionCall.NAME).length, 18);
  assert.equal(bricksOf(scene, C.Expr_MathExp.NAME).length
    - bricksOf(baseline, C.Expr_MathExp.NAME).length, 54);
  assert.equal(bricksOf(scene, C.Expr_MathPow.NAME).length
    - bricksOf(baseline, C.Expr_MathPow.NAME).length, 18);

  // The post-optimizer extension may not mutate any proven V3 brick.
  for (const [key, before] of baselineByKey) {
    const after = byKey.get(key);
    assert(after, `retained V3 brick ${key}`);
    assert.deepEqual({g: after.g, data: after.data, comps: after.comps},
      {g: before.g, data: before.data, comps: before.comps}, `changed V3 brick ${key}`);
  }
  const oldKeys = new Set(baselineByKey.keys());
  const newBricks = scene.bricks.filter(candidate => !oldKeys.has(candidate.key));
  const newKeys = new Set(newBricks.map(candidate => candidate.key));
  assert.equal(newKeys.size, 702);
  assert.equal(new Set(newBricks.map(candidate => candidate.g)).size, 1,
    'all added gates remain together in the player logic grid');
  assert.notEqual(newBricks[0].g, 1, 'piano gates are not visible root bricks');
  const allowedTypes = new Set([
    C.Expr_LogicalAND.NAME, C.Expr_Select.NAME, C.Expr_MathSubtract.NAME,
    C.Expr_MathMax.NAME, C.Expr_MathPow.NAME, C.Expr_MathAdd.NAME,
    C.Expr_MathMultiply.NAME, C.Expr_MathExp.NAME, C.Dampen.NAME,
  ]);
  const newTypeCounts = {};
  for (const candidate of newBricks) {
    assert.equal(candidate.comps.length, 1, `one component on ${candidate.key}`);
    const type = candidate.comps[0].type;
    assert(allowedTypes.has(type), `unexpected piano gate ${type}`);
    assert(scene.edges.some(edge => edge.a === candidate.key), `orphan piano gate ${candidate.key}`);
    newTypeCounts[type] = (newTypeCounts[type] ?? 0) + 1;
  }
  assert.deepEqual(newTypeCounts, {
    [C.Expr_LogicalAND.NAME]: 18,
    [C.Expr_Select.NAME]: 180,
    [C.Expr_MathSubtract.NAME]: 18,
    [C.Expr_MathMax.NAME]: 18,
    [C.Expr_MathPow.NAME]: 18,
    [C.Expr_MathAdd.NAME]: 90,
    [C.Expr_MathMultiply.NAME]: 270,
    [C.Expr_MathExp.NAME]: 54,
    [C.Dampen.NAME]: 36,
  }, 'exact optimized piano gate budget');

  const outputEdges = new Set(scene.edges.map(edgeId));
  const baselineEdges = new Set(baseline.edges.map(edgeId));
  const removed = baseline.edges.filter(edge => !outputEdges.has(edgeId(edge)));
  const added = scene.edges.filter(edge => !baselineEdges.has(edgeId(edge)));
  const expectedRemoved = patch.voices.flatMap(voice => {
    const target = voice.body.legacy.targetEdge;
    const smooth = voice.body.legacy.smoothEdge;
    return [target, smooth, ...voice.harmonics.map(harmonic => harmonic.legacyVolumeEdge)];
  }).filter(Boolean);
  // Older builder contexts expose only source triples. Reconstruct the exact
  // four legacy edges per lane from the V3 baseline when edge snapshots are
  // intentionally omitted from the public context.
  const reconstructed = patch.voices.flatMap(voice => {
    const targetKey = brick(voice.body.envelope).key;
    const target = one(baseline.edges.filter(edge => edge.z === targetKey
      && edge.zt === C.Dampen.NAME && edge.q === 'Target'));
    const smooth = one(baseline.edges.filter(edge => edge.z === targetKey
      && edge.zt === C.Dampen.NAME && edge.q === 'SmoothTime'));
    const harmonicVolumes = voice.harmonics.map(harmonic => one(baseline.edges.filter(edge =>
      edge.z === brick(harmonic.emitter).key && edge.zt === C.AudioEmitter.NAME
      && edge.q === 'VolumeMultiplier')));
    return [target, smooth, ...harmonicVolumes];
  });
  const removalOracle = expectedRemoved.length === 72 ? expectedRemoved : reconstructed;
  assert.equal(removalOracle.length, 72);
  assert.deepEqual(removed.map(edgeId).sort(), removalOracle.map(edgeId).sort(),
    'only body target/smoothing and harmonic volume edges were rerouted');
  assert.equal(added.length, 1224, '68 new wires per lane');
  assert(added.every(edge => newKeys.has(edge.a) || newKeys.has(edge.z)),
    'each added wire touches a declared new gate');
  assert.deepEqual(scene.links, baseline.links);
  assert.deepEqual(scene.r.externalAssets(), baseline.r.externalAssets());
  assert.deepEqual(scene.r.prefabJson(), baseline.r.prefabJson());

  function profileMap(rootReference, resolvedSource, pianoCheck, label) {
    let current = brick(rootReference);
    const values = new Map();
    const checks = new Map();
    const seen = new Set();
    while (component(current, C.Expr_Select.NAME)) {
      assert(!seen.has(current.key), `${label} acyclic profile chain`);
      seen.add(current.key);
      const conditionEdge = input(current, C.Expr_Select.NAME, 'bSelectB',
        `${label} condition`);
      const condition = brick(conditionEdge.a);
      assert.equal(conditionEdge.at, C.Expr_CompareEqual.NAME);
      const data = component(condition, C.Expr_CompareEqual.NAME).data;
      const profile = scalar(data.InputB);
      assert(Number.isInteger(profile) && profile >= 1 && profile <= 7);
      const profileSource = input(condition, C.Expr_CompareEqual.NAME, 'InputA',
        `${label} resolved profile`);
      assert.equal(profileSource.a, brick(resolvedSource).key);
      assert.equal(incoming(current, C.Expr_Select.NAME, 'InputB').length, 0);
      values.set(profile, scalar(component(current, C.Expr_Select.NAME).data.InputB));
      checks.set(profile, condition.key);
      const prior = incoming(current, C.Expr_Select.NAME, 'InputA');
      if (!prior.length) break;
      current = brick(one(prior).a);
    }
    assert.deepEqual([...values.keys()].sort(), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(checks.get(1), brick(pianoCheck).key);
    return values;
  }

  function checkProfiles(values, field, layer, label) {
    for (let profile = 1; profile <= 7; profile++) {
      const expected = layer === undefined ? PROFILES[profile][field]
        : PROFILES[profile][field][layer];
      close(values.get(profile), expected, `${label} profile ${profile}`);
    }
  }

  const envelopeKeys = new Set();
  const emitterKeys = new Set();
  const musicalTimeKeys = new Set();
  const effectiveVolumeSources = new Set();
  for (const voice of [...patch.voices].sort((a, z) => a.voice - z.voice)) {
    const label = `voice ${voice.voice}`;
    const isPiano = brick(voice.isPiano, `${label} isPiano`);
    const pianoActive = brick(voice.pianoActive, `${label} pianoActive`);
    const noteActive = brick(voice.noteActive, `${label} noteActive`);
    const startHold = brick(voice.startHold, `${label} startHold`);
    const velocityHold = brick(voice.velocityHold, `${label} velocityHold`);
    const musicalTime = brick(voice.musicalTime, `${label} musicalTime`);
    const effectiveVolume = brick(voice.effectiveVolume, `${label} effectiveVolume`);
    musicalTimeKeys.add(musicalTime.key);

    assert(component(isPiano, C.Expr_CompareEqual.NAME));
    constant(isPiano, C.Expr_CompareEqual.NAME, 'InputB', 1, `${label} profile-one check`);
    assert(oldKeys.has(isPiano.key), `${label} reuses existing profile check`);
    const resolvedEdge = input(isPiano, C.Expr_CompareEqual.NAME, 'InputA',
      `${label} resolved profile`);
    const resolvedProfile = brick(resolvedEdge.a, `${label} resolved profile source`);

    assert(component(pianoActive, C.Expr_LogicalAND.NAME));
    wire(isPiano, C.Expr_CompareEqual.NAME, 'bOutput', pianoActive,
      C.Expr_LogicalAND.NAME, 'bInputA', `${label} piano activity profile`);
    wire(noteActive, C.Var.NAME, 'Value', pianoActive,
      C.Expr_LogicalAND.NAME, 'bInputB', `${label} piano activity note`);

    const ageClock = brick(voice.ageClock, `${label} age clock`);
    assert(component(ageClock, C.Expr_Select.NAME));
    wire(startHold, C.Var.NAME, 'Value', ageClock, C.Expr_Select.NAME, 'InputA',
      `${label} frozen age clock`);
    const liveClock = input(ageClock, C.Expr_Select.NAME, 'InputB', `${label} live age clock`);
    assert.equal(liveClock.a, musicalTime.key);
    assert.equal(liveClock.p, 'Output');
    wire(pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', ageClock,
      C.Expr_Select.NAME, 'bSelectB', `${label} age activity selector`);
    const ageSubtract = brick(voice.ageSubtract, `${label} age subtraction`);
    assert(component(ageSubtract, C.Expr_MathSubtract.NAME));
    wire(ageClock, C.Expr_Select.NAME, 'Output', ageSubtract,
      C.Expr_MathSubtract.NAME, 'InputA', `${label} age clock subtraction`);
    wire(startHold, C.Var.NAME, 'Value', ageSubtract,
      C.Expr_MathSubtract.NAME, 'InputB', `${label} note-start subtraction`);
    const age = brick(voice.age, `${label} age`);
    assert(component(age, C.Expr_MathMax.NAME));
    wire(ageSubtract, C.Expr_MathSubtract.NAME, 'Output', age,
      C.Expr_MathMax.NAME, 'InputA', `${label} nonnegative age`);
    constant(age, C.Expr_MathMax.NAME, 'InputB', 0, `${label} age floor`);

    const velocityRoot = brick(voice.velocityRoot, `${label} velocity root`);
    assert(component(velocityRoot, C.Expr_MathPow.NAME));
    wire(velocityHold, C.Var.NAME, 'Value', velocityRoot,
      C.Expr_MathPow.NAME, 'Input', `${label} velocity root source`);
    constant(velocityRoot, C.Expr_MathPow.NAME, 'Exponent', 0.5,
      `${label} velocity square root`);
    const velocitySum = brick(voice.velocitySum, `${label} velocity sum`);
    assert(component(velocitySum, C.Expr_MathAdd.NAME));
    wire(velocityHold, C.Var.NAME, 'Value', velocitySum,
      C.Expr_MathAdd.NAME, 'InputA', `${label} original velocity`);
    wire(velocityRoot, C.Expr_MathPow.NAME, 'Output', velocitySum,
      C.Expr_MathAdd.NAME, 'InputB', `${label} rooted velocity`);
    const shapedVelocity = brick(voice.shapedVelocity, `${label} shaped velocity`);
    assert(component(shapedVelocity, C.Expr_MathMultiply.NAME));
    wire(velocitySum, C.Expr_MathAdd.NAME, 'Output', shapedVelocity,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} velocity blend`);
    constant(shapedVelocity, C.Expr_MathMultiply.NAME, 'InputB', 0.5,
      `${label} velocity blend half`);

    const brightnessScale = brick(voice.brightnessScale, `${label} brightness scale`);
    assert(component(brightnessScale, C.Expr_MathMultiply.NAME));
    wire(shapedVelocity, C.Expr_MathMultiply.NAME, 'Output', brightnessScale,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} brightness velocity`);
    constant(brightnessScale, C.Expr_MathMultiply.NAME, 'InputB', 0.65,
      `${label} brightness scale`);
    const brightness = brick(voice.brightness, `${label} brightness`);
    assert(component(brightness, C.Expr_MathAdd.NAME));
    wire(brightnessScale, C.Expr_MathMultiply.NAME, 'Output', brightness,
      C.Expr_MathAdd.NAME, 'InputA', `${label} scaled brightness`);
    constant(brightness, C.Expr_MathAdd.NAME, 'InputB', 0.35,
      `${label} brightness floor`);
    const velocityBrightness = brick(voice.velocityBrightness,
      `${label} velocity brightness`);
    assert(component(velocityBrightness, C.Expr_MathMultiply.NAME));
    wire(shapedVelocity, C.Expr_MathMultiply.NAME, 'Output', velocityBrightness,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} harmonic velocity`);
    wire(brightness, C.Expr_MathAdd.NAME, 'Output', velocityBrightness,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} harmonic brightness`);

    const body = voice.body;
    const exponent = brick(body.exponent, `${label} body exponent`);
    assert(component(exponent, C.Expr_MathMultiply.NAME));
    wire(age, C.Expr_MathMax.NAME, 'Output', exponent,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} body age`);
    constant(exponent, C.Expr_MathMultiply.NAME, 'InputB', -1.6,
      `${label} body decay rate`);
    const decay = brick(body.decay, `${label} body decay`);
    assert(component(decay, C.Expr_MathExp.NAME));
    wire(exponent, C.Expr_MathMultiply.NAME, 'Output', decay,
      C.Expr_MathExp.NAME, 'Input', `${label} body exponential`);
    const scaled = brick(body.scaled, `${label} body decay scale`);
    assert(component(scaled, C.Expr_MathMultiply.NAME));
    wire(decay, C.Expr_MathExp.NAME, 'Output', scaled,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} body exponential output`);
    constant(scaled, C.Expr_MathMultiply.NAME, 'InputB', 0.65,
      `${label} body decay amount`);
    const curve = brick(body.curve, `${label} body curve`);
    assert(component(curve, C.Expr_MathAdd.NAME));
    wire(scaled, C.Expr_MathMultiply.NAME, 'Output', curve,
      C.Expr_MathAdd.NAME, 'InputA', `${label} body decay curve`);
    constant(curve, C.Expr_MathAdd.NAME, 'InputB', 0.35,
      `${label} body sustain floor`);
    const withVelocity = brick(body.withVelocity, `${label} body velocity`);
    assert(component(withVelocity, C.Expr_MathMultiply.NAME));
    wire(curve, C.Expr_MathAdd.NAME, 'Output', withVelocity,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} body curve source`);
    wire(shapedVelocity, C.Expr_MathMultiply.NAME, 'Output', withVelocity,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} body shaped velocity`);
    const active = brick(body.active, `${label} body active`);
    assert(component(active, C.Expr_Select.NAME));
    constant(active, C.Expr_Select.NAME, 'InputA', 0, `${label} inactive body`);
    wire(withVelocity, C.Expr_MathMultiply.NAME, 'Output', active,
      C.Expr_Select.NAME, 'InputB', `${label} active body target`);
    wire(pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', active,
      C.Expr_Select.NAME, 'bSelectB', `${label} piano-only body activity`);
    const bodyMaster = brick(body.master, `${label} body master`);
    assert(component(bodyMaster, C.Expr_MathMultiply.NAME));
    wire(active, C.Expr_Select.NAME, 'Output', bodyMaster,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} body master target`);
    const masterVolume = input(bodyMaster, C.Expr_MathMultiply.NAME, 'InputB',
      `${label} body effective volume`);
    assert.equal(masterVolume.a, effectiveVolume.key);
    const masterSignature = `${masterVolume.a}:${masterVolume.at}:${masterVolume.p}`;
    effectiveVolumeSources.add(masterSignature);

    const pianoSmooth = brick(body.pianoSmooth, `${label} body smoothing`);
    assert(component(pianoSmooth, C.Expr_Select.NAME));
    constant(pianoSmooth, C.Expr_Select.NAME, 'InputA', 0.07, `${label} body release`);
    constant(pianoSmooth, C.Expr_Select.NAME, 'InputB', 0.006, `${label} body attack`);
    wire(pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', pianoSmooth,
      C.Expr_Select.NAME, 'bSelectB', `${label} body smoothing activity`);

    const profileTarget = brick(body.profileTarget, `${label} profile target`);
    assert(component(profileTarget, C.Expr_Select.NAME));
    const legacyTarget = input(profileTarget, C.Expr_Select.NAME, 'InputA',
      `${label} legacy target`);
    assert.deepEqual({a: legacyTarget.a, at: legacyTarget.at, p: legacyTarget.p},
      normalizedSource(body.legacy.targetSource));
    wire(bodyMaster, C.Expr_MathMultiply.NAME, 'Output', profileTarget,
      C.Expr_Select.NAME, 'InputB', `${label} piano body target`);
    wire(isPiano, C.Expr_CompareEqual.NAME, 'bOutput', profileTarget,
      C.Expr_Select.NAME, 'bSelectB', `${label} body profile selector`);
    const profileSmooth = brick(body.profileSmooth, `${label} profile smoothing`);
    assert(component(profileSmooth, C.Expr_Select.NAME));
    const legacySmooth = input(profileSmooth, C.Expr_Select.NAME, 'InputA',
      `${label} legacy smoothing`);
    assert.deepEqual({a: legacySmooth.a, at: legacySmooth.at, p: legacySmooth.p},
      normalizedSource(body.legacy.smoothSource));
    wire(pianoSmooth, C.Expr_Select.NAME, 'Output', profileSmooth,
      C.Expr_Select.NAME, 'InputB', `${label} piano smoothing`);
    wire(isPiano, C.Expr_CompareEqual.NAME, 'bOutput', profileSmooth,
      C.Expr_Select.NAME, 'bSelectB', `${label} smoothing profile selector`);

    const envelope = brick(body.envelope, `${label} body envelope`);
    assert(component(envelope, C.Dampen.NAME));
    wire(profileTarget, C.Expr_Select.NAME, 'Output', envelope,
      C.Dampen.NAME, 'Target', `${label} selected body target`);
    wire(profileSmooth, C.Expr_Select.NAME, 'Output', envelope,
      C.Dampen.NAME, 'SmoothTime', `${label} selected body smoothing`);
    const bodyEmitter = brick(body.emitter, `${label} body emitter`);
    wire(envelope, C.Dampen.NAME, 'Value', bodyEmitter,
      C.AudioEmitter.NAME, 'VolumeMultiplier', `${label} body output`);
    envelopeKeys.add(envelope.key);
    emitterKeys.add(bodyEmitter.key);
    const smoothProfiles = profileMap(legacySmooth.a, resolvedProfile, isPiano,
      `${label} smoothing`);
    checkProfiles(smoothProfiles, 'smooth', undefined, `${label} smoothing`);

    const transientSmooth = brick(voice.transientSmooth, `${label} harmonic smoothing`);
    assert(component(transientSmooth, C.Expr_Select.NAME));
    constant(transientSmooth, C.Expr_Select.NAME, 'InputA', 0.05,
      `${label} harmonic release`);
    constant(transientSmooth, C.Expr_Select.NAME, 'InputB', 0.006,
      `${label} harmonic attack`);
    wire(pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', transientSmooth,
      C.Expr_Select.NAME, 'bSelectB', `${label} harmonic smoothing activity`);

    const bodyPitch = input(bodyEmitter, C.AudioEmitter.NAME, 'PitchMultiplier',
      `${label} body pitch`);
    const bodyEnable = input(bodyEmitter, C.AudioEmitter.NAME, 'bEnabled',
      `${label} body enable`);
    assert.equal(voice.harmonics.length, 2, `${label} two harmonic layers`);
    for (let layer = 0; layer < 2; layer++) {
      const harmonic = voice.harmonics[layer];
      const expected = layer === 0
        ? {ratio: 2, floor: 0.05, gain: 0.18, rate: -6}
        : {ratio: 3, floor: 0.015, gain: 0.05, rate: -8};
      for (const field of ['ratio', 'floor', 'gain', 'rate']) {
        close(harmonic[field], expected[field], `${label} H${layer + 2} ${field}`);
      }
      const harmonicExponent = brick(harmonic.exponent,
        `${label} H${layer + 2} exponent`);
      assert(component(harmonicExponent, C.Expr_MathMultiply.NAME));
      wire(age, C.Expr_MathMax.NAME, 'Output', harmonicExponent,
        C.Expr_MathMultiply.NAME, 'InputA', `${label} H${layer + 2} age`);
      constant(harmonicExponent, C.Expr_MathMultiply.NAME, 'InputB', expected.rate,
        `${label} H${layer + 2} rate`);
      const harmonicDecay = brick(harmonic.decay, `${label} H${layer + 2} decay`);
      assert(component(harmonicDecay, C.Expr_MathExp.NAME));
      wire(harmonicExponent, C.Expr_MathMultiply.NAME, 'Output', harmonicDecay,
        C.Expr_MathExp.NAME, 'Input', `${label} H${layer + 2} exponential`);
      const decayGain = brick(harmonic.decayGain, `${label} H${layer + 2} decay gain`);
      assert(component(decayGain, C.Expr_MathMultiply.NAME));
      wire(harmonicDecay, C.Expr_MathExp.NAME, 'Output', decayGain,
        C.Expr_MathMultiply.NAME, 'InputA', `${label} H${layer + 2} decay source`);
      constant(decayGain, C.Expr_MathMultiply.NAME, 'InputB', expected.gain,
        `${label} H${layer + 2} transient gain`);
      const harmonicCurve = brick(harmonic.curve, `${label} H${layer + 2} curve`);
      assert(component(harmonicCurve, C.Expr_MathAdd.NAME));
      wire(decayGain, C.Expr_MathMultiply.NAME, 'Output', harmonicCurve,
        C.Expr_MathAdd.NAME, 'InputA', `${label} H${layer + 2} decaying curve`);
      constant(harmonicCurve, C.Expr_MathAdd.NAME, 'InputB', expected.floor,
        `${label} H${layer + 2} sustain floor`);
      const harmonicVelocity = brick(harmonic.withVelocity,
        `${label} H${layer + 2} velocity`);
      assert(component(harmonicVelocity, C.Expr_MathMultiply.NAME));
      wire(harmonicCurve, C.Expr_MathAdd.NAME, 'Output', harmonicVelocity,
        C.Expr_MathMultiply.NAME, 'InputA', `${label} H${layer + 2} curve source`);
      wire(velocityBrightness, C.Expr_MathMultiply.NAME, 'Output', harmonicVelocity,
        C.Expr_MathMultiply.NAME, 'InputB', `${label} H${layer + 2} velocity brightness`);
      const harmonicActive = brick(harmonic.active, `${label} H${layer + 2} active`);
      assert(component(harmonicActive, C.Expr_Select.NAME));
      constant(harmonicActive, C.Expr_Select.NAME, 'InputA', 0,
        `${label} H${layer + 2} inactive target`);
      wire(harmonicVelocity, C.Expr_MathMultiply.NAME, 'Output', harmonicActive,
        C.Expr_Select.NAME, 'InputB', `${label} H${layer + 2} live target`);
      wire(pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', harmonicActive,
        C.Expr_Select.NAME, 'bSelectB', `${label} H${layer + 2} activity`);
      const harmonicMaster = brick(harmonic.master, `${label} H${layer + 2} master`);
      assert(component(harmonicMaster, C.Expr_MathMultiply.NAME));
      wire(harmonicActive, C.Expr_Select.NAME, 'Output', harmonicMaster,
        C.Expr_MathMultiply.NAME, 'InputA', `${label} H${layer + 2} master source`);
      const harmonicVolume = input(harmonicMaster, C.Expr_MathMultiply.NAME, 'InputB',
        `${label} H${layer + 2} effective volume`);
      assert.equal(`${harmonicVolume.a}:${harmonicVolume.at}:${harmonicVolume.p}`,
        masterSignature, `${label} H${layer + 2} master applied exactly once`);
      const harmonicEnvelope = brick(harmonic.envelope,
        `${label} H${layer + 2} envelope`);
      assert(component(harmonicEnvelope, C.Dampen.NAME));
      wire(harmonicMaster, C.Expr_MathMultiply.NAME, 'Output', harmonicEnvelope,
        C.Dampen.NAME, 'Target', `${label} H${layer + 2} envelope target`);
      wire(transientSmooth, C.Expr_Select.NAME, 'Output', harmonicEnvelope,
        C.Dampen.NAME, 'SmoothTime', `${label} H${layer + 2} envelope smoothing`);
      envelopeKeys.add(harmonicEnvelope.key);

      const legacyVolume = brick(harmonic.legacyVolumeSource.a,
        `${label} H${layer + 2} legacy volume`);
      assert(component(legacyVolume, C.Expr_MathMultiply.NAME));
      wire(envelope, C.Dampen.NAME, 'Value', legacyVolume,
        C.Expr_MathMultiply.NAME, 'InputA', `${label} H${layer + 2} legacy body envelope`);
      const legacyGain = input(legacyVolume, C.Expr_MathMultiply.NAME, 'InputB',
        `${label} H${layer + 2} legacy gain`);
      const gainProfiles = profileMap(legacyGain.a, resolvedProfile, isPiano,
        `${label} H${layer + 2} gain`);
      checkProfiles(gainProfiles, 'gains', layer, `${label} H${layer + 2} gain`);

      const volumeSelect = brick(harmonic.volumeSelect,
        `${label} H${layer + 2} volume selector`);
      assert(component(volumeSelect, C.Expr_Select.NAME));
      wire(legacyVolume, C.Expr_MathMultiply.NAME, 'Output', volumeSelect,
        C.Expr_Select.NAME, 'InputA', `${label} H${layer + 2} legacy volume path`);
      wire(harmonicEnvelope, C.Dampen.NAME, 'Value', volumeSelect,
        C.Expr_Select.NAME, 'InputB', `${label} H${layer + 2} piano volume path`);
      wire(isPiano, C.Expr_CompareEqual.NAME, 'bOutput', volumeSelect,
        C.Expr_Select.NAME, 'bSelectB', `${label} H${layer + 2} profile selection`);
      const emitter = brick(harmonic.emitter, `${label} H${layer + 2} emitter`);
      wire(volumeSelect, C.Expr_Select.NAME, 'Output', emitter,
        C.AudioEmitter.NAME, 'VolumeMultiplier', `${label} H${layer + 2} final volume`);
      const enable = input(emitter, C.AudioEmitter.NAME, 'bEnabled',
        `${label} H${layer + 2} enable`);
      assert.deepEqual([enable.a, enable.at, enable.p],
        [bodyEnable.a, bodyEnable.at, bodyEnable.p],
        `${label} H${layer + 2} keeps the audible release window`);
      emitterKeys.add(emitter.key);

      const pitchEdge = input(emitter, C.AudioEmitter.NAME, 'PitchMultiplier',
        `${label} H${layer + 2} pitch`);
      const pitchClamp = brick(pitchEdge.a, `${label} H${layer + 2} pitch clamp`);
      assert.equal(pitchEdge.at, C.Expr_MathClamp.NAME);
      assert.equal(pitchEdge.p, 'Output');
      constant(pitchClamp, C.Expr_MathClamp.NAME, 'Min', 0.1,
        `${label} H${layer + 2} pitch minimum`);
      constant(pitchClamp, C.Expr_MathClamp.NAME, 'Max', 4,
        `${label} H${layer + 2} pitch maximum`);
      const rawPitchEdge = input(pitchClamp, C.Expr_MathClamp.NAME, 'Input',
        `${label} H${layer + 2} raw pitch`);
      const rawPitch = brick(rawPitchEdge.a, `${label} H${layer + 2} raw pitch multiply`);
      assert.equal(rawPitchEdge.at, C.Expr_MathMultiply.NAME);
      const basePitch = input(rawPitch, C.Expr_MathMultiply.NAME, 'InputA',
        `${label} H${layer + 2} base pitch`);
      assert.deepEqual([basePitch.a, basePitch.at, basePitch.p],
        [bodyPitch.a, bodyPitch.at, bodyPitch.p],
        `${label} H${layer + 2} derives from fundamental pitch`);
      const ratioEdge = input(rawPitch, C.Expr_MathMultiply.NAME, 'InputB',
        `${label} H${layer + 2} ratio`);
      const ratioProfiles = profileMap(ratioEdge.a, resolvedProfile, isPiano,
        `${label} H${layer + 2} ratio`);
      checkProfiles(ratioProfiles, 'ratios', layer, `${label} H${layer + 2} ratio`);
      close(ratioProfiles.get(1), expected.ratio,
        `${label} H${layer + 2} exact piano harmonic`);
    }
  }

  assert.equal(musicalTimeKeys.size, 1, 'all lanes share the paused musical clock');
  assert.equal(effectiveVolumeSources.size, 1, 'all layers share one effective master volume');
  assert.equal(envelopeKeys.size, 54, 'three independent envelopes per lane');
  assert.equal(emitterKeys.size, 54, 'all 54 emitters covered once');
  assert.deepEqual([...envelopeKeys].sort(),
    bricksOf(scene, C.Dampen.NAME).map(candidate => candidate.key).sort());
  assert.deepEqual([...emitterKeys].sort(),
    bricksOf(scene, C.AudioEmitter.NAME).map(candidate => candidate.key).sort());

  // Exact retention of the score, user frame, transport and speaker settings.
  const arrays = value => bricksOf(value, C.ArrayVar.NAME)
    .map(candidate => component(candidate, C.ArrayVar.NAME).data.Value)
    .sort((a, z) => (a.$array?.length ?? 0) - (z.$array?.length ?? 0));
  assert.deepEqual(arrays(scene), arrays(baseline), 'staging and active scores retained');
  assert.deepEqual(scene.bricks.filter(candidate => candidate.g === 1),
    baseline.bricks.filter(candidate => candidate.g === 1), 'exact visible UI');
  assert.equal(bricksOf(scene, C.Exec_ArrayVar_CopyFrom.NAME).length, 2);
  assert.equal(bricksOf(scene, C.Exec_Entity_DestroySpawnedPrefab.NAME).length, 1);
  const eventNames = (value, type) => bricksOf(value, type)
    .map(candidate => component(candidate, type).data.EventName).sort();
  assert.deepEqual(eventNames(scene, C.Exec_SendCustomEventGlobal.NAME),
    eventNames(baseline, C.Exec_SendCustomEventGlobal.NAME));
  assert.deepEqual(eventNames(scene, C.Event_CustomGlobal.NAME),
    eventNames(baseline, C.Event_CustomGlobal.NAME));

  const assets = scene.r.externalAssets();
  for (const emitter of bricksOf(scene, C.AudioEmitter.NAME)) {
    const data = component(emitter, C.AudioEmitter.NAME).data;
    assert.deepEqual(assets[data.AudioDescriptor],
      {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'});
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier',
      'InnerRadius', 'MaxDistance', 'bSpatialization']) {
      assert.equal(incoming(emitter, C.AudioEmitter.NAME, port).length, 1,
        `${emitter.key}.${port}`);
    }
  }
  for (const [message, initial, port] of [
    ['SQM1CFG:Inner Radius', 400, 'InnerRadius'],
    ['SQM1CFG:Max Distance', 4000, 'MaxDistance'],
    ['SQM1CFG:Directional', false, 'bSpatialization'],
  ]) {
    const variable = one(scene.bricks.filter(candidate =>
      component(candidate, C.Interact.NAME)?.data.Message === message
        && component(candidate, C.Var.NAME)), message);
    assert.equal(scalar(component(variable, C.Var.NAME).data.Value), initial);
    const fanout = outgoing(variable, C.Var.NAME, 'Value')
      .filter(edge => edge.zt === C.AudioEmitter.NAME && edge.q === port);
    assert.equal(fanout.length, 54);
    assert.equal(new Set(fanout.map(edge => edge.z)).size, 54);
  }

  const clock = one(bricksOf(scene, C.Stopwatch.NAME), 'playback Stopwatch');
  assert.equal(component(clock, C.Stopwatch.NAME).data.bRunning, false,
    'idle clock remains saved paused');
  assert.equal(incoming(clock, C.Stopwatch.NAME, 'Resume').length, 1);
  assert.equal(incoming(clock, C.Stopwatch.NAME, 'Pause').length, 1);

  const targets = new Set();
  for (const edge of scene.edges) {
    const source = byKey.get(edge.a);
    const target = byKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at),
      `missing source ${edge.a}:${edge.at}`);
    assert(target?.comps.some(item => item.type === edge.zt),
      `missing target ${edge.z}:${edge.zt}`);
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `duplicate target ${targetId}`);
    targets.add(targetId);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `invalid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `invalid input ${edge.zt}.${edge.q}`);
  }

  const candidatePeak = velocity => {
    const shaped = 0.5 * (velocity + Math.sqrt(velocity));
    const brightness = 0.35 + 0.65 * shaped;
    return shaped + shaped * brightness * (0.23 + 0.065);
  };
  const currentPeak = velocity => velocity * 1.24;
  const soft = (48 / 127) ** 1.4;
  const hard = (120 / 127) ** 1.4;
  assert(candidatePeak(soft) > currentPeak(soft) * 1.3);
  assert(Math.abs(candidatePeak(hard) / currentPeak(hard) - 1) < 0.1);

  console.log('SQM1 piano player V4 checks passed: Tuned V2 formulas on eighteen gated lanes, '
    + 'piano-only targets, exact six-profile legacy paths, 54 independent envelopes, bounded '
    + 'pure-gate cost, exact UI/score/transport/spatial retention, idle pause, strict placement '
    + 'and valid unique wiring.');
  return {scene, baseline, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v4.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.equal(crypto.createHash('sha256').update(second.bytes).digest('hex'),
    crypto.createHash('sha256').update(first.bytes).digest('hex'),
  'V4 full-player build is byte-for-byte deterministic');
}
