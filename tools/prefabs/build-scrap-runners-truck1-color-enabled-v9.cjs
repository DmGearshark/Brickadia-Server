'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v8.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v9.brz'));

const O = value => ({ $variant: 'weak_object', value });

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
  const reply = one(rows.filter(item => item.comp.type === C.Exec_SendCustomEventGlobal.NAME
    && item.comp.data.EventName === 'SR.Appearance.Reply'), 'appearance reply');
  const ownerOutput = one(rows.filter(item => item.comp.type === C.MicrochipOutput.NAME
    && item.comp.data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output');
  assert.equal(scene.edges.filter(edge => edge.z === reply.brick.key
    && edge.zt === C.Exec_SendCustomEventGlobal.NAME && edge.q === 'DataIn6').length, 0,
  'v8 reply DataIn6 is unused');
  assert.equal(reply.comp.data.DataIn6?.$variant, 'f64',
    'v8 reply DataIn6 has the unused numeric type');

  reply.comp.data.DataIn6 = O(null);
  scene.edges.push({
    a: ownerOutput.brick.key,
    at: C.MicrochipOutput.NAME,
    p: 'RER_Output',
    z: reply.brick.key,
    zt: C.Exec_SendCustomEventGlobal.NAME,
    q: 'DataIn6',
  });

  const metadata = {
    name: 'Scrap Runners - Truck1 Owner Appearance Reply v9',
    description: 'Truck1 v8 with its existing spawner-provided Owner PlayerState exposed as SR.Appearance.Reply Data6 for terminal ownership validation.',
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
    ownerReply: 'Owner PlayerState -> SR.Appearance.Reply Data6',
  }, null, 2));
}
