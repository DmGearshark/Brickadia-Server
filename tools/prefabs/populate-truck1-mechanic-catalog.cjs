'use strict';

// Replaces only the editable String -> String mechanic-shop catalogue map.
// The source clipboard prefab contains one MapVar brick and no wiring, so an
// archive-level component edit preserves every other payload byte-for-byte.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {WorldReader, brdb} = require('brs-js');

const {ByteWriter, file, folder, writeBrzContainer} = brdb;
const GRID = 1;
const CHUNK = {x: -1, y: -1, z: -1};
const CHUNK_STEM = '-1_-1_-1';
const COMPONENT_PATH = `World/0/Bricks/Grids/${GRID}/Components/${CHUNK_STEM}.mps`;
const COMPONENT_SCHEMA_PATH = 'World/0/Bricks/ComponentsShared.schema';
const MAP_TYPE = 'BrickComponentType_MapVar';

const ROWS = [
  ['Truck1Owned.Engine.0', 'Stock Shitter|Truck1Engine|0|0'],
  ['Truck1Owned.Engine.1', 'RedNeck Engine|Truck1Engine|1|2500'],
  ['Truck1Owned.Engine.2', 'Backyard Engine|Truck1Engine|2|5000'],
  ['Truck1Owned.Engine.3', 'A Real Engine|Truck1Engine|3|15000'],
  ['Truck1Owned.Engine.4', 'The Slow Turtle Engine|Truck1Engine|4|10000'],

  ['Truck1Owned.FuelTank.0', 'Starter 20000|Truck1Fueltank|0|0'],
  ['Truck1Owned.FuelTank.1', 'Mid 25000|Truck1Fueltank|1|5000'],
  ['Truck1Owned.FuelTank.2', 'Large 30000|Truck1Fueltank|2|10000'],

  ['Truck1Owned.Suspension.0', '500|Truck1Suspension|0|1000'],
  ['Truck1Owned.Suspension.1', '1000|Truck1Suspension|1|2000'],
  ['Truck1Owned.Suspension.2', '1500|Truck1Suspension|2|2000'],
  ['Truck1Owned.Suspension.3', '2000|Truck1Suspension|3|2000'],
  ['Truck1Owned.Suspension.4', '2500|Truck1Suspension|4|2000'],

  ['Truck1Owned.WheelSpacing.0', '0|Truck1Wheelspacing|0|0'],
  ['Truck1Owned.WheelSpacing.1', '2.5|Truck1Wheelspacing|1|500'],
  ['Truck1Owned.WheelSpacing.2', '5|Truck1Wheelspacing|2|1500'],
  ['Truck1Owned.WheelSpacing.3', '7.5|Truck1Wheelspacing|3|3000'],
  ['Truck1Owned.WheelSpacing.4', '10|Truck1Wheelspacing|4|10000'],

  ['Truck1Owned.SteerAngle.0', '30|Truck1Steerangle|0|0'],
  ['Truck1Owned.SteerAngle.1', '35|Truck1Steerangle|1|0'],
  ['Truck1Owned.SteerAngle.2', '40|Truck1Steerangle|2|0'],
  ['Truck1Owned.SteerAngle.3', '45|Truck1Steerangle|3|0'],
  ['Truck1Owned.SteerAngle.4', '50|Truck1Steerangle|4|0'],
  ['Truck1Owned.SteerAngle.5', '55|Truck1Steerangle|5|0'],
  ['Truck1Owned.SteerAngle.6', '60|Truck1Steerangle|6|0'],

  ['Truck1Owned.SteerTurnSpeed.0', '0.05|Truck1Steerturnspeed|0|0'],
  ['Truck1Owned.SteerTurnSpeed.1', '0.1|Truck1Steerturnspeed|1|0'],
  ['Truck1Owned.SteerTurnSpeed.2', '0.2|Truck1Steerturnspeed|2|0'],
];

const GROUPS = new Map([
  ['Truck1Owned.Engine', {count: 5, stat: 'Truck1Engine'}],
  ['Truck1Owned.FuelTank', {count: 3, stat: 'Truck1Fueltank'}],
  ['Truck1Owned.Suspension', {count: 5, stat: 'Truck1Suspension'}],
  ['Truck1Owned.WheelSpacing', {count: 5, stat: 'Truck1Wheelspacing'}],
  ['Truck1Owned.SteerAngle', {count: 7, stat: 'Truck1Steerangle'}],
  ['Truck1Owned.SteerTurnSpeed', {count: 3, stat: 'Truck1Steerturnspeed'}],
]);

function archiveTree(archive, files, prefix = '') {
  const here = name => prefix ? `${prefix}/${name}` : name;
  return [
    ...archive.childFolders(prefix).map(name =>
      [name, folder(archiveTree(archive, files, here(name)))]),
    ...archive.childFiles(prefix).map(name =>
      [name, file(files.get(here(name)))]),
  ];
}

function validateRows(rows) {
  assert.equal(rows.length, 28);
  assert.equal(new Set(rows.map(([key]) => key)).size, rows.length,
    'Catalogue keys must be unique');
  const seen = new Map([...GROUPS].map(([group]) => [group, []]));

  for (const [key, value] of rows) {
    const match = /^(Truck1Owned\.[A-Za-z]+)\.(\d+)$/.exec(key);
    assert(match, `Invalid catalogue key: ${key}`);
    const group = match[1];
    const position = Number(match[2]);
    assert(GROUPS.has(group), `Unexpected category: ${group}`);

    const fields = value.split('|');
    assert.equal(fields.length, 4, `Expected four fields: ${key}`);
    const [name, stat, savedText, priceText] = fields;
    const saved = Number(savedText);
    const price = Number(priceText);
    assert(name.length > 0, `Missing display name: ${key}`);
    assert.equal(stat, GROUPS.get(group).stat, `Wrong leaderboard key: ${key}`);
    assert(Number.isInteger(saved) && saved >= 0, `Invalid saved profile ID: ${key}`);
    assert(Number.isInteger(price) && price >= 0, `Invalid Scrap price: ${key}`);
    assert.equal(saved, position, `Saved profile ID must match profile-array index: ${key}`);
    seen.get(group).push(position);
  }

  for (const [group, {count}] of GROUPS) {
    const positions = seen.get(group).sort((a, b) => a - b);
    assert.deepEqual(positions, Array.from({length: count}, (_, i) => i),
      `Display positions must be contiguous: ${group}`);
  }
}

function transform(inputBytes) {
  validateRows(ROWS);
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const original = new Map(archive.listPaths().map(filePath =>
    [filePath, archive.readFile(filePath).slice()]));
  const files = new Map(original);

  assert.deepEqual(reader.gridIds(), [GRID]);
  const chunks = reader.brickChunkIndex(GRID);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].index, CHUNK);
  assert.equal(chunks[0].numBricks, 1);
  assert.equal(chunks[0].numComponents, 1);
  assert.equal(chunks[0].numWires, 0);

  const decoded = reader.componentChunk(GRID, CHUNK);
  assert.equal(decoded.components.length, 1);
  const component = structuredClone(decoded.components[0]);
  assert.equal(component.typeName, MAP_TYPE);
  assert.equal(component.data.Value.$keyType, 'str');
  assert.equal(component.data.Value.$valueType, 'str');
  component.data.Value.$map = structuredClone(ROWS);

  const schema = reader.schema(COMPONENT_SCHEMA_PATH);
  const writer = new ByteWriter();
  schema.writeValue(writer, 'BRSavedComponentChunkSoA', decoded.soa);
  schema.writeValue(writer, component.structName, component.data);
  files.set(COMPONENT_PATH, writer.toBytes());

  const bytes = writeBrzContainer(archiveTree(archive, files), {
    compress: data => zlib.zstdCompressSync(data),
  });
  const output = WorldReader.from(bytes);

  assert.deepEqual(output.fs.listPaths(), archive.listPaths(),
    'Archive path set changed');
  for (const [filePath, before] of original) {
    if (filePath === COMPONENT_PATH) continue;
    assert(Buffer.from(output.fs.readFile(filePath)).equals(Buffer.from(before)),
      `Unexpected archive payload changed: ${filePath}`);
  }
  assert.deepEqual(output.prefabJson(), reader.prefabJson(), 'Prefab metadata changed');
  assert.deepEqual(output.brickChunkIndex(GRID), chunks, 'Brick chunk index changed');
  const parsed = output.componentChunk(GRID, CHUNK).components;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].typeName, MAP_TYPE);
  assert.deepEqual(parsed[0].data.Value, {
    $keyType: 'str',
    $valueType: 'str',
    $map: ROWS,
  });
  validateRows(parsed[0].data.Value.$map);

  return {bytes, stats: {
    rows: ROWS.length,
    categories: GROUPS.size,
    bricks: 1,
    components: 1,
    wires: 0,
    onlyComponentPayloadChanged: true,
  }};
}

module.exports = {ROWS, GROUPS, transform, validateRows};

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: node populate-truck1-mechanic-catalog.cjs input.brz output.brz');
  const result = transform(fs.readFileSync(input));
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({input, output, bytes: result.bytes.length, ...result.stats}, null, 2));
}
