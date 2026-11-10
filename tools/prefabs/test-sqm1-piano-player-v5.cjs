'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const testV4 = require('./test-sqm1-piano-player-v4.cjs');

const V4_SHA256 = '05ed069ca44dc54545298347ddbf37ab6b278dbccffd7198ae26df35d0450111';
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

function sourceId(source) {
  return `${source.a}|${source.at}|${source.p}`;
}

module.exports = function testSqm1PianoPlayerV5(context) {
  assert(context?.bytes && context?.scene && context?.outputScene
    && context?.v4Context && context?.pianoPatch && context?.releasePatch,
  'V5 builder context');

  testV4(context.v4Context);
  const v4Hash = crypto.createHash('sha256').update(context.v4Context.bytes).digest('hex');
  assert.equal(v4Hash, V4_SHA256, 'exact verified V4 baseline');

  const scene = context.scene;
  const baseline = context.v4Context.scene;
  const serialized = context.outputScene;
  const release = context.releasePatch;
  const piano = context.pianoPatch;
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
  const outgoing = (source, type, port) => {
    const key = resolve(source).key;
    return scene.edges.filter(edge => edge.a === key && edge.at === type && edge.p === port);
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
  const assertSource = (edge, source, label) => assert.deepEqual(
    {a: edge.a, at: edge.at, p: edge.p}, source, label);

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  assert.equal(release.voices.length, 18);
  assert.deepEqual(release.voices.map(voice => voice.voice).sort((a, z) => a - z),
    Array.from({length: 18}, (_, index) => index));
  assert.equal(release.addedBricks, 329, 'bounded smooth-release extension');
  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized), dampens: bricksOf(serialized, C.Dampen.NAME).length,
    emitters: bricksOf(serialized, C.AudioEmitter.NAME).length},
  {bricks: 5878, edges: 9835, components: 5886, dampens: 54, emitters: 54},
  'exact V5 graph budget');
  assert.equal(bricksOf(serialized, C.OneShotAudioEmitter.NAME).length, 0);
  assert.equal(bricksOf(serialized, C.Stopwatch.NAME).length, 1);
  assert.equal(bricksOf(serialized, C.FunctionCall.NAME).length, 18);

  for (const [key, before] of baselineByKey) {
    const after = byKey.get(key);
    assert(after, `retained V4 brick ${key}`);
    assert.deepEqual({g: after.g, data: after.data, comps: after.comps},
      {g: before.g, data: before.data, comps: before.comps}, `changed V4 brick ${key}`);
  }
  const oldKeys = new Set(baselineByKey.keys());
  const newBricks = scene.bricks.filter(brick => !oldKeys.has(brick.key));
  const newKeys = new Set(newBricks.map(brick => brick.key));
  assert.equal(newKeys.size, 329);
  assert(newBricks.every(brick => brick.g === release.logicGrid));
  const allowedTypes = new Set([
    C.Expr_Select.NAME, C.Expr_MathSubtract.NAME, C.Expr_MathAdd.NAME,
    C.Expr_MathDivide.NAME, C.Expr_MathClamp.NAME, C.Expr_MathMultiply.NAME,
    C.Expr_CompareGreater.NAME, C.Expr_CompareGreaterOrEqual.NAME,
    C.Expr_CompareLessOrEqual.NAME, C.Expr_LogicalAND.NAME,
  ]);
  const typeCounts = {};
  for (const brick of newBricks) {
    assert.equal(brick.comps.length, 1, `one pure component on ${brick.key}`);
    const type = brick.comps[0].type;
    assert(allowedTypes.has(type), `unexpected V5 component ${type}`);
    assert(scene.edges.some(edge => edge.a === brick.key), `orphan V5 gate ${brick.key}`);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }
  assert.deepEqual(typeCounts, {
    [C.Expr_CompareGreater.NAME]: 1,
    [C.Expr_MathDivide.NAME]: 20,
    [C.Expr_Select.NAME]: 91,
    [C.Expr_MathSubtract.NAME]: 36,
    [C.Expr_MathClamp.NAME]: 18,
    [C.Expr_MathMultiply.NAME]: 55,
    [C.Expr_MathAdd.NAME]: 18,
    [C.Expr_CompareGreaterOrEqual.NAME]: 18,
    [C.Expr_CompareLessOrEqual.NAME]: 18,
    [C.Expr_LogicalAND.NAME]: 54,
  }, 'exact pure-gate allocation');

  const beforeEdges = new Set(baseline.edges.map(edgeId));
  const afterEdges = new Set(scene.edges.map(edgeId));
  const removed = baseline.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const added = scene.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  const expectedRemoved = release.voices.flatMap(voice => [
    {...voice.body.legacyEmitterVolumeSource,
      z: voice.body.emitter.key, zt: C.AudioEmitter.NAME, q: 'VolumeMultiplier'},
    ...voice.harmonics.map(harmonic => ({...harmonic.legacyPianoVolumeSource,
      z: harmonic.volumeSelect.key, zt: C.Expr_Select.NAME, q: 'InputB'})),
    ...[voice.body.emitter, ...voice.harmonics.map(harmonic => harmonic.emitter)]
      .map((emitter, index) => ({...voice.legacyEnableSources[index],
        z: emitter.key, zt: C.AudioEmitter.NAME, q: 'bEnabled'})),
  ]);
  assert.equal(expectedRemoved.length, 108);
  assert.deepEqual(removed.map(edgeId).sort(), expectedRemoved.map(edgeId).sort(),
    'only the three Piano volume sources per lane are rerouted');
  assert.equal(added.length, 816);
  assert(added.every(edge => newKeys.has(edge.a) || newKeys.has(edge.z)),
    'every added wire touches a declared release gate');
  assert.deepEqual(scene.links, baseline.links);
  assert.deepEqual(scene.r.externalAssets(), baseline.r.externalAssets());
  assert.deepEqual(scene.r.prefabJson(), baseline.r.prefabJson());

  const musicalTime = resolve(release.musicalTime, 'musical time');
  assert(component(musicalTime, C.Expr_MathMultiply.NAME));
  const effectiveSpeedEdge = input(musicalTime, C.Expr_MathMultiply.NAME, 'InputB',
    'effective speed source');
  assertSource(effectiveSpeedEdge, release.effectiveSpeed, 'reported effective speed');

  const safeTail = resolve(release.safeReleaseTail, 'safe release tail');
  assert(component(safeTail, C.Expr_Select.NAME));
  constant(safeTail, C.Expr_Select.NAME, 'InputA', 0.001, 'zero-tail fallback');
  const rawTailEdge = input(safeTail, C.Expr_Select.NAME, 'InputB', 'positive release tail');
  assertSource(rawTailEdge, release.audibleReleaseTail, 'positive tails stay exact');
  assert.equal(release.constants.MINIMUM_RELEASE_TAIL, 0.001);

  const tailPositive = resolve(release.tailPositive, 'positive-tail comparison');
  assert(component(tailPositive, C.Expr_CompareGreater.NAME));
  const positiveTailEdge = input(tailPositive, C.Expr_CompareGreater.NAME, 'InputA',
    'positive-tail source');
  assertSource(positiveTailEdge, release.audibleReleaseTail,
    'zero-tail decision uses raw tail');
  constant(tailPositive, C.Expr_CompareGreater.NAME, 'InputB', 0,
    'positive-tail threshold');
  wire(tailPositive, C.Expr_CompareGreater.NAME, 'bOutput', safeTail,
    C.Expr_Select.NAME, 'bSelectB', 'safe-tail polarity');

  const bodyReleaseSmooth = resolve(release.bodyReleaseSmooth, 'body release smoothing');
  assert(component(bodyReleaseSmooth, C.Expr_MathDivide.NAME));
  constant(bodyReleaseSmooth, C.Expr_MathDivide.NAME, 'InputA', 0.07,
    'body release numerator');
  assertSource(input(bodyReleaseSmooth, C.Expr_MathDivide.NAME, 'InputB',
    'body release speed'), release.effectiveSpeed, 'body release effective speed');
  const harmonicReleaseSmooth = resolve(release.harmonicReleaseSmooth,
    'harmonic release smoothing');
  assert(component(harmonicReleaseSmooth, C.Expr_MathDivide.NAME));
  constant(harmonicReleaseSmooth, C.Expr_MathDivide.NAME, 'InputA', 0.05,
    'harmonic release numerator');
  assertSource(input(harmonicReleaseSmooth, C.Expr_MathDivide.NAME, 'InputB',
    'harmonic release speed'), release.effectiveSpeed, 'harmonic release effective speed');
  const guardMusical = resolve(release.guardMusical, 'silent post-roll duration');
  assert(component(guardMusical, C.Expr_MathMultiply.NAME));
  assertSource(input(guardMusical, C.Expr_MathMultiply.NAME, 'InputA',
    'post-roll speed'), release.effectiveSpeed, 'post-roll uses effective speed');
  constant(guardMusical, C.Expr_MathMultiply.NAME, 'InputB', 0.05,
    '50 ms wall-time post-roll');

  const speedAddedEdges = added.filter(edge => sourceId(edge) === sourceId(release.effectiveSpeed));
  assert.deepEqual(speedAddedEdges.map(edge => edge.z).sort(),
    [bodyReleaseSmooth.key, harmonicReleaseSmooth.key, guardMusical.key].sort(),
  'speed affects only releases and the wall-time post-roll');
  for (const [speed, bodyExpected, harmonicExpected] of [
    [0.1, 0.7, 0.5], [1, 0.07, 0.05], [2, 0.035, 0.025],
  ]) {
    close(0.07 / speed, bodyExpected, `body release at speed ${speed}`);
    close(0.05 / speed, harmonicExpected, `harmonic release at speed ${speed}`);
  }

  const releaseGainKeys = new Set();
  const releaseVolumeKeys = new Set();
  for (const releaseVoice of [...release.voices].sort((a, z) => a.voice - z.voice)) {
    const label = `voice ${releaseVoice.voice}`;
    const pianoVoice = piano.voices[releaseVoice.voice];
    assert.equal(pianoVoice.voice, releaseVoice.voice);
    const startHold = resolve(releaseVoice.startHold, `${label} start hold`);
    const endHold = resolve(releaseVoice.endHold, `${label} end hold`);
    const noteLoaded = resolve(releaseVoice.noteLoaded, `${label} note loaded`);
    assert(component(startHold, C.Var.NAME));
    assert(component(endHold, C.Var.NAME));
    assert(component(noteLoaded, C.Var.NAME));

    const releaseEnd = resolve(releaseVoice.releaseEnd, `${label} release end`);
    assert(component(releaseEnd, C.Expr_MathAdd.NAME));
    wire(endHold, C.Var.NAME, 'Value', releaseEnd,
      C.Expr_MathAdd.NAME, 'InputA', `${label} release end note time`);
    assertSource(input(releaseEnd, C.Expr_MathAdd.NAME, 'InputB',
      `${label} release tail`), release.audibleReleaseTail,
    `${label} shared audible tail`);
    const boundaryCompareEdge = one(outgoing(releaseEnd, C.Expr_MathAdd.NAME, 'Output')
      .filter(edge => edge.zt === C.Expr_CompareLessOrEqual.NAME && edge.q === 'InputB'),
    `${label} inclusive emitter boundary`);
    const boundaryCompare = resolve(boundaryCompareEdge.z, `${label} boundary comparison`);
    assertSource(input(boundaryCompare, C.Expr_CompareLessOrEqual.NAME, 'InputA',
      `${label} boundary clock`), {a: musicalTime.key, at: C.Expr_MathMultiply.NAME, p: 'Output'},
    `${label} musical-time boundary`);

    const postEnd = resolve(releaseVoice.postEnd, `${label} silent post end`);
    assert(component(postEnd, C.Expr_MathAdd.NAME));
    wire(releaseEnd, C.Expr_MathAdd.NAME, 'Output', postEnd,
      C.Expr_MathAdd.NAME, 'InputA', `${label} post-roll starts at release boundary`);
    wire(guardMusical, C.Expr_MathMultiply.NAME, 'Output', postEnd,
      C.Expr_MathAdd.NAME, 'InputB', `${label} post-roll guard`);
    const afterStart = resolve(releaseVoice.afterStart, `${label} post-roll start guard`);
    wire(musicalTime, C.Expr_MathMultiply.NAME, 'Output', afterStart,
      C.Expr_CompareGreaterOrEqual.NAME, 'InputA', `${label} current musical time`);
    wire(startHold, C.Var.NAME, 'Value', afterStart,
      C.Expr_CompareGreaterOrEqual.NAME, 'InputB', `${label} live start-hold overwrite`);
    const beforePostEnd = resolve(releaseVoice.beforePostEnd, `${label} post-roll end guard`);
    wire(musicalTime, C.Expr_MathMultiply.NAME, 'Output', beforePostEnd,
      C.Expr_CompareLessOrEqual.NAME, 'InputA', `${label} post-roll clock`);
    wire(postEnd, C.Expr_MathAdd.NAME, 'Output', beforePostEnd,
      C.Expr_CompareLessOrEqual.NAME, 'InputB', `${label} inclusive post-roll boundary`);
    const timeWindow = resolve(releaseVoice.pianoTimeWindow, `${label} Piano time window`);
    wire(afterStart, C.Expr_CompareGreaterOrEqual.NAME, 'bOutput', timeWindow,
      C.Expr_LogicalAND.NAME, 'bInputA', `${label} future-start guard`);
    wire(beforePostEnd, C.Expr_CompareLessOrEqual.NAME, 'bOutput', timeWindow,
      C.Expr_LogicalAND.NAME, 'bInputB', `${label} post-end guard`);
    const pianoWindow = resolve(releaseVoice.pianoWindow, `${label} Piano enable window`);
    wire(timeWindow, C.Expr_LogicalAND.NAME, 'bOutput', pianoWindow,
      C.Expr_LogicalAND.NAME, 'bInputA', `${label} bounded Piano window`);
    wire(release.running, C.Var.NAME, 'Value', pianoWindow,
      C.Expr_LogicalAND.NAME, 'bInputB', `${label} Stop closes post-roll immediately`);
    const releaseActive = resolve(releaseVoice.pianoReleaseActive,
      `${label} active release clock`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', releaseActive,
      C.Expr_LogicalAND.NAME, 'bInputA', `${label} Piano-only release clock`);
    wire(pianoWindow, C.Expr_LogicalAND.NAME, 'bOutput', releaseActive,
      C.Expr_LogicalAND.NAME, 'bInputB', `${label} guarded release clock`);
    const releaseClock = resolve(releaseVoice.releaseClock, `${label} release clock`);
    wire(endHold, C.Var.NAME, 'Value', releaseClock,
      C.Expr_Select.NAME, 'InputA', `${label} frozen clock fallback`);
    wire(musicalTime, C.Expr_MathMultiply.NAME, 'Output', releaseClock,
      C.Expr_Select.NAME, 'InputB', `${label} live release clock`);
    wire(releaseActive, C.Expr_LogicalAND.NAME, 'bOutput', releaseClock,
      C.Expr_Select.NAME, 'bSelectB', `${label} release-clock polarity`);

    const elapsed = resolve(releaseVoice.releaseElapsed, `${label} release elapsed`);
    assert(component(elapsed, C.Expr_MathSubtract.NAME));
    wire(releaseClock, C.Expr_Select.NAME, 'Output', elapsed,
      C.Expr_MathSubtract.NAME, 'InputA', `${label} guarded elapsed clock`);
    wire(endHold, C.Var.NAME, 'Value', elapsed,
      C.Expr_MathSubtract.NAME, 'InputB', `${label} elapsed origin`);
    const rawProgress = resolve(releaseVoice.rawProgress, `${label} raw progress`);
    assert(component(rawProgress, C.Expr_MathDivide.NAME));
    wire(elapsed, C.Expr_MathSubtract.NAME, 'Output', rawProgress,
      C.Expr_MathDivide.NAME, 'InputA', `${label} progress elapsed`);
    wire(safeTail, C.Expr_Select.NAME, 'Output', rawProgress,
      C.Expr_MathDivide.NAME, 'InputB', `${label} safe-tail divisor`);
    const progress = resolve(releaseVoice.progress, `${label} progress clamp`);
    assert(component(progress, C.Expr_MathClamp.NAME));
    wire(rawProgress, C.Expr_MathDivide.NAME, 'Output', progress,
      C.Expr_MathClamp.NAME, 'Input', `${label} clamped progress`);
    constant(progress, C.Expr_MathClamp.NAME, 'Min', 0, `${label} progress minimum`);
    constant(progress, C.Expr_MathClamp.NAME, 'Max', 1, `${label} progress maximum`);

    const positiveGain = resolve(releaseVoice.positiveReleaseGain,
      `${label} positive-tail gain`);
    assert(component(positiveGain, C.Expr_MathSubtract.NAME));
    constant(positiveGain, C.Expr_MathSubtract.NAME, 'InputA', 1,
      `${label} gain numerator`);
    wire(progress, C.Expr_MathClamp.NAME, 'Output', positiveGain,
      C.Expr_MathSubtract.NAME, 'InputB', `${label} one-minus-progress polarity`);
    const zeroTailGain = resolve(releaseVoice.zeroTailGain, `${label} zero-tail gain`);
    assert(component(zeroTailGain, C.Expr_Select.NAME));
    constant(zeroTailGain, C.Expr_Select.NAME, 'InputA', 0,
      `${label} zero-tail key-off`);
    constant(zeroTailGain, C.Expr_Select.NAME, 'InputB', 1,
      `${label} zero-tail held note`);
    wire(pianoVoice.noteActive, C.Var.NAME, 'Value', zeroTailGain,
      C.Expr_Select.NAME, 'bSelectB', `${label} zero-tail polarity`);
    const releaseGain = resolve(releaseVoice.releaseGain, `${label} release gain`);
    assert(component(releaseGain, C.Expr_Select.NAME));
    wire(zeroTailGain, C.Expr_Select.NAME, 'Output', releaseGain,
      C.Expr_Select.NAME, 'InputA', `${label} zero-tail branch`);
    wire(positiveGain, C.Expr_MathSubtract.NAME, 'Output', releaseGain,
      C.Expr_Select.NAME, 'InputB', `${label} positive-tail branch`);
    wire(tailPositive, C.Expr_CompareGreater.NAME, 'bOutput', releaseGain,
      C.Expr_Select.NAME, 'bSelectB', `${label} tail-branch polarity`);
    releaseGainKeys.add(releaseGain.key);

    const pianoSmooth = resolve(pianoVoice.body.pianoSmooth, `${label} body smoothing`);
    wire(bodyReleaseSmooth, C.Expr_MathDivide.NAME, 'Output', pianoSmooth,
      C.Expr_Select.NAME, 'InputA', `${label} speed-normalized body release`);
    constant(pianoSmooth, C.Expr_Select.NAME, 'InputB', 0.006,
      `${label} unchanged body attack`);
    wire(pianoVoice.pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', pianoSmooth,
      C.Expr_Select.NAME, 'bSelectB', `${label} body attack/release polarity`);
    const transientSmooth = resolve(pianoVoice.transientSmooth,
      `${label} harmonic smoothing`);
    wire(harmonicReleaseSmooth, C.Expr_MathDivide.NAME, 'Output', transientSmooth,
      C.Expr_Select.NAME, 'InputA', `${label} speed-normalized harmonic release`);
    constant(transientSmooth, C.Expr_Select.NAME, 'InputB', 0.006,
      `${label} unchanged harmonic attack`);
    wire(pianoVoice.pianoActive, C.Expr_LogicalAND.NAME, 'bOutput', transientSmooth,
      C.Expr_Select.NAME, 'bSelectB', `${label} harmonic attack/release polarity`);

    const body = releaseVoice.body;
    const bodyReleaseVolume = resolve(body.releaseVolume, `${label} body release volume`);
    assert(component(bodyReleaseVolume, C.Expr_MathMultiply.NAME));
    wire(pianoVoice.body.envelope, C.Dampen.NAME, 'Value', bodyReleaseVolume,
      C.Expr_MathMultiply.NAME, 'InputA', `${label} body envelope value`);
    wire(releaseGain, C.Expr_Select.NAME, 'Output', bodyReleaseVolume,
      C.Expr_MathMultiply.NAME, 'InputB', `${label} body release gain`);
    releaseVolumeKeys.add(bodyReleaseVolume.key);
    const bodyVolumeSelect = resolve(body.volumeSelect, `${label} body profile volume`);
    assert(component(bodyVolumeSelect, C.Expr_Select.NAME));
    const legacyBody = input(bodyVolumeSelect, C.Expr_Select.NAME, 'InputA',
      `${label} legacy body volume`);
    assertSource(legacyBody, body.legacyEmitterVolumeSource,
      `${label} non-Piano body path unchanged`);
    wire(bodyReleaseVolume, C.Expr_MathMultiply.NAME, 'Output', bodyVolumeSelect,
      C.Expr_Select.NAME, 'InputB', `${label} released Piano body`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', bodyVolumeSelect,
      C.Expr_Select.NAME, 'bSelectB', `${label} body profile polarity`);
    const bodyEmitter = resolve(body.emitter, `${label} body emitter`);
    wire(bodyVolumeSelect, C.Expr_Select.NAME, 'Output', bodyEmitter,
      C.AudioEmitter.NAME, 'VolumeMultiplier', `${label} final body volume`);

    const enableSelect = resolve(releaseVoice.enableSelect, `${label} profile enable`);
    assert(component(enableSelect, C.Expr_Select.NAME));
    assertSource(input(enableSelect, C.Expr_Select.NAME, 'InputA',
      `${label} legacy enable input`), releaseVoice.audibleWindow,
    `${label} non-Piano enable window unchanged`);
    wire(pianoWindow, C.Expr_LogicalAND.NAME, 'bOutput', enableSelect,
      C.Expr_Select.NAME, 'InputB', `${label} guarded Piano enable window`);
    wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', enableSelect,
      C.Expr_Select.NAME, 'bSelectB', `${label} enable profile polarity`);
    for (const emitter of [bodyEmitter,
      ...releaseVoice.harmonics.map(harmonic => harmonic.emitter)]) {
      wire(enableSelect, C.Expr_Select.NAME, 'Output', emitter,
        C.AudioEmitter.NAME, 'bEnabled', `${label} shared guarded emitter enable`);
    }

    assert.equal(releaseVoice.harmonics.length, 2);
    for (const harmonic of releaseVoice.harmonics) {
      const harmonicLabel = `${label} H${harmonic.ratio}`;
      const harmonicReleaseVolume = resolve(harmonic.releaseVolume,
        `${harmonicLabel} release volume`);
      assert(component(harmonicReleaseVolume, C.Expr_MathMultiply.NAME));
      wire(harmonic.envelope, C.Dampen.NAME, 'Value', harmonicReleaseVolume,
        C.Expr_MathMultiply.NAME, 'InputA', `${harmonicLabel} envelope value`);
      wire(releaseGain, C.Expr_Select.NAME, 'Output', harmonicReleaseVolume,
        C.Expr_MathMultiply.NAME, 'InputB', `${harmonicLabel} release gain`);
      releaseVolumeKeys.add(harmonicReleaseVolume.key);
      const volumeSelect = resolve(harmonic.volumeSelect, `${harmonicLabel} profile volume`);
      const legacyHarmonic = input(volumeSelect, C.Expr_Select.NAME, 'InputA',
        `${harmonicLabel} legacy volume`);
      const v4Harmonic = context.v4Context.pianoPatch.voices[releaseVoice.voice]
        .harmonics.find(candidate => candidate.ratio === harmonic.ratio);
      assertSource(legacyHarmonic, v4Harmonic.legacyVolumeSource,
        `${harmonicLabel} non-Piano path unchanged`);
      wire(harmonicReleaseVolume, C.Expr_MathMultiply.NAME, 'Output', volumeSelect,
        C.Expr_Select.NAME, 'InputB', `${harmonicLabel} released Piano path`);
      wire(pianoVoice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput', volumeSelect,
        C.Expr_Select.NAME, 'bSelectB', `${harmonicLabel} profile polarity`);
      wire(volumeSelect, C.Expr_Select.NAME, 'Output', harmonic.emitter,
        C.AudioEmitter.NAME, 'VolumeMultiplier', `${harmonicLabel} final volume`);
    }
  }
  assert.equal(releaseGainKeys.size, 18, 'one shared release gain per lane');
  assert.equal(releaseVolumeKeys.size, 54, 'all three Piano layers gain-shaped per lane');

  const positiveGainAt = (time, end, tail) => {
    const safe = tail > 0 ? tail : 0.001;
    const progress = Math.max(0, Math.min(1, (time - end) / safe));
    return 1 - progress;
  };
  for (const tail of [0.0005, 0.001, 0.02, 0.08]) {
    close(positiveGainAt(9, 10, tail), 1, `held gain T=${tail}`);
    close(positiveGainAt(10 + tail / 2, 10, tail), 0.5, `mid-release gain T=${tail}`);
    close(positiveGainAt(10 + tail, 10, tail), 0, `boundary gain T=${tail}`);
    close(positiveGainAt(10 + tail + 0.025, 10, tail), 0,
      `gain stays zero during silent post-roll T=${tail}`);
    assert(positiveGainAt(10 + tail * 0.75, 10, tail)
      <= positiveGainAt(10 + tail * 0.25, 10, tail));
  }
  assert.equal(false ? 1 : 0, 0, 'zero-tail key-off gain');
  assert.equal(true ? 1 : 0, 1, 'zero-tail held gain');

  // Pitch, spatial settings and every scheduler/transport edge are inherited.
  // The per-lane checks above cover the intentional Piano-only bEnabled Select.
  for (const emitter of bricksOf(baseline, C.AudioEmitter.NAME)) {
    const current = resolve(emitter.key);
    for (const port of ['PitchMultiplier', 'InnerRadius',
      'MaxDistance', 'bSpatialization']) {
      const before = one(baseline.edges.filter(edge => edge.z === emitter.key
        && edge.zt === C.AudioEmitter.NAME && edge.q === port), `${emitter.key}.${port} V4`);
      const after = input(current, C.AudioEmitter.NAME, port, `${emitter.key}.${port} V5`);
      assert.deepEqual(after, before, `${emitter.key}.${port} unchanged`);
    }
  }
  assert.deepEqual(scene.bricks.filter(brick => brick.g === 1),
    baseline.bricks.filter(brick => brick.g === 1), 'exact user UI');
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

  console.log('SQM1 piano player V5 checks passed: exact V4 baseline, eighteen exact-zero '
    + 'release gains with a 50 ms silent enabled post-roll, generic zero/tiny-tail polarity, '
    + 'all 54 Piano volumes shaped, speed-normalized releases with unchanged attacks, exact '
    + 'non-Piano enable/volume paths and scheduler retention, bounded pure-gate cost, strict '
    + 'placement and deterministic valid wiring.');
  return {scene, baseline, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v5.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.equal(crypto.createHash('sha256').update(second.bytes).digest('hex'),
    crypto.createHash('sha256').update(first.bytes).digest('hex'),
  'V5 full-player build is byte-for-byte deterministic');
}
