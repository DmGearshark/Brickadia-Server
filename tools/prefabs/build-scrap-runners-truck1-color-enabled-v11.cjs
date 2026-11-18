'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v10.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v11.brz'));

const clone = structuredClone;
const S = value => ({ $variant: 'str', value });

function owner(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Prefab owner');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
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

function writeTruck(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const beforeEntities = [...scene.r.entities()];
  const afterEntities = [...first.r.entities()];
  assert.equal(beforeEntities.length, afterEntities.length, 'entity count');
  const gridMap = new Map([[1, 1]]);
  beforeEntities.forEach((entity, index) =>
    gridMap.set(entity.persistentIndex, afterEntities[index].persistentIndex));

  const keyMap = new Map();
  for (const grid of new Set(scene.bricks.map(brick => brick.g))) {
    const before = scene.bricks.filter(brick => brick.g === grid);
    const after = first.bricks.filter(brick => brick.g === gridMap.get(grid));
    assert.equal(after.length, before.length, `grid ${grid} brick count`);
    before.forEach((brick, index) => keyMap.set(brick.key, after[index].key));
  }

  let remapped = 0;
  for (const brick of first.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const old = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    const replacement = keyMap.get(old);
    assert(replacement, `Lost BrickHandle ${old}`);
    const [GridPersistentIndex, X, Y, Z, BrickIndexInChunk] = JSON.parse(replacement);
    Object.assign(value, {
      GridPersistentIndex,
      ChunkIndex: { X, Y, Z },
      BrickIndexInChunk,
    });
    remapped++;
  });

  const bytes = write(first, metadata).bytes;
  const final = read(bytes);
  const valid = new Set(final.bricks.map(brick => brick.key));
  let checked = 0;
  for (const brick of final.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    assert(valid.has(key), `Dangling BrickHandle ${key}`);
    checked++;
  });
  assert.equal(checked, remapped, 'every remapped BrickHandle resolves');
  return { bytes, remapped };
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const removeInput = (brick, type, port) => {
    const old = incoming(brick, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === brick.key
      && edge.zt === type && edge.q === port));
    return old;
  };
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert.equal(incoming(target, targetType, targetPort).length, 0,
      `duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  };

  const ownerOutput = one(rows.filter(item => item.comp.type === C.MicrochipOutput.NAME
    && item.comp.data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerVarEdge = one(incoming(ownerOutput, C.MicrochipOutput.NAME, 'RER_Input'),
    'retained owner Var');
  const ownerVar = one(scene.bricks.filter(brick => brick.key === ownerVarEdge.a),
    'retained owner Var brick');
  const ownerSetterEdge = one(outgoing(ownerVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'retained owner setter');
  const ownerSetter = one(scene.bricks.filter(brick => brick.key === ownerSetterEdge.z),
    'retained owner setter brick');
  const reply = one(rows.filter(item => item.comp.type === C.Exec_SendCustomEventGlobal.NAME
    && item.comp.data.EventName === 'SR.Appearance.Reply'), 'appearance reply sender');
  const oldReplyOwner = one(removeInput(reply.brick,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6'), 'old object owner reply');
  assert.equal(oldReplyOwner.a, ownerOutput.key,
    'v10 reply owner comes from Owner PlayerState output');
  reply.comp.data.DataIn6 = S('');

  const base = clone(ownerSetter.data);
  const make = (kind, key, position, data, hover) => {
    const definition = C[kind];
    assert(definition, kind);
    const brickData = clone(base);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position,
      direction: 4,
      rotation: 0,
      size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
      color: [75, 180, 215],
      material_intensity: 5,
    });
    const brick = {
      key: `v11:12:${key}`,
      g: ownerVar.g,
      data: brickData,
      comps: [
        { type: definition.NAME, data: clone(data) },
        {
          type: C.Interact.NAME,
          data: {
            InteractSound: 0,
            Message: hover,
            ConsoleTag: '',
            bAllowNearbyInteraction: true,
            bHiddenInteraction: false,
            PromptCustomLabel: hover,
          },
        },
      ],
    };
    scene.bricks.push(brick);
    return brick;
  };

  const getOwnerId = make('Exec_PlayerState_GetUserId', 'get_owner_user_id',
    [145, -5, 2], { UserId: '' }, 'Resolve retained owner to stable user ID');
  const setOwnerId = make('Exec_Var_Set', 'set_owner_user_id',
    [155, -5, 2], { bChangeType: false, Value: S('') }, 'Store stable owner user ID');
  const ownerId = make('Var', 'owner_user_id',
    [165, -5, 2], { Value: S('') }, 'Owner User ID');
  const ownerIdOutput = make('MicrochipOutput', 'owner_user_id_output',
    [175, -5, 2], {
      PortLabel: 'Owner User ID',
      PortOrder: 2,
      CallableDefault: S(''),
      CallableResult: S(''),
    }, 'Owner User ID output');

  add(ownerSetter, C.Exec_Var_Set.NAME, 'ExecOut', getOwnerId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec');
  add(ownerVar, C.Var.NAME, 'Value', getOwnerId,
    C.Exec_PlayerState_GetUserId.NAME, 'PlayerState');
  add(getOwnerId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', setOwnerId,
    C.Exec_Var_Set.NAME, 'Exec');
  add(getOwnerId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', setOwnerId,
    C.Exec_Var_Set.NAME, 'Value');
  add(ownerId, C.Var.NAME, 'VarRef', setOwnerId,
    C.Exec_Var_Set.NAME, 'VarRef');
  add(ownerId, C.Var.NAME, 'Value', ownerIdOutput,
    C.MicrochipOutput.NAME, 'RER_Input');
  add(ownerIdOutput, C.MicrochipOutput.NAME, 'RER_Output', reply.brick,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6');

  const metadata = {
    name: 'Scrap Runners - Truck1 Stable Owner User ID v11',
    description: 'Keeps the resolved owner PlayerState for existing leaderboard logic and separately publishes its stable user ID for reliable terminal ownership checks.',
    owner: owner(scene),
  };
  const written = writeTruck(scene, metadata);
  return {
    bytes: repack(written.bytes, donor, metadata),
    scene,
    remappedBrickHandles: written.remapped,
  };
}

function finite(value, name) {
  if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite ${name}`);
  else if (Array.isArray(value)) value.forEach((child, index) =>
    finite(child, `${name}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value)
    .forEach(([key, child]) => finite(child, `${name}.${key}`));
}

module.exports = build;
if (require.main === module) {
  const result = build();
  result.scene.bricks.forEach((brick, index) => finite(brick, `truck[${index}]`));
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    remappedBrickHandles: result.remappedBrickHandles,
    ownerProtocol: 'retained PlayerState -> stable user ID -> appearance reply Data6',
  }, null, 2));
}
