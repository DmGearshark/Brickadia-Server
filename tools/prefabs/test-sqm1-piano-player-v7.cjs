'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const testV6 = require('./test-sqm1-piano-player-v6.cjs');

const V6_SHA256 = '43ea07f07eb11da2b6ccd536004c1b7d947a02fa6e9467a48eb31cacd024f4ae';
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

const sourceOf = edge => ({a: edge.a, at: edge.at, p: edge.p});

module.exports = function testSqm1PianoPlayerV7(context) {
  assert(context?.bytes && context?.scene && context?.outputScene
    && context?.v6Context && context?.pianoPatch && context?.releasePatch
    && context?.decayPatch && context?.singleSourcePatch, 'V7 builder context');

  testV6(context.v6Context);
  assert.equal(crypto.createHash('sha256').update(context.v6Context.bytes).digest('hex'),
    V6_SHA256, 'exact verified V6 baseline');

  const scene = context.scene;
  const baseline = context.v6Context.scene;
  const serialized = context.outputScene;
  const patch = context.singleSourcePatch;
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
  const baselineIncoming = (target, type, port) => {
    const key = typeof target === 'string' ? target : target.key;
    return baseline.edges.filter(edge => edge.z === key && edge.zt === type && edge.q === port);
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
  const literal = (target, type, port, expected, label) => {
    assert.equal(incoming(target, type, port).length, 0, `${label} is constant`);
    assert.equal(scalar(component(resolve(target), type).data[port]), expected, label);
  };
  const assertSource = (edge, expected, label) =>
    assert.deepEqual(sourceOf(edge), expected, label);

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  assert.equal(patch.voices.length, 18);
  assert.deepEqual(patch.voices.map(voice => voice.voice),
    Array.from({length: 18}, (_, voice) => voice), 'all eighteen ordered lanes');
  assert.equal(patch.addedBricks, 162, 'nine bass/body gates per lane');
  assert.equal(patch.removedBricks, 0, 'V7 retains every V6 brick');
  assert.equal(patch.removedEdges.length, 108, 'six intentional reroutes per lane');
  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized), dampens: bricksOf(serialized, C.Dampen.NAME).length,
    emitters: bricksOf(serialized, C.AudioEmitter.NAME).length},
  {bricks: 6058, edges: 10087, components: 6066, dampens: 54, emitters: 54},
  'exact V7 graph budget');
  assert.equal(bricksOf(serialized, C.OneShotAudioEmitter.NAME).length, 0);
  assert.equal(bricksOf(serialized, C.Stopwatch.NAME).length, 1);
  assert.equal(bricksOf(serialized, C.FunctionCall.NAME).length, 18);

  const declaredNew = new Set(patch.voices.flatMap(voice => [
    voice.bassDifference, voice.bassScaled, voice.bass, voice.slowGainScale,
    voice.slowGain, voice.fastGain, voice.slowRateScale, voice.slowRate, voice.bodySum,
  ].map(brick => brick.key)));
  assert.equal(declaredNew.size, 162);
  const newBricks = scene.bricks.filter(brick => !baselineByKey.has(brick.key));
  const newKeys = new Set(newBricks.map(brick => brick.key));
  assert.deepEqual([...newKeys].sort(), [...declaredNew].sort(),
    'only declared V7 gates are added');
  assert(newBricks.every(brick => brick.key.startsWith('sqm1p7:')
    && brick.g === patch.logicGrid && brick.comps.length === 1));
  const typeCounts = {};
  for (const brick of newBricks) {
    const type = brick.comps[0].type;
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    assert(scene.edges.some(edge => edge.a === brick.key), `orphan V7 gate ${brick.key}`);
  }
  assert.deepEqual(typeCounts, {
    [C.Expr_MathSubtract.NAME]: 36,
    [C.Expr_MathMultiply.NAME]: 54,
    [C.Expr_MathClamp.NAME]: 18,
    [C.Expr_MathAdd.NAME]: 54,
  }, 'exact V7 pure-gate allocation');

  const modifiedKeys = new Set();
  for (const voice of patch.voices) {
    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2),
      `voice ${voice.voice} H2`);
    modifiedKeys.add(h2.decayGain.key);
    modifiedKeys.add(h2.active.key);
    modifiedKeys.add(h2.master.key);
  }
  assert.equal(modifiedKeys.size, 54, 'three declared Piano bricks modified per lane');
  for (const [key, before] of baselineByKey) {
    const after = byKey.get(key);
    assert(after, `retained V6 brick ${key}`);
    if (modifiedKeys.has(key)) continue;
    assert.deepEqual(after, before, `changed unrelated V6 brick ${key}`);
  }
  const assertOnlyPortChanged = (brick, type, port, beforeValue, afterValue, label) => {
    const before = structuredClone(baselineByKey.get(brick.key));
    const after = structuredClone(resolve(brick));
    const beforeComponent = component(before, type);
    const afterComponent = component(after, type);
    close(scalar(beforeComponent.data[port]), beforeValue, `${label} V6 value`);
    close(scalar(afterComponent.data[port]), afterValue, `${label} V7 value`);
    afterComponent.data[port] = beforeComponent.data[port];
    assert.deepEqual(after, before, `${label} only ${port} changed`);
  };
  const assertOnlyFieldAdded = (brick, type, port, expected, label) => {
    const before = structuredClone(baselineByKey.get(brick.key));
    const after = structuredClone(resolve(brick));
    const beforeData = component(before, type).data;
    const afterData = component(after, type).data;
    assert(!Object.hasOwn(beforeData, port), `${label} V6 ${port} absent`);
    assert.equal(scalar(afterData[port]), expected, `${label} V7 ${port}`);
    delete afterData[port];
    assert.deepEqual(after, before, `${label} only adds ${port}`);
  };

  const expectedRemoved = [];
  const expectedAdded = [];
  const bodyEmitters = new Set();
  const partialEmitters = new Set();
  const rawPitchKeys = new Set();
  for (const voice of patch.voices) {
    const label = `voice ${voice.voice}`;
    const pianoVoice = context.decayPatch.voices[voice.voice];
    const releaseVoice = context.releasePatch.voices[voice.voice];
    assert.equal(pianoVoice.voice, voice.voice);
    assert.equal(releaseVoice.voice, voice.voice);

    assert(component(resolve(voice.pitchHold), C.Var.NAME), `${label} raw pitch Var`);
    assert.deepEqual(resolve(voice.pitchHold), baselineByKey.get(voice.pitchHold.key),
      `${label} raw pitch Var retained exactly`);
    rawPitchKeys.add(voice.pitchHold.key);
    wire(voice.pitchHold, C.Var.NAME, 'Value', voice.bassDifference,
      C.Expr_MathSubtract.NAME, 'InputB', `${label} raw pitch to bass weight`);
    constant(voice.bassDifference, C.Expr_MathSubtract.NAME, 'InputA', 0.75,
      `${label} bass pitch threshold`);
    wire(voice.bassDifference, C.Expr_MathSubtract.NAME, 'Output', voice.bassScaled,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} bass difference`);
    constant(voice.bassScaled, C.Expr_MathMultiply.NAME, 'InputB', 2,
      `${label} bass scale`);
    wire(voice.bassScaled, C.Expr_MathMultiply.NAME, 'Output', voice.bass,
      C.Expr_MathClamp.NAME, 'Input', `${label} bass clamp input`);
    constant(voice.bass, C.Expr_MathClamp.NAME, 'Min', 0, `${label} bass minimum`);
    constant(voice.bass, C.Expr_MathClamp.NAME, 'Max', 1, `${label} bass maximum`);

    wire(voice.bass, C.Expr_MathClamp.NAME, 'Output', voice.slowGainScale,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} bass slow-gain input`);
    constant(voice.slowGainScale, C.Expr_MathMultiply.NAME, 'InputB', 0.05,
      `${label} slow-gain range`);
    constant(voice.slowGain, C.Expr_MathAdd.NAME, 'InputA', 0.25,
      `${label} slow-gain base`);
    wire(voice.slowGainScale, C.Expr_MathMultiply.NAME, 'Output', voice.slowGain,
      C.Expr_MathAdd.NAME, 'InputB', `${label} slow-gain adjustment`);
    constant(voice.fastGain, C.Expr_MathSubtract.NAME, 'InputA', 1,
      `${label} normalized gain total`);
    wire(voice.slowGain, C.Expr_MathAdd.NAME, 'Output', voice.fastGain,
      C.Expr_MathSubtract.NAME, 'InputB', `${label} complementary fast gain`);

    wire(voice.bass, C.Expr_MathClamp.NAME, 'Output', voice.slowRateScale,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} bass slow-rate input`);
    constant(voice.slowRateScale, C.Expr_MathMultiply.NAME, 'InputB', 0.15,
      `${label} slow-rate range`);
    constant(voice.slowRate, C.Expr_MathAdd.NAME, 'InputA', -0.5,
      `${label} slow-rate base`);
    wire(voice.slowRateScale, C.Expr_MathMultiply.NAME, 'Output', voice.slowRate,
      C.Expr_MathAdd.NAME, 'InputB', `${label} slow-rate adjustment`);

    wire(voice.fastGain, C.Expr_MathSubtract.NAME, 'Output', voice.body.scaled,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} dynamic fast gain`);
    wire(voice.slowGain, C.Expr_MathAdd.NAME, 'Output', voice.body.slowScaled,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} dynamic slow gain`);
    wire(voice.slowRate, C.Expr_MathAdd.NAME, 'Output', voice.body.slowExponent,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} dynamic slow rate`);

    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2), `${label} H2`);
    const h3 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 3), `${label} H3`);
    assertOnlyPortChanged(h2.decayGain, C.Expr_MathMultiply.NAME, 'InputB',
      0.23, 0.30, `${label} folded attack gain`);
    wire(voice.body.withVelocity, C.Expr_MathMultiply.NAME, 'Output', voice.bodySum,
      C.Expr_MathAdd.NAME, 'InputA', `${label} decaying base body`);
    wire(h2.withVelocity, C.Expr_MathMultiply.NAME, 'Output', voice.bodySum,
      C.Expr_MathAdd.NAME, 'InputB', `${label} folded H2 strike`);
    wire(voice.bodySum, C.Expr_MathAdd.NAME, 'Output', voice.body.active,
      C.Expr_Select.NAME, 'InputB', `${label} single audible body target`);

    wire(releaseVoice.enableSelect, C.Expr_Select.NAME, 'Output', voice.body.emitter,
      C.AudioEmitter.NAME, 'bEnabled', `${label} retained body enable`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', releaseVoice.enableSelect,
      C.Expr_Select.NAME, 'bSelectB', `${label} V5 enable profile polarity`);
    assertSource(input(releaseVoice.enableSelect, C.Expr_Select.NAME, 'InputA',
      `${label} legacy enable window`), releaseVoice.audibleWindow,
    `${label} exact non-Piano enable source`);
    wire(releaseVoice.pianoWindow, C.Expr_LogicalAND.NAME, 'bOutput',
      releaseVoice.enableSelect, C.Expr_Select.NAME, 'InputB',
      `${label} V5 guarded Piano window`);

    assert.equal(voice.partialEnable.key, h2.active.key, `${label} reuses H2 active Select`);
    assertOnlyFieldAdded(h2.active, C.Expr_Select.NAME, 'InputB', false,
      `${label} partial false branch`);
    assertOnlyFieldAdded(h2.master, C.Expr_MathMultiply.NAME, 'InputA', 0,
      `${label} disabled Piano H2 master`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', voice.partialEnable,
      C.Expr_Select.NAME, 'bSelectB', `${label} partial Piano selector`);
    wire(releaseVoice.enableSelect, C.Expr_Select.NAME, 'Output', voice.partialEnable,
      C.Expr_Select.NAME, 'InputA', `${label} exact non-Piano partial enable`);
    literal(voice.partialEnable, C.Expr_Select.NAME, 'InputB', false,
      `${label} Piano partials disabled`);
    constant(h2.master, C.Expr_MathMultiply.NAME, 'InputA', 0,
      `${label} old Piano H2 volume path disabled`);
    for (const harmonic of [h2, h3]) {
      wire(voice.partialEnable, C.Expr_Select.NAME, 'Output', harmonic.emitter,
        C.AudioEmitter.NAME, 'bEnabled', `${label} H${harmonic.ratio} disabled in Piano`);
      partialEmitters.add(harmonic.emitter.key);
    }
    assert.deepEqual(scene.edges.filter(edge => edge.a === voice.partialEnable.key
      && edge.at === C.Expr_Select.NAME && edge.p === 'Output').map(edge => edge.z).sort(),
    [h2.emitter.key, h3.emitter.key].sort(), `${label} partial selector only enables emitters`);
    bodyEmitters.add(voice.body.emitter.key);

    const oldBody = one(baselineIncoming(voice.body.active, C.Expr_Select.NAME, 'InputB'),
      `${label} V6 body input`);
    const oldCondition = one(baselineIncoming(h2.active, C.Expr_Select.NAME, 'bSelectB'),
      `${label} V6 H2 activity condition`);
    const oldValue = one(baselineIncoming(h2.active, C.Expr_Select.NAME, 'InputB'),
      `${label} V6 H2 activity value`);
    const oldOutput = one(baseline.edges.filter(edge => edge.a === h2.active.key
      && edge.at === C.Expr_Select.NAME && edge.p === 'Output'),
    `${label} V6 H2 activity output`);
    const oldEnables = [h2, h3].map(harmonic => one(baselineIncoming(harmonic.emitter,
      C.AudioEmitter.NAME, 'bEnabled'), `${label} V6 H${harmonic.ratio} enable`));
    assertSource(oldCondition, voice.legacyPartialConditionSource,
      `${label} reported old H2 condition`);
    assertSource(oldValue, voice.legacyPartialValueSource, `${label} reported old H2 value`);
    assert.equal(edgeId(oldOutput), edgeId(voice.legacyPartialOutput),
      `${label} reported old H2 output`);
    expectedRemoved.push(oldBody, oldCondition, oldValue, oldOutput, ...oldEnables);

    expectedAdded.push(
      {a: voice.pitchHold.key, at: C.Var.NAME, p: 'Value', z: voice.bassDifference.key,
        zt: C.Expr_MathSubtract.NAME, q: 'InputB'},
      {a: voice.bassDifference.key, at: C.Expr_MathSubtract.NAME, p: 'Output',
        z: voice.bassScaled.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'},
      {a: voice.bassScaled.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.bass.key, zt: C.Expr_MathClamp.NAME, q: 'Input'},
      {a: voice.bass.key, at: C.Expr_MathClamp.NAME, p: 'Output',
        z: voice.slowGainScale.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'},
      {a: voice.slowGainScale.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.slowGain.key, zt: C.Expr_MathAdd.NAME, q: 'InputB'},
      {a: voice.slowGain.key, at: C.Expr_MathAdd.NAME, p: 'Output',
        z: voice.fastGain.key, zt: C.Expr_MathSubtract.NAME, q: 'InputB'},
      {a: voice.bass.key, at: C.Expr_MathClamp.NAME, p: 'Output',
        z: voice.slowRateScale.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'},
      {a: voice.slowRateScale.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.slowRate.key, zt: C.Expr_MathAdd.NAME, q: 'InputB'},
      {a: voice.fastGain.key, at: C.Expr_MathSubtract.NAME, p: 'Output',
        z: voice.body.scaled.key, zt: C.Expr_MathMultiply.NAME, q: 'InputB'},
      {a: voice.slowGain.key, at: C.Expr_MathAdd.NAME, p: 'Output',
        z: voice.body.slowScaled.key, zt: C.Expr_MathMultiply.NAME, q: 'InputB'},
      {a: voice.slowRate.key, at: C.Expr_MathAdd.NAME, p: 'Output',
        z: voice.body.slowExponent.key, zt: C.Expr_MathMultiply.NAME, q: 'InputB'},
      {a: voice.body.withVelocity.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.bodySum.key, zt: C.Expr_MathAdd.NAME, q: 'InputA'},
      {a: h2.withVelocity.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
        z: voice.bodySum.key, zt: C.Expr_MathAdd.NAME, q: 'InputB'},
      {a: voice.bodySum.key, at: C.Expr_MathAdd.NAME, p: 'Output',
        z: voice.body.active.key, zt: C.Expr_Select.NAME, q: 'InputB'},
      {a: pianoVoice.isPiano.key, at: C.Expr_CompareEqual.NAME, p: 'bOutput',
        z: voice.partialEnable.key, zt: C.Expr_Select.NAME, q: 'bSelectB'},
      {a: releaseVoice.enableSelect.key, at: C.Expr_Select.NAME, p: 'Output',
        z: voice.partialEnable.key, zt: C.Expr_Select.NAME, q: 'InputA'},
      ...[h2, h3].map(harmonic => ({a: voice.partialEnable.key,
        at: C.Expr_Select.NAME, p: 'Output', z: harmonic.emitter.key,
        zt: C.AudioEmitter.NAME, q: 'bEnabled'})),
    );
  }
  assert.equal(rawPitchKeys.size, 18, 'eighteen distinct raw pitch Vars retained');
  assert.equal(bodyEmitters.size, 18, 'eighteen Piano body sources');
  assert.equal(partialEmitters.size, 36, 'thirty-six partial sources forced off in Piano');
  assert.equal(new Set([...bodyEmitters, ...partialEmitters]).size, 54,
    'all continuous emitters are classified');

  const beforeEdges = new Set(baseline.edges.map(edgeId));
  const afterEdges = new Set(scene.edges.map(edgeId));
  const removedEdges = baseline.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  assert.equal(removedEdges.length, 108);
  assert.equal(addedEdges.length, 324);
  assert.deepEqual(removedEdges.map(edgeId).sort(), expectedRemoved.map(edgeId).sort(),
    'only body folding and reused partial-selector routes are removed');
  assert.deepEqual(patch.removedEdges.map(edgeId).sort(), expectedRemoved.map(edgeId).sort(),
    'patch reports the exact removed routes');
  assert.deepEqual(addedEdges.map(edgeId).sort(), expectedAdded.map(edgeId).sort(),
    'only declared bass-body and single-source routes are added');

  for (const emitterKey of [...bodyEmitters, ...partialEmitters]) {
    for (const port of ['VolumeMultiplier', 'PitchMultiplier']) {
      const before = one(baselineIncoming(emitterKey, C.AudioEmitter.NAME, port),
        `${emitterKey} V6 ${port}`);
      const after = one(scene.edges.filter(edge => edge.z === emitterKey
        && edge.zt === C.AudioEmitter.NAME && edge.q === port),
      `${emitterKey} V7 ${port}`);
      assert.equal(edgeId(after), edgeId(before), `${emitterKey} exact ${port} route`);
    }
  }

  const bassForPitch = pitch => Math.max(0, Math.min(1, (0.75 - pitch) * 2));
  const bodyAt = (bass, age, shaped = 1, brightness = 1) => {
    const slowGain = 0.25 + 0.05 * bass;
    const fastGain = 1 - slowGain;
    const slowRate = -0.5 + 0.15 * bass;
    const base = fastGain * Math.exp(-4 * age) + slowGain * Math.exp(slowRate * age);
    const attack = 0.30 * brightness * Math.exp(-6 * age);
    return shaped * (base + attack);
  };
  assert.deepEqual([bassForPitch(1), bassForPitch(0.75), bassForPitch(0.5),
    bassForPitch(0.25), bassForPitch(0)], [0, 0, 0.5, 1, 1],
  'raw pitch maps continuously into the exact clamped bass weight');
  const table = new Map([
    [0, [1.3, 0.905190881480116, 0.31113777870566994, 0.1661130197477089,
      0.09222330052749347, 0.06580682723795828, 0.02052125120186799]],
    [0.5, [1.3, 0.9141829022223069, 0.33540828784530285, 0.1938091547580402,
      0.11778415995483517, 0.08842989226480528, 0.03284406776771235]],
    [1, [1.3, 0.9235491479304254, 0.36150792500675033, 0.22497099979072788,
      0.1492122582406606, 0.11785079561886677, 0.05213218447796915]],
  ]);
  const ages = [0, 0.1, 0.5, 1, 2, 2.67, 5];
  for (const [bass, expected] of table) ages.forEach((age, index) =>
    close(bodyAt(bass, age), expected[index], `body at bass ${bass}, age ${age}`));
  for (const bass of [0, 0.5, 1]) for (const [shaped, brightness] of [
    [0.2, 0.35], [0.7, 0.8], [1, 1],
  ]) close(bodyAt(bass, 0, shaped, brightness), shaped * (1 + 0.30 * brightness),
  `exact onset for bass ${bass}, shaped ${shaped}, brightness ${brightness}`);
  for (const bass of [0, 0.5, 1]) {
    for (let index = 1; index < ages.length; index++) {
      assert(bodyAt(bass, ages[index]) < bodyAt(bass, ages[index - 1]),
        `bass ${bass} body decays through ${ages[index]}s`);
    }
    assert(bodyAt(bass, 100) < 1e-8, `bass ${bass} tail tends to zero without a floor`);
  }

  for (const prefix of ['sqm1p5:', 'sqm1p6:']) {
    const keys = [...byKey.keys()].filter(key => key.startsWith(prefix));
    assert(keys.length > 0, `${prefix} graph present`);
    for (const key of keys) assert.deepEqual(byKey.get(key), baselineByKey.get(key),
      `${prefix} brick retained exactly`);
  }
  assert.deepEqual(scene.bricks.filter(brick => brick.g === 1),
    baseline.bricks.filter(brick => brick.g === 1), 'exact user UI');
  assert.deepEqual(scene.links, baseline.links);
  assert.deepEqual(scene.r.externalAssets(), baseline.r.externalAssets());
  assert.deepEqual(scene.r.prefabJson(), baseline.r.prefabJson());
  const arrays = value => bricksOf(value, C.ArrayVar.NAME)
    .map(brick => [brick.key, component(brick, C.ArrayVar.NAME).data.Value])
    .sort((a, z) => a[0].localeCompare(z[0]));
  assert.deepEqual(arrays(scene), arrays(baseline), 'exact score and cartridge arrays');
  assert.equal(bricksOf(scene, C.Exec_ArrayVar_CopyFrom.NAME).length, 2);
  assert.equal(bricksOf(scene, C.Exec_Entity_DestroySpawnedPrefab.NAME).length, 1);

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

  console.log('SQM1 piano player V7 checks passed: exact V6 baseline, raw-pitch bass decay, '
    + 'folded hard strike, eighteen-source Piano ceiling, disabled Piano partials, exact '
    + 'non-Piano volume/pitch/enable semantics, V5 release/post-roll and UI/scheduler/cartridge '
    + 'retention, strict placement and deterministic valid wiring.');
  return {scene, baseline, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v7.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.equal(crypto.createHash('sha256').update(second.bytes).digest('hex'),
    crypto.createHash('sha256').update(first.bytes).digest('hex'),
  'V7 full-player build is byte-for-byte deterministic');
}
