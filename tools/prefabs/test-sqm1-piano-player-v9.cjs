'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV8 = require('./build-sqm1-piano-player-v8.cjs');
const testV8 = require('./test-sqm1-piano-player-v8.cjs');

const V8_HASH = '32165a0309098baac7bc5de0cfaec729e890f0d275e775f8fa7f327c9b0a339b';
const V9_HASH = 'ad9eab5e70622696f3ff57eb6a64ffd94a36cbd40cfff9ef2f8647442e2694ae';
const HEADROOM = 0.35;
const VOICES = 24;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
function one(items, label) { assert.equal(items.length, 1, label); return items[0]; }

module.exports = function testSqm1PianoPlayerV9(context) {
  assert(context?.bytes && context?.scene && context?.outputScene
    && context?.v8Bytes && context?.headroomPatch, 'V9 builder context');
  const v8 = buildV8();
  testV8(v8);
  assert.equal(sha256(v8.bytes), V8_HASH, 'exact V8 baseline');
  assert.deepEqual(Buffer.from(context.v8Bytes), Buffer.from(v8.bytes),
    'V9 starts from the exact V8 bytes');
  assert.equal(sha256(context.bytes), V9_HASH, 'exact V9 build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V9 artifact exists');
  const artifact = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifact), V9_HASH, 'exact V9 artifact');
  assert.deepEqual(artifact, Buffer.from(context.bytes), 'artifact equals fresh build');

  const before = v8.scene;
  const after = context.scene;
  const serialized = context.outputScene;
  const byKey = new Map(after.bricks.map(brick => [brick.key, brick]));
  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => after.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => after.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);

  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    v8.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V8');
  assert.deepEqual(serialized.r.externalAssets(), v8.outputScene.r.externalAssets(),
    'assets unchanged');

  const beforeKeys = new Set(before.bricks.map(brick => brick.key));
  const afterKeys = new Set(after.bricks.map(brick => brick.key));
  const addedBricks = after.bricks.filter(brick => !beforeKeys.has(brick.key));
  const removedBricks = before.bricks.filter(brick => !afterKeys.has(brick.key));
  assert.equal(removedBricks.length, 0, 'no V8 bricks removed');
  assert.equal(addedBricks.length, 1, 'one shared headroom gate added');
  const gain = addedBricks[0];
  assert(component(gain, C.Expr_MathMultiply.NAME), 'headroom is Multiply');
  assert.equal(scalar(component(gain, C.Expr_MathMultiply.NAME).data.InputB), HEADROOM,
    'exact 0.35 headroom constant');
  assert.equal(incoming(gain, C.Expr_MathMultiply.NAME, 'InputA').length, 1,
    'one shared effective-volume input');
  assert.equal(incoming(gain, C.Expr_MathMultiply.NAME, 'InputB').length, 0,
    'headroom remains constant');

  const beforeEdges = new Set(before.edges.map(edgeId));
  const afterEdges = new Set(after.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdges.has(edgeId(edge)));
  const addedEdges = after.edges.filter(edge => !beforeEdges.has(edgeId(edge)));
  assert.equal(removedEdges.length, VOICES, '24 raw master-volume routes removed');
  assert.equal(addedEdges.length, VOICES + 1, 'shared input plus 24 scaled routes added');

  const gainInput = one(incoming(gain, C.Expr_MathMultiply.NAME, 'InputA'),
    'shared headroom input');
  const bodyMasters = [];
  for (let voice = 0; voice < VOICES; voice++) {
    const bodyMaster = byKey.get(`sqm1p4:voice${voice}:body-master`);
    assert(bodyMaster && component(bodyMaster, C.Expr_MathMultiply.NAME),
      `voice ${voice} body master`);
    bodyMasters.push(bodyMaster);
    const scaled = one(incoming(bodyMaster, C.Expr_MathMultiply.NAME, 'InputB'),
      `voice ${voice} scaled master`);
    assert.deepEqual({a: scaled.a, at: scaled.at, p: scaled.p},
      {a: gain.key, at: C.Expr_MathMultiply.NAME, p: 'Output'},
    `voice ${voice} receives shared headroom`);
    const old = one(removedEdges.filter(edge => edge.z === bodyMaster.key
      && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB'),
    `voice ${voice} old master route`);
    assert.deepEqual({a: old.a, at: old.at, p: old.p},
      {a: gainInput.a, at: gainInput.at, p: gainInput.p},
    `voice ${voice} exact effective-volume source retained`);
  }
  assert.equal(outgoing(gain, C.Expr_MathMultiply.NAME, 'Output').length, VOICES,
    'shared gain fans out to all 24 bodies');

  // Every V8 edge outside those exact body-master inputs remains byte-structurally unchanged.
  assert.deepEqual(removedEdges.map(edgeId).sort(),
    bodyMasters.map(body => edgeId(one(before.edges.filter(edge => edge.z === body.key
      && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB'), body.key))).sort(),
  'only raw Piano body master routes removed');
  for (const brick of before.bricks) {
    assert.deepEqual(byKey.get(brick.key), brick, `retained V8 brick ${brick.key} is exact`);
  }

  // The V4 profile selector uses bodyMaster only on Piano; its legacy non-Piano input stays exact.
  for (let voice = 0; voice < VOICES; voice++) {
    const target = byKey.get(`sqm1p4:voice${voice}:profile-target`);
    const beforeTarget = beforeByKey.get(target.key);
    assert(target && beforeTarget, `voice ${voice} profile target`);
    for (const port of ['InputA', 'InputB', 'bSelectB']) {
      const prior = before.edges.filter(edge => edge.z === target.key
        && edge.zt === C.Expr_Select.NAME && edge.q === port).map(edgeId).sort();
      const current = after.edges.filter(edge => edge.z === target.key
        && edge.zt === C.Expr_Select.NAME && edge.q === port).map(edgeId).sort();
      assert.deepEqual(current, prior, `voice ${voice} profile selector ${port} unchanged`);
    }
  }

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 7710, edges: 12921, components: 7718},
  'one-gate graph delta');
  assert.equal(serialized.bricks.filter(brick => component(brick, C.AudioEmitter.NAME)).length, 72);
  assert.equal(serialized.bricks.filter(brick => component(brick, C.Dampen.NAME)).length, 72);
  assert.equal(serialized.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length, 24);

  const fullVelocityPeak = 1 + 0.30;
  assert(Math.abs(fullVelocityPeak * HEADROOM - 0.455) < 1e-12,
    'volume 1 full-velocity Piano peak is 0.455');
  assert(fullVelocityPeak * HEADROOM * 2 < 1,
    'volume 2 full-velocity Piano peak stays below unity');
  assert.equal(context.constants.HEADROOM_SCALE, HEADROOM, 'builder reports 0.35 headroom');
  const volumeSpecs = context.constants.CONTROL_SPECS.filter(spec =>
    spec.label === 'Volume down' || spec.label === 'Volume Up');
  assert.equal(volumeSpecs.length, 2, 'both visible volume controls retained');
  for (const spec of volumeSpecs) {
    assert.deepEqual({step: spec.step, min: spec.min, max: spec.max},
      {step: 0.1, min: 1, max: 2}, `${spec.label} range retained`);
  }
  const volumeSteps = context.steps.filter(step => {
    const label = component(step.button, C.Button.NAME)?.data.PromptCustomLabel;
    return label === 'Volume down' || label === 'Volume Up';
  });
  assert.equal(volumeSteps.length, 2, 'both visible volume state paths retained');
  for (const step of volumeSteps) {
    assert.equal(scalar(component(step.state, C.Var.NAME).data.Value), 1,
      'visible volume defaults to 1');
  }
  assert.deepEqual([1 * HEADROOM, 2 * HEADROOM], [0.35, 0.7],
    'visible 1..2 maps to internal 0.35..0.70');
  assert.deepEqual(context.headroomPatch.constants,
    {HEADROOM_SCALE: HEADROOM, VOICES}, 'reported patch constants');

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  const serializedByKey = new Map(serialized.bricks.map(brick => [brick.key, brick]));
  const serializedHeadroom = one(serialized.bricks.filter(brick =>
    brick.g === gain.g && JSON.stringify(brick.data.position) === JSON.stringify(gain.data.position)
      && component(brick, C.Expr_MathMultiply.NAME)), 'serialized headroom gate');
  assert.equal(scalar(component(serializedHeadroom, C.Expr_MathMultiply.NAME).data.InputB), HEADROOM);
  assert.equal(serialized.edges.filter(edge => edge.z === serializedHeadroom.key
    && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputA').length, 1);
  assert.equal(serialized.edges.filter(edge => edge.a === serializedHeadroom.key
    && edge.at === C.Expr_MathMultiply.NAME && edge.p === 'Output').length, VOICES);

  const targets = new Set();
  for (const edge of serialized.edges) {
    const source = serializedByKey.get(edge.a);
    const target = serializedByKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at), `valid source ${edge.a}`);
    assert(target?.comps.some(item => item.type === edge.zt), `valid target ${edge.z}`);
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `unique target ${targetId}`);
    targets.add(targetId);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
  }

  console.log('SQM1 piano player V9 checks passed: exact V8 baseline and visible UI, one shared '
    + '0.35 Piano headroom scale, all 24 body targets rerouted, sub-unity maximum single-note '
    + 'peak at visible volume 2, exact non-Piano/profile routes, strict placement, deterministic '
    + 'artifact and valid unique wiring.');
  return {v8, before, after, gain, placement};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v9.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'V9 build is byte-for-byte deterministic');
}
