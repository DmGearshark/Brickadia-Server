'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV18 = require('./test-scrap-runners-color-terminal-v18.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V8 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V9 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v9.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-truck1-color-enabled-v9.cjs');
const V8_SHA256 = '698b8b21594f791ab6bc96cd65b7adad2b39daa0f5c6930a725af5ae88c1b621';

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  return {
    scene,
    bricks,
    all,
    one,
    incoming,
    outgoing,
    source: edge => bricks.get(edge.a),
    target: edge => bricks.get(edge.z),
  };
}

function isHandle(value) {
  return value && typeof value === 'object'
    && Number.isInteger(value.GridPersistentIndex)
    && value.ChunkIndex
    && Number.isInteger(value.ChunkIndex.X)
    && Number.isInteger(value.ChunkIndex.Y)
    && Number.isInteger(value.ChunkIndex.Z)
    && Number.isInteger(value.BrickIndexInChunk);
}

function walk(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  (Array.isArray(value) ? value : Object.values(value)).forEach(child => walk(child, fn));
}

function assertHandles(scene, expected = 33) {
  const valid = new Set(scene.bricks.map(brick => brick.key));
  let count = 0;
  for (const brick of scene.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    assert(valid.has(key), `stored BrickHandle resolves: ${key}`);
    count++;
  });
  assert.equal(count, expected, `all ${expected} stored BrickHandles survive`);
}

function ownerReplyContract(scene) {
  const t = api(scene);
  const ownerOutput = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerVarEdge = t.one(t.incoming(ownerOutput, C.MicrochipOutput.NAME, 'RER_Input'),
    'owner output retained Var');
  const ownerVar = t.source(ownerVarEdge);
  assert(component(ownerVar, C.Var.NAME), 'owner output is sourced from a retained Var');
  assert.equal(component(ownerVar, C.Var.NAME).data.Value.$variant, 'weak_object');

  const ownerSetterEdge = t.one(t.outgoing(ownerVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'owner Var setter');
  const ownerSetter = t.target(ownerSetterEdge);
  const ownerValueEdge = t.one(t.incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Value'),
    'owner setter value');
  const updateCar = t.source(ownerValueEdge);
  const update = component(updateCar, C.Event_CustomGlobal.NAME);
  assert(update && update.data.EventName === 'UpdateCar',
    'stored owner comes from the spawner UpdateCar event');
  assert.equal(ownerValueEdge.p, 'DataOut1', 'UpdateCar Data1 is the authoritative owner');
  assert.equal(update.data.DataOut1.$variant, 'weak_object');

  const reply = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply').brick;
  const replyData = component(reply, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(replyData.DataIn6.$variant, 'weak_object',
    'reply Data6 is typed as PlayerState weak_object');
  assert.equal(replyData.DataIn6.value, null, 'reply Data6 has a null-safe default');
  const ownerReplyEdge = t.one(t.incoming(reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6'), 'reply owner input');
  assert.equal(ownerReplyEdge.a, ownerOutput.key,
    'reply Data6 reads the existing Owner PlayerState output');
  assert.equal(ownerReplyEdge.at, C.MicrochipOutput.NAME);
  assert.equal(ownerReplyEdge.p, 'RER_Output');
  return { ownerOutput, ownerVar, ownerSetter, updateCar, reply, ownerReplyEdge };
}

function assertIntendedDelta(v8, v9, contract) {
  assert.equal(v8.bricks.length, 273);
  assert.equal(v9.bricks.length, 273, 'v9 adds no truck bricks');
  assert.equal(v8.edges.length, 208);
  assert.equal(v9.edges.length, 209, 'v9 adds exactly one owner reply wire');
  assert.deepEqual(v9.links, v8.links, 'nested microchip links are unchanged');
  assert.deepEqual(v9.joints || [], v8.joints || [], 'truck joints are unchanged');

  const changes = [];
  v8.bricks.forEach((oldBrick, brickIndex) => {
    const newBrick = v9.bricks[brickIndex];
    assert.equal(newBrick.key, oldBrick.key, `brick ${brickIndex} identity`);
    assert.deepEqual(newBrick.data, oldBrick.data, `brick ${brickIndex} geometry/data`);
    assert.equal(newBrick.comps.length, oldBrick.comps.length,
      `brick ${brickIndex} component count`);
    oldBrick.comps.forEach((oldComp, compIndex) => {
      const newComp = newBrick.comps[compIndex];
      assert.equal(newComp.type, oldComp.type);
      if (JSON.stringify(newComp.data) === JSON.stringify(oldComp.data)) return;
      changes.push({ oldComp, newComp });
    });
  });
  assert.equal(changes.length, 1, 'only the appearance reply component data changes');
  const [{ oldComp, newComp }] = changes;
  assert.equal(oldComp.type, C.Exec_SendCustomEventGlobal.NAME);
  assert.equal(oldComp.data.EventName, 'SR.Appearance.Reply');
  assert.equal(oldComp.data.DataIn6.$variant, 'f64');
  assert.equal(newComp.data.DataIn6.$variant, 'weak_object');
  const expected = structuredClone(oldComp.data);
  expected.DataIn6 = { $variant: 'weak_object', value: null };
  assert.deepEqual(newComp.data, expected, 'only reply Data6 metadata changes');

  const newEdges = v9.edges.filter(edge => !v8.edges.some(old =>
    JSON.stringify(old) === JSON.stringify(edge)));
  const removedEdges = v8.edges.filter(edge => !v9.edges.some(next =>
    JSON.stringify(next) === JSON.stringify(edge)));
  assert.equal(newEdges.length, 1, 'exactly one new wire');
  assert.equal(removedEdges.length, 0, 'no existing truck wire is removed');
  assert.deepEqual(newEdges[0], contract.ownerReplyEdge,
    'the sole new wire is Owner PlayerState -> reply Data6');
}

function test({
  previous = DEFAULT_V8,
  output = DEFAULT_V9,
  builder = DEFAULT_BUILDER,
} = {}) {
  // Preserve the complete terminal/material/restore baseline through v18/v8.
  testV18();

  const previousBytes = fs.readFileSync(previous);
  const outputBytes = fs.readFileSync(output);
  const v8 = read(previousBytes);
  const v9 = read(outputBytes);
  assert.equal(crypto.createHash('sha256').update(previousBytes).digest('hex'),
    V8_SHA256, 'expected Truck1 v8 baseline');
  assert(validate(previousBytes).strictOk, 'Truck1 v8 passes strict placement');
  assert(validate(outputBytes).strictOk, 'Truck1 v9 passes strict placement');
  assertHandles(v8);
  assertHandles(v9);
  const contract = ownerReplyContract(v9);
  assertIntendedDelta(v8, v9, contract);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'Truck1 v9 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), outputBytes,
    'checked Truck1 v9 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    output,
    bricks: v9.bricks.length,
    wires: v9.edges.length,
    sha256: sha256(outputBytes),
    ownerSource: 'UpdateCar.Data1 -> retained Owner PlayerState',
    ownerReply: 'SR.Appearance.Reply.Data6 weak_object',
    storedBrickHandles: 33,
    inheritedV18Regressions: 'passed on v18/v8 baseline',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { truck: v9, result };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V8,
  output: process.argv[3] || DEFAULT_V9,
  builder: process.argv[4] || DEFAULT_BUILDER,
});

module.exports = test;
