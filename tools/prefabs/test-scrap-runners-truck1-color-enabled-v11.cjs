'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV10 = require('./test-scrap-runners-truck1-color-enabled-v10.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V10 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v10.brz');
const DEFAULT_V11 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v11.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-truck1-color-enabled-v11.cjs');

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
  return { scene, bricks, all, one, incoming, outgoing,
    source: edge => bricks.get(edge.a), target: edge => bricks.get(edge.z) };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const edges = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(edges.length, 1, `${label}: exact edge`);
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

function ownerIdContract(scene) {
  const t = api(scene);
  const ownerObjectOutput = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerIdOutput = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'Owner User ID output').brick;
  const ownerIdComp = component(ownerIdOutput, C.MicrochipOutput.NAME);
  assert.equal(ownerIdComp.data.CallableDefault.$variant, 'str');
  assert.equal(ownerIdComp.data.CallableDefault.value, '');
  assert.equal(ownerIdComp.data.CallableResult.$variant, 'str');

  const ownerIdVar = t.source(t.one(t.incoming(ownerIdOutput,
    C.MicrochipOutput.NAME, 'RER_Input'), 'owner ID output source'));
  assert.equal(component(ownerIdVar, C.Var.NAME).data.Value.$variant, 'str');
  const ownerIdSetter = t.target(t.one(t.outgoing(ownerIdVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'owner ID setter'));
  const getOwnerId = t.source(t.one(t.incoming(ownerIdSetter,
    C.Exec_Var_Set.NAME, 'Exec'), 'owner ID getter execution'));
  assert(component(getOwnerId, C.Exec_PlayerState_GetUserId.NAME));

  const ownerObjectVar = t.source(t.one(t.incoming(ownerObjectOutput,
    C.MicrochipOutput.NAME, 'RER_Input'), 'retained owner object Var'));
  const ownerObjectSetter = t.target(t.one(t.outgoing(ownerObjectVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'retained owner object setter'));
  assertEdge(t, ownerObjectSetter, C.Exec_Var_Set.NAME, 'ExecOut', getOwnerId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec', 'owner object settles before ID lookup');
  assertEdge(t, ownerObjectVar, C.Var.NAME, 'Value', getOwnerId,
    C.Exec_PlayerState_GetUserId.NAME, 'PlayerState', 'ID lookup reads retained owner');
  assertEdge(t, getOwnerId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', ownerIdSetter,
    C.Exec_Var_Set.NAME, 'Value', 'resolved user ID enters retained string setter');
  assertEdge(t, getOwnerId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', ownerIdSetter,
    C.Exec_Var_Set.NAME, 'Exec', 'resolved user ID executes retained string setter');

  const reply = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply').brick;
  const replyComp = component(reply, C.Exec_SendCustomEventGlobal.NAME);
  assert.equal(replyComp.data.DataIn6.$variant, 'str');
  const replyOwner = t.one(t.incoming(reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6'), 'appearance owner ID wire');
  assert.equal(replyOwner.a, ownerIdOutput.key);
  assert.equal(replyOwner.p, 'RER_Output');
  assert(!t.outgoing(ownerObjectOutput, C.MicrochipOutput.NAME, 'RER_Output')
    .some(edge => edge.z === reply.key && edge.q === 'DataIn6'),
  'weak owner object is no longer sent to the terminal');

  const leaderboardConsumers = t.outgoing(ownerObjectOutput,
    C.MicrochipOutput.NAME, 'RER_Output').filter(edge =>
    edge.zt === C.Exec_Gamemode_GetLeaderboardValue.NAME && edge.q === 'PlayerState');
  assert.equal(leaderboardConsumers.length, 2,
    'existing owner object still powers both truck leaderboard reads');
  return { ownerObjectOutput, ownerObjectVar, ownerObjectSetter,
    ownerIdOutput, ownerIdVar, ownerIdSetter, getOwnerId, reply };
}

function test({
  previous = DEFAULT_V10,
  output = DEFAULT_V11,
  builder = DEFAULT_BUILDER,
} = {}) {
  testV10();
  const previousBytes = fs.readFileSync(previous);
  const outputBytes = fs.readFileSync(output);
  const v10 = read(previousBytes);
  const v11 = read(outputBytes);
  assert(validate(outputBytes).strictOk, 'Truck1 v11 passes strict placement');
  assertHandles(v11);
  assert.equal(v11.bricks.length, v10.bricks.length + 4,
    'v11 adds exactly four stable-owner-ID gates');
  assert.equal(v11.edges.length, v10.edges.length + 6,
    'v11 replaces one object reply wire with seven stable-ID wires');
  const contract = ownerIdContract(v11);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'Truck1 v11 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), outputBytes,
    'checked Truck1 v11 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    output,
    bricks: v11.bricks.length,
    wires: v11.edges.length,
    sha256: sha256(outputBytes),
    ownerObject: 'retained PlayerState remains on existing leaderboard paths',
    ownerIdentity: 'stable user ID string on SR.Appearance.Reply.Data6',
    storedBrickHandles: 33,
    inheritedV10Regressions: 'passed',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { truck: v11, contract, result };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V10,
  output: process.argv[3] || DEFAULT_V11,
  builder: process.argv[4] || DEFAULT_BUILDER,
});

module.exports = test;
