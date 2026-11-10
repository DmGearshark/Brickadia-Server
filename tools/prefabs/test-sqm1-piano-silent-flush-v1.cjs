'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const buildV9 = require('./build-sqm1-piano-player-v9.cjs');
const testV9 = require('./test-sqm1-piano-player-v9.cjs');
const continuousBody = require('./apply-sqm1-piano-continuous-body-v1.cjs');
const silentFlush = require('./apply-sqm1-piano-silent-flush-v1.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {write} = require('./reskin-loadboard.cjs');

const VOICES = 24;
const FLUSH_SECONDS = 0.006;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function fixture(runV9Test = false) {
  const context = buildV9();
  if (runV9Test) testV9(context);
  const continuousPatch = continuousBody.apply(context.scene,
    context.singleSourcePatch, context.releasePatch);
  const before = {
    bricks: structuredClone(context.scene.bricks),
    edges: structuredClone(context.scene.edges),
  };
  const flushPatch = silentFlush.apply(context.scene,
    context.pianoPatch, context.releasePatch);
  return {...context, continuousPatch, flushPatch, before};
}

function serialize(context) {
  return write(context.scene, {
    name: 'SQM1 V10 Silent Flush Test Fixture',
    description: 'V9 with continuous Piano bodies and an inaudible six-millisecond '
      + 'post-release Dampen flush.',
  }).bytes;
}

function test(context) {
  const {scene, releasePatch, flushPatch, before} = context;
  assert(scene && releasePatch && flushPatch && before, 'silent-flush fixture');
  assert.deepEqual(flushPatch.constants,
    {VOICES, GATES_PER_VOICE: 1, SILENT_FLUSH_SECONDS: FLUSH_SECONDS});
  assert.equal(flushPatch.addedBricks, VOICES);
  assert.equal(flushPatch.removedEdges.length, VOICES);
  assert.deepEqual(flushPatch.voices.map(voice => voice.voice),
    Array.from({length: VOICES}, (_, index) => index));

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);

  const beforeKeys = new Set(before.bricks.map(brick => brick.key));
  const addedBricks = scene.bricks.filter(brick => !beforeKeys.has(brick.key));
  assert.equal(addedBricks.length, VOICES);
  assert.equal(addedBricks.filter(brick => component(brick, C.Expr_Select.NAME)).length,
    VOICES);
  assert(addedBricks.every(brick => brick.key.startsWith('sqm1p10f:')),
    'flush patch owns only its declared gate keys');
  for (const brick of before.bricks) {
    assert.deepEqual(byKey.get(brick.key), brick, `retained brick ${brick.key} is exact`);
  }

  const beforeEdgeIds = new Set(before.edges.map(edgeId));
  const afterEdgeIds = new Set(scene.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdgeIds.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdgeIds.has(edgeId(edge)));
  assert.equal(removedEdges.length, VOICES,
    'one old release-smoothing edge removed per voice');
  assert.equal(addedEdges.length, VOICES * 3,
    'audible-window, normal-smoothing and output wires added per voice');
  assert.deepEqual(removedEdges.map(edgeId).sort(),
    flushPatch.removedEdges.map(edgeId).sort(), 'patch reports exact removed routes');
  assert(removedEdges.every(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'InputA'),
    'only body release-smoothing inputs are rerouted');
  assert(addedEdges.every(edge => ![C.AudioEmitter.NAME, C.Dampen.NAME].includes(edge.zt)),
    'silent flush adds no direct emitter or Dampen route');

  const sharedRelease = releasePatch.bodyReleaseSmooth;
  assert.equal(scalar(component(sharedRelease, C.Expr_MathDivide.NAME).data.InputA), 0.07,
    'audible body release remains seventy milliseconds at speed one');
  for (const patched of flushPatch.voices) {
    const voice = patched.voice;
    const flushSmooth = byKey.get(patched.flushSmooth.key);
    const pianoSmooth = byKey.get(patched.pianoSmooth.key);
    assert(flushSmooth && pianoSmooth, `voice ${voice} flush gate exists`);

    const condition = one(incoming(flushSmooth, C.Expr_Select.NAME, 'bSelectB'),
      `voice ${voice} flush condition`);
    assert.deepEqual({a: condition.a, at: condition.at, p: condition.p},
      patched.audibleWindow, `voice ${voice} exact guarded audible window`);
    assert.equal(incoming(flushSmooth, C.Expr_Select.NAME, 'InputA').length, 0);
    assert.equal(scalar(component(flushSmooth, C.Expr_Select.NAME).data.InputA),
      FLUSH_SECONDS, `voice ${voice} exact silent flush time`);
    const normal = one(incoming(flushSmooth, C.Expr_Select.NAME, 'InputB'),
      `voice ${voice} normal release smoothing`);
    assert.deepEqual({a: normal.a, at: normal.at, p: normal.p},
      {a: sharedRelease.key, at: C.Expr_MathDivide.NAME, p: 'Output'});
    const output = one(incoming(pianoSmooth, C.Expr_Select.NAME, 'InputA'),
      `voice ${voice} body release smoothing output`);
    assert.deepEqual({a: output.a, at: output.at, p: output.p},
      {a: flushSmooth.key, at: C.Expr_Select.NAME, p: 'Output'});
    assert.equal(incoming(pianoSmooth, C.Expr_Select.NAME, 'InputB').length, 0,
      `voice ${voice} attack smoothing remains constant`);
    assert.equal(scalar(component(pianoSmooth, C.Expr_Select.NAME).data.InputB), 0.006,
      `voice ${voice} attack smoothing unchanged`);
    assert.equal(outgoing(flushSmooth, C.Expr_Select.NAME, 'Output').length, 1);
  }

  // The score reserves 200 ms per lane and exposes only the first 80 ms as
  // audible release. These ratios show why the old residual was independent
  // of speed and establish at least ten silent flush intervals at speed two.
  const speedRows = [0.1, 0.25, 0.5, 1, 2].map(speed => ({
    speed,
    currentIntervals: (0.2 / speed) / (0.07 / speed),
    flushIntervals: (0.12 / speed) / FLUSH_SECONDS,
  }));
  for (const row of speedRows) {
    assert(Math.abs(row.currentIntervals - (0.2 / 0.07)) < 1e-12);
    assert(row.flushIntervals >= 10, `speed ${row.speed} has ten silent flush intervals`);
  }
  const oldResidual = Math.exp(-(0.2 / 0.07));
  const worstNewResidual = Math.exp(-((0.08 / 0.07) + 10));
  assert(oldResidual / worstNewResidual > 3900,
    'worst-case modeled internal residual falls by more than 3,900 times');

  assert.deepEqual({bricks: scene.bricks.length, edges: scene.edges.length},
    {bricks: 7784, edges: 13092}, 'V9 + continuous-body + silent-flush graph budget');
  assert.equal(scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME)).length, 72);
  assert.equal(scene.bricks.filter(brick => component(brick, C.Dampen.NAME)).length, 72);

  const bytes = serialize(context);
  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  const targets = new Set();
  for (const edge of scene.edges) {
    const sourceBrick = byKey.get(edge.a);
    const targetBrick = byKey.get(edge.z);
    assert(sourceBrick?.comps.some(item => item.type === edge.at), `source ${edge.a}`);
    assert(targetBrick?.comps.some(item => item.type === edge.zt), `target ${edge.z}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `input ${edge.zt}.${edge.q}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `duplicate target ${target}`);
    targets.add(target);
  }
  return {bytes, placement, speedRows, oldResidual, worstNewResidual};
}

module.exports = test;
module.exports.fixture = fixture;
module.exports.serialize = serialize;

if (require.main === module) {
  const first = fixture(true);
  const result = test(first);
  const second = fixture(false);
  const secondResult = test(second);
  assert.deepEqual(Buffer.from(secondResult.bytes), Buffer.from(result.bytes),
    'silent-flush composition rebuilds byte-for-byte');
  console.log('SQM1 Piano silent-flush checks passed: exact V9 baseline, continuous-body '
    + 'composition, 24 audible-window-driven six-millisecond flush Selects, unchanged '
    + 'audible release/attack, at least ten flush intervals through speed two, 3,900x modeled '
    + 'residual reduction, strict placement and deterministic valid wiring.');
}
