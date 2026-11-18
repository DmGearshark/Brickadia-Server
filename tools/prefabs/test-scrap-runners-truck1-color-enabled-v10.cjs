'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV9 = require('./test-scrap-runners-truck1-color-enabled-v9.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const DEFAULT_V9 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v9.brz');
const DEFAULT_V10 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v10.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-truck1-color-enabled-v10.cjs');
const V9_SHA256 = 'd2edeef808b7f512d02a3812a8d38e81b65dd34ac3de6c0222768a4430508b3e';

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
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  return {
    scene,
    bricks,
    all,
    one,
    incoming,
    outgoing,
    source: edge => bricks.get(edge.a),
    target: edge => bricks.get(edge.z),
    label,
  };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
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

function ownerParts(scene) {
  const t = api(scene);
  const ownerOutput = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerVar = t.source(t.one(t.incoming(ownerOutput,
    C.MicrochipOutput.NAME, 'RER_Input'), 'retained owner Var'));
  assert(component(ownerVar, C.Var.NAME));
  const ownerSetter = t.target(t.one(t.outgoing(ownerVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'retained owner setter'));
  const reply = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply sender').brick;
  const replyOwner = t.one(t.incoming(reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6'), 'appearance reply owner source');
  assert.equal(replyOwner.a, ownerOutput.key,
    'reply Data6 remains sourced by retained Owner PlayerState output');
  assert.equal(replyOwner.at, C.MicrochipOutput.NAME);
  assert.equal(replyOwner.p, 'RER_Output');
  return { t, ownerOutput, ownerVar, ownerSetter, reply };
}

function v9RawCharacterContract(scene) {
  const parts = ownerParts(scene);
  const { t, ownerSetter } = parts;
  const exec = t.one(t.incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Exec'),
    'v9 direct UpdateCar owner execution');
  const value = t.one(t.incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Value'),
    'v9 direct UpdateCar owner value');
  assert.equal(exec.a, value.a, 'v9 execution and raw owner share the UpdateCar event');
  const update = t.source(exec);
  const updateComp = component(update, C.Event_CustomGlobal.NAME);
  assert(updateComp && updateComp.data.EventName === 'UpdateCar');
  assert.equal(exec.p, 'ExecOut');
  assert.equal(value.p, 'DataOut1');
  assert.equal(t.all(C.Exec_PlayerState_GetFromEntity.NAME,
    (_data, brick) => brick.g === update.g).length, 0,
  'v9 general chip never converts spawning Character to PlayerState');
  return { ...parts, update };
}

function v10NormalizedOwnerContract(scene) {
  const parts = ownerParts(scene);
  const { t, ownerSetter, ownerOutput, reply } = parts;
  const resolver = t.label('Resolve spawning Character to Owner PlayerState');
  assert(component(resolver, C.Exec_PlayerState_GetFromEntity.NAME),
    'v10 adds the native Character-to-PlayerState resolver');
  const updateExec = t.one(t.incoming(resolver,
    C.Exec_PlayerState_GetFromEntity.NAME, 'Exec'), 'resolver execution source');
  const updateEntity = t.one(t.incoming(resolver,
    C.Exec_PlayerState_GetFromEntity.NAME, 'Entity'), 'resolver Character source');
  assert.equal(updateExec.a, updateEntity.a);
  const update = t.source(updateExec);
  const updateComp = component(update, C.Event_CustomGlobal.NAME);
  assert(updateComp && updateComp.data.EventName === 'UpdateCar');
  assert.equal(updateExec.p, 'ExecOut');
  assert.equal(updateEntity.p, 'DataOut1');
  assertEdge(t, resolver, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', ownerSetter,
    C.Exec_Var_Set.NAME, 'Exec', 'resolved PlayerState executes retained owner setter');
  assertEdge(t, resolver, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', ownerSetter,
    C.Exec_Var_Set.NAME, 'Value', 'retained owner value is actual PlayerState');
  assert.equal(t.incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Exec').length, 1);
  assert.equal(t.incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Value').length, 1);
  assertEdge(t, ownerOutput, C.MicrochipOutput.NAME, 'RER_Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6',
    'normalized retained PlayerState still powers reply Data6');

  const row = [update, resolver, ownerSetter, parts.ownerVar, ownerOutput];
  assert(row.every(brick => brick.g === row[0].g), 'owner normalization row shares one chip');
  assert(row.every(brick => brick.data.position[1] === -5
    && brick.data.position[2] === 2), 'owner normalization row is on the chip grid');
  for (let index = 1; index < row.length; index++) {
    const left = row[index - 1];
    const right = row[index];
    const leftHalf = left.data.size?.some(value => value > 0)
      ? left.data.size : bounds.assets[left.data.asset];
    const rightHalf = right.data.size?.some(value => value > 0)
      ? right.data.size : bounds.assets[right.data.asset];
    assert(leftHalf && rightHalf);
    assert.equal(right.data.position[0] - left.data.position[0],
      leftHalf[0] + rightHalf[0], `owner row gate ${index + 1} touches prior gate`);
  }
  return { ...parts, update, resolver };
}

function intendedDelta(v9, v10, normalized) {
  assert.equal(v9.bricks.length, 273);
  assert.equal(v10.bricks.length, 274, 'v10 adds exactly one owner resolver gate');
  assert.equal(v9.edges.length, 209);
  assert.equal(v10.edges.length, 211, 'v10 replaces two direct wires with four normalized wires');
  assert.deepEqual(v10.links, v9.links, 'nested microchip links are unchanged');
  assert.deepEqual(v10.joints || [], v9.joints || [], 'truck joints are unchanged');

  const v10ByKey = new Map(v10.bricks.map(brick => [brick.key, brick]));
  const moved = new Set([
    normalized.ownerSetter.key,
    normalized.ownerVar.key,
    normalized.ownerOutput.key,
  ]);
  for (const oldBrick of v9.bricks) {
    const newBrick = v10ByKey.get(oldBrick.key);
    assert(newBrick, `v9 brick survives: ${oldBrick.key}`);
    assert.deepEqual(newBrick.comps, oldBrick.comps,
      `v9 brick components remain exact: ${oldBrick.key}`);
    const expected = structuredClone(oldBrick.data);
    if (moved.has(oldBrick.key)) expected.position = newBrick.data.position;
    assert.deepEqual(newBrick.data, expected,
      `v9 brick geometry remains exact except normalized row spacing: ${oldBrick.key}`);
  }
  const newBricks = v10.bricks.filter(brick => !v9.bricks.some(old => old.key === brick.key));
  assert.deepEqual(newBricks.map(brick => brick.key), [normalized.resolver.key],
    'the resolver is the sole new truck brick');

  const edgeKey = edge => JSON.stringify(edge);
  const oldSet = new Set(v9.edges.map(edgeKey));
  const newSet = new Set(v10.edges.map(edgeKey));
  const removed = v9.edges.filter(edge => !newSet.has(edgeKey(edge)));
  const added = v10.edges.filter(edge => !oldSet.has(edgeKey(edge)));
  assert.equal(removed.length, 2, 'only two unsafe direct owner wires are removed');
  assert.equal(added.length, 4, 'only four normalization wires are added');
  assert(removed.every(edge => edge.a === normalized.update.key
    && edge.z === normalized.ownerSetter.key),
  'removed wires are the direct UpdateCar-to-owner-setter path');
  assert(added.every(edge => edge.a === normalized.update.key
    || edge.a === normalized.resolver.key),
  'added wires belong only to owner normalization');
}

function test({
  previous = DEFAULT_V9,
  output = DEFAULT_V10,
  builder = DEFAULT_BUILDER,
} = {}) {
  testV9({ output: previous });
  const previousBytes = fs.readFileSync(previous);
  const outputBytes = fs.readFileSync(output);
  assert.equal(crypto.createHash('sha256').update(previousBytes).digest('hex'),
    V9_SHA256, 'expected Truck1 v9 baseline');
  const v9 = read(previousBytes);
  const v10 = read(outputBytes);
  assert(validate(previousBytes).strictOk, 'Truck1 v9 passes strict placement');
  assert(validate(outputBytes).strictOk, 'Truck1 v10 passes strict placement');
  assertHandles(v9);
  assertHandles(v10);
  v9RawCharacterContract(v9);
  const normalized = v10NormalizedOwnerContract(v10);
  intendedDelta(v9, v10, normalized);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'Truck1 v10 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), outputBytes,
    'checked Truck1 v10 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    output,
    bricks: v10.bricks.length,
    wires: v10.edges.length,
    sha256: sha256(outputBytes),
    bug: 'spawner UpdateCar.Data1 is Character, not PlayerState',
    fix: 'GetPlayerStateFromEntity at spawn -> retained Owner PlayerState',
    ownerReply: 'retained PlayerState -> SR.Appearance.Reply.Data6',
    storedBrickHandles: 33,
    inheritedV9Regressions: 'passed',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { truck: v10, result, normalized };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V9,
  output: process.argv[3] || DEFAULT_V10,
  builder: process.argv[4] || DEFAULT_BUILDER,
});

module.exports = test;
