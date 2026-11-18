'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v9.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v10.brz'));

const clone = structuredClone;

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

// A normal write renumbers bricks. Re-map all stored BrickHandles through a
// first pass so the truck body reference array remains valid and byte-stable.
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
    const previous = incoming(brick, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === brick.key
      && edge.zt === type && edge.q === port));
    return previous;
  };
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert.equal(incoming(target, targetType, targetPort).length, 0,
      `duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key,
      at: sourceType,
      p: sourcePort,
      z: target.key,
      zt: targetType,
      q: targetPort,
    });
  };

  const ownerOutput = one(rows.filter(item => item.comp.type === C.MicrochipOutput.NAME
    && item.comp.data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerVar = scene.bricks.find(brick => brick.key === one(incoming(ownerOutput,
    C.MicrochipOutput.NAME, 'RER_Input'), 'owner output Var').a);
  assert(ownerVar?.comps.some(comp => comp.type === C.Var.NAME), 'retained owner Var');
  const ownerSetter = scene.bricks.find(brick => brick.key === one(outgoing(ownerVar,
    C.Var.NAME, 'VarRef').filter(edge => edge.zt === C.Exec_Var_Set.NAME),
  'owner setter').z);

  const oldExec = one(incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Exec'),
    'UpdateCar directly executes owner setter');
  const oldValue = one(incoming(ownerSetter, C.Exec_Var_Set.NAME, 'Value'),
    'UpdateCar directly supplies owner setter value');
  assert.equal(oldExec.a, oldValue.a, 'owner setter execution and value share UpdateCar');
  const update = scene.bricks.find(brick => brick.key === oldExec.a);
  const updateComp = update?.comps.find(comp => comp.type === C.Event_CustomGlobal.NAME);
  assert(updateComp && updateComp.data.EventName === 'UpdateCar',
    'owner setter is driven by UpdateCar');
  assert.equal(oldExec.a, update.key);
  assert.equal(oldExec.at, C.Event_CustomGlobal.NAME);
  assert.equal(oldExec.p, 'ExecOut');
  assert.equal(oldValue.a, update.key);
  assert.equal(oldValue.at, C.Event_CustomGlobal.NAME);
  assert.equal(oldValue.p, 'DataOut1');
  removeInput(ownerSetter, C.Exec_Var_Set.NAME, 'Exec');
  removeInput(ownerSetter, C.Exec_Var_Set.NAME, 'Value');

  // The existing spawner sends the claim button's Character on UpdateCar
  // Data1. Resolve it once, while that Character is live, and retain its stable
  // PlayerState for leaderboard reads and terminal ownership checks.
  const definition = C.Exec_PlayerState_GetFromEntity;
  const base = clone(ownerSetter.data);
  Object.assign(base, {
    asset: definition.BRICK,
    position: [105, -5, 2],
    direction: 4,
    rotation: 0,
    size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
    color: [225, 75, 95],
    material_intensity: 5,
  });
  const resolver = {
    key: 'v10:12:resolve_owner_player_state',
    g: update.g,
    data: base,
    comps: [
      { type: definition.NAME, data: {} },
      {
        type: C.Interact.NAME,
        data: {
          InteractSound: 0,
          Message: 'Resolve spawning Character to Owner PlayerState',
          ConsoleTag: '',
          bAllowNearbyInteraction: true,
          bHiddenInteraction: false,
          PromptCustomLabel: 'Resolve spawning Character to Owner PlayerState',
        },
      },
    ],
  };
  scene.bricks.push(resolver);
  ownerSetter.data.position = [115, -5, 2];
  ownerVar.data.position = [125, -5, 2];
  ownerOutput.data.position = [135, -5, 2];
  add(update, C.Event_CustomGlobal.NAME, 'ExecOut', resolver,
    definition.NAME, 'Exec');
  add(update, C.Event_CustomGlobal.NAME, 'DataOut1', resolver,
    definition.NAME, 'Entity');
  add(resolver, definition.NAME, 'ExecOut', ownerSetter,
    C.Exec_Var_Set.NAME, 'Exec');
  add(resolver, definition.NAME, 'PlayerState', ownerSetter,
    C.Exec_Var_Set.NAME, 'Value');

  const metadata = {
    name: 'Scrap Runners - Truck1 Stable Owner PlayerState v10',
    description: 'Converts the spawner-provided claim Character into a stable PlayerState before retaining it, so Truck1 owner checks and leaderboard reads use the correct object type.',
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
    ownerNormalization: 'UpdateCar Character -> PlayerState -> retained Owner PlayerState',
  }, null, 2));
}
