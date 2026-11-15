'use strict';

// Populates the existing Truck1 brick-handle array with every visible blue
// body/cosmetic brick. This is intentionally an archive-level, one-payload
// edit: no wiring, function logic, truck geometry, or component behavior is
// changed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {WorldReader, brdb} = require('brs-js');

const {ByteWriter, file, folder, writeBrzContainer} = brdb;

const CONFIG_GRID = 995065;
const ARRAY_BRICK = 29;
const CHUNK = {x: -1, y: -1, z: -1};
const CHUNK_STEM = '-1_-1_-1';
const COMPONENT_PATH =
  `World/0/Bricks/Grids/${CONFIG_GRID}/Components/${CHUNK_STEM}.mps`;

const BLUE = [0, 138, 184];
const BODY_REFS = Object.freeze([
  ...[2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 32, 34, 35, 36,
    54, 55, 57, 58, 59, 60, 61, 64, 65, 71, 72, 73, 81, 86]
    .map(index => [981257, index]),
  [981255, 1],
  [981260, 0],
  [981261, 1],
]);

const EXCLUDED_BLUE_REFS = Object.freeze([
  [981257, 4],   // hidden WheelEngine
  [981257, 98],  // rigid bearing
  [981254, 1],   // hidden wheel joint
  [981259, 1],   // hidden wheel joint
]);

function clone(value) {
  return structuredClone(value);
}

function archiveTree(archive, files, prefix = '') {
  const here = name => prefix ? `${prefix}/${name}` : name;
  return [
    ...archive.childFolders(prefix).map(name =>
      [name, folder(archiveTree(archive, files, here(name)))]),
    ...archive.childFiles(prefix).map(name =>
      [name, file(files.get(here(name)))]),
  ];
}

function reference(grid, brick) {
  return {
    GridPersistentIndex: grid,
    ChunkIndex: {X: CHUNK.x, Y: CHUNK.y, Z: CHUNK.z},
    BrickIndexInChunk: brick,
  };
}

function key(grid, brick) {
  return `${grid}:${brick}`;
}

function componentsAt(reader, grid, brick) {
  return reader.componentChunk(grid, CHUNK).components
    .filter(component => component.brickIndex === brick);
}

function validateBodySelection(reader) {
  const seen = new Set();
  for (const [grid, brick] of BODY_REFS) {
    assert(!seen.has(key(grid, brick)), `Duplicate body reference ${key(grid, brick)}`);
    seen.add(key(grid, brick));
    const chunk = reader.brickChunkIndex(grid);
    assert.equal(chunk.length, 1, `Expected one chunk in body grid ${grid}`);
    assert.deepEqual(chunk[0].index, CHUNK);
    const saved = [...reader.bricks(grid)][brick];
    assert(saved, `Missing body brick ${key(grid, brick)}`);
    assert.deepEqual(saved.color, BLUE, `Body brick is no longer blue: ${key(grid, brick)}`);
    assert.equal(saved.visibility, true, `Body brick is hidden: ${key(grid, brick)}`);
    const asset = reader.brickAssets()[saved.asset_name_index];
    assert(/^PB_Default(?:Tile|RampInverted|MicroWedge|MicroBrick|Brick)$/.test(asset),
      `Unexpected body asset ${asset} at ${key(grid, brick)}`);
    const componentTypes = componentsAt(reader, grid, brick).map(c => c.typeName);
    assert(componentTypes.every(type =>
      type === 'Component_TextDisplay' || type === 'Component_Switch'),
    `Unexpected component on body brick ${key(grid, brick)}: ${componentTypes.join(', ')}`);
  }

  for (const [grid, brick] of EXCLUDED_BLUE_REFS)
    assert(!seen.has(key(grid, brick)), `Mechanical blue brick was included: ${key(grid, brick)}`);
  assert.equal(seen.size, 31);
}

function encodeComponents(reader) {
  const decoded = reader.componentChunk(CONFIG_GRID, CHUNK);
  const components = decoded.components.map(component => clone(component));
  const array = components.find(component =>
    component.brickIndex === ARRAY_BRICK &&
    component.typeName === 'BrickComponentType_ArrayVar');
  assert(array, 'Missing Truck1 color-target array');
  assert.deepEqual(array.data.Value, {$elementType: 'brick_handle', $array: []},
    'Expected the supplied target array to be empty');
  array.data.Value = {
    $elementType: 'brick_handle',
    $array: BODY_REFS.map(([grid, brick]) => reference(grid, brick)),
  };

  const schema = reader.schema('World/0/Bricks/ComponentsShared.schema');
  const writer = new ByteWriter();
  schema.writeValue(writer, 'BRSavedComponentChunkSoA', decoded.soa);
  for (const component of components)
    schema.writeValue(writer, component.structName, component.data);
  return writer.toBytes();
}

function transform(inputBytes) {
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const original = new Map(archive.listPaths().map(filePath =>
    [filePath, archive.readFile(filePath).slice()]));
  const files = new Map(original);

  validateBodySelection(reader);
  const config = reader.brickChunkIndex(CONFIG_GRID);
  assert.equal(config.length, 1);
  assert.deepEqual(config[0].index, CHUNK);
  assert.equal(config[0].numComponents, 48);
  files.set(COMPONENT_PATH, encodeComponents(reader));

  const bytes = writeBrzContainer(archiveTree(archive, files), {
    compress: data => zlib.zstdCompressSync(data),
  });
  const output = WorldReader.from(bytes);

  assert.deepEqual(output.fs.listPaths().toSorted(), archive.listPaths().toSorted(),
    'Archive path set changed');
  for (const [filePath, before] of original) {
    const after = output.fs.readFile(filePath);
    if (filePath === COMPONENT_PATH) {
      assert(!Buffer.from(after).equals(Buffer.from(before)),
        'Expected array component payload to change');
      continue;
    }
    assert(Buffer.from(after).equals(Buffer.from(before)),
      `Unexpected payload changed: ${filePath}`);
  }

  validateBodySelection(output);
  const savedArray = output.componentChunk(CONFIG_GRID, CHUNK).components.find(component =>
    component.brickIndex === ARRAY_BRICK &&
    component.typeName === 'BrickComponentType_ArrayVar');
  assert.deepEqual(savedArray.data.Value.$array,
    BODY_REFS.map(([grid, brick]) => reference(grid, brick)));

  return {
    bytes,
    entries: BODY_REFS.length,
    mainBodyEntries: BODY_REFS.filter(([grid]) => grid === 981257).length,
    movablePanelEntries: BODY_REFS.filter(([grid]) => grid !== 981257).length,
    changedPath: COMPONENT_PATH,
  };
}

module.exports = {transform, BODY_REFS, EXCLUDED_BLUE_REFS, CONFIG_GRID, ARRAY_BRICK, CHUNK};

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: node populate-truck1-blue-body-array.cjs input.brz output.brz');
  const result = transform(fs.readFileSync(input));
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    input,
    output,
    bytes: result.bytes.length,
    entries: result.entries,
    mainBodyEntries: result.mainBodyEntries,
    movablePanelEntries: result.movablePanelEntries,
    changedPath: result.changedPath,
  }, null, 2));
}
