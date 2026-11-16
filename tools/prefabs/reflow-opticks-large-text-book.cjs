'use strict';

// Reflows the existing illustrated Opticks reader into the dimensions measured
// on its left calibration leaf. This is deliberately an archive-level edit:
// the supplied frame, articulated pages, cover, controls, sounds, ownership,
// and every unrelated payload remain byte-for-byte unchanged.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {WorldReader, brdb} = require('brs-js');

const {ByteWriter, file, folder, writeBrzContainer} = brdb;

const CHUNK = Object.freeze({x: -1, y: -1, z: -1});
const CHUNK_STEM = '-1_-1_-1';
const LEFT_PAGE_GRID = 2529926;
const RIGHT_PAGE_GRID = 2529927;
const LOGIC_GRID = 2529929;

const TYPES = Object.freeze({
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  text: 'Component_TextDisplay',
});

// The existing logic is ordered from the bottom image band upward to prose.
// Preserve that order and its wiring; only replace the stored page values.
const STREAMS = Object.freeze([
  {key: 'imagePagesD', leftGet: 1, rightGet: 2, leftArray: 11, rightArray: 12},
  {key: 'imagePagesC', leftGet: 3, rightGet: 4, leftArray: 13, rightArray: 14},
  {key: 'imagePagesB', leftGet: 5, rightGet: 6, leftArray: 15, rightArray: 16},
  {key: 'imagePagesA', leftGet: 7, rightGet: 8, leftArray: 17, rightArray: 18},
  {key: 'textPages', leftGet: 9, rightGet: 10, leftArray: 19, rightArray: 20},
]);

const LEFT_DISPLAYS = Object.freeze({
  textPages: 2,
  imagePagesA: 3,
  imagePagesB: 4,
  imagePagesC: 5,
  imagePagesD: 6,
});

const RIGHT_DISPLAYS = Object.freeze({
  textPages: 6,
  imagePagesA: 5,
  imagePagesB: 4,
  imagePagesC: 3,
  imagePagesD: 2,
});

const componentPath = grid =>
  `World/0/Bricks/Grids/${grid}/Components/${CHUNK_STEM}.mps`;
const wirePath = grid =>
  `World/0/Bricks/Grids/${grid}/Wires/${CHUNK_STEM}.mps`;
const indexPath = grid => `World/0/Bricks/Grids/${grid}/ChunkIndex.mps`;

const CHANGED_PATHS = Object.freeze([
  componentPath(LEFT_PAGE_GRID),
  componentPath(RIGHT_PAGE_GRID),
  componentPath(LOGIC_GRID),
  wirePath(LEFT_PAGE_GRID),
  indexPath(LEFT_PAGE_GRID),
].sort());

function clone(value) {
  return structuredClone(value);
}

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function splitSpreads(pages) {
  const left = [];
  const right = [];
  for (let index = 0; index < pages.length; index += 2) {
    left.push(pages[index]);
    right.push(pages[index + 1] ?? '');
  }
  return {left, right};
}

function validateData(data) {
  assert.equal(data.layout?.textColumns, 47, 'Large-text data must use 47 columns');
  assert.equal(data.layout?.textBodyRows, 29, 'Large-text data must use 29 body rows');
  assert.equal(data.layout?.textLineHeight, 0.8125);
  assert.equal(data.layout?.textWidthScale, 0.75);
  assert.equal(data.layout?.imageArrayCount, 4);
  assert.equal(data.layout?.compactLiveLayout, true);
  assert.equal(data.layout?.maximumActiveImageBottom, 240);
  assert(Array.isArray(data.textPages) && data.textPages.length > 2);
  for (const {key} of STREAMS) {
    assert(Array.isArray(data[key]), `Missing ${key}`);
    assert.equal(data[key].length, data.textPages.length, `${key} page count`);
    for (const [page, value] of data[key].entries()) {
      assert.equal(typeof value, 'string', `${key}[${page}] must be a string`);
      assert(Buffer.byteLength(value, 'utf8') < 32767,
        `${key}[${page}] exceeds Brickadia's string limit`);
    }
  }
  for (const [index, value] of data.textPages.entries()) {
    const rows = value.split('\r\n');
    assert(rows.length <= 31, `Page ${index + 1} has ${rows.length} rows`);
    assert(rows.every(row => row.length <= 47),
      `Page ${index + 1} exceeds the 47-column guide`);
  }
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

function preserveIndexCompression(raw, inputBytes) {
  if (inputBytes[4] !== 1) return raw;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const indexSize = view.getInt32(5, true);
  const index = zlib.zstdCompressSync(raw.subarray(45, 45 + indexSize));
  const bytes = new Uint8Array(45 + index.length + raw.length - 45 - indexSize);
  bytes.set(raw.subarray(0, 45));
  bytes[4] = 1;
  const outputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  outputView.setInt32(9, index.length, true);
  bytes.set(index, 45);
  bytes.set(raw.subarray(45 + indexSize), 45 + index.length);
  return bytes;
}

function encodeComponents(reader, grid, mutate) {
  const decoded = reader.componentChunk(grid, CHUNK);
  const components = decoded.components.map(clone);
  mutate(components);
  const schema = reader.schema('World/0/Bricks/ComponentsShared.schema');
  const writer = new ByteWriter();
  schema.writeValue(writer, 'BRSavedComponentChunkSoA', decoded.soa);
  for (const component of components)
    schema.writeValue(writer, component.structName, component.data);
  return writer.toBytes();
}

function componentAt(components, brickIndex, type) {
  return one(components.filter(component =>
    component.brickIndex === brickIndex && component.typeName === type),
  `${type} on brick ${brickIndex}`);
}

function rewriteLogic(reader, data) {
  const spreadCount = Math.ceil(data.textPages.length / 2);
  const streams = new Map(STREAMS.map(spec => [spec.key, {
    ...spec,
    ...splitSpreads(data[spec.key]),
  }]));

  const bytes = encodeComponents(reader, LOGIC_GRID, components => {
    const cycle = componentAt(components, 0, TYPES.cycle);
    assert.equal(cycle.data.Count, 119, 'Expected the prior 119-spread reader');
    cycle.data.Count = spreadCount;
    cycle.data.Value = spreadCount - 1;

    for (const stream of streams.values()) {
      for (const side of ['left', 'right']) {
        const getterIndex = stream[`${side}Get`];
        const arrayIndex = stream[`${side}Array`];
        const pages = stream[side];
        assert.equal(pages.length, spreadCount);

        const getter = componentAt(components, getterIndex, TYPES.get);
        const array = componentAt(components, arrayIndex, TYPES.array);
        assert.equal(getter.data.ArrayVarRef.Brick.BrickIndexInChunk, arrayIndex,
          `${stream.key} ${side} getter reference`);
        getter.data.Index = spreadCount - 1;
        getter.data.Value = {$variant: 'str', value: pages[0]};
        getter.data.bOutOfBounds = false;
        array.data.Value = {$elementType: 'str', $array: pages.slice().reverse()};
      }
    }
  });
  return {bytes, spreadCount, streams};
}

function rewritePage(reader, grid, displays, pageIndex, data) {
  return encodeComponents(reader, grid, components => {
    for (const {key} of STREAMS) {
      const display = componentAt(components, displays[key], TYPES.text);
      display.data.Text = data[key][pageIndex] ?? '';
      // All geometry and rendering properties are intentionally preserved.
      // The generated art strings carry their own repaginated blank rows.
    }
  });
}

function addLeftProseWire(reader, files) {
  const global = reader.globalData();
  const getType = global.ComponentTypeNames.indexOf(TYPES.get);
  const textType = global.ComponentTypeNames.indexOf(TYPES.text);
  const valuePort = global.ComponentWirePortNames.indexOf('Value');
  const textPort = global.ComponentWirePortNames.indexOf('Text');
  assert([getType, textType, valuePort, textPort].every(index => index >= 0));

  const schema = reader.schema('World/0/Bricks/WiresShared.schema');
  const targetPath = wirePath(LEFT_PAGE_GRID);
  const soa = schema.decode(files.get(targetPath), 'BRSavedWireChunkSoA');
  assert.equal(soa.PendingPropagationFlags.Flags.length, 0);
  assert.equal(soa.RemoteWireSources.length, 7);
  assert.equal(soa.RemoteWireTargets.length, 7);
  assert(!soa.RemoteWireTargets.some(target =>
    target.BrickIndexInChunk === LEFT_DISPLAYS.textPages &&
    target.ComponentTypeIndex === textType && target.PortIndex === textPort),
  'Left prose display is already wired');

  soa.RemoteWireSources.push({
    GridPersistentIndex: LOGIC_GRID,
    ChunkIndex: {X: CHUNK.x, Y: CHUNK.y, Z: CHUNK.z},
    BrickIndexInChunk: 9,
    ComponentTypeIndex: getType,
    PortIndex: valuePort,
  });
  soa.RemoteWireTargets.push({
    BrickIndexInChunk: LEFT_DISPLAYS.textPages,
    ComponentTypeIndex: textType,
    PortIndex: textPort,
  });
  files.set(targetPath, schema.encode('BRSavedWireChunkSoA', soa));

  const chunkSchema = reader.schema('World/0/Bricks/ChunkIndexShared.schema');
  const targetIndexPath = indexPath(LEFT_PAGE_GRID);
  const index = chunkSchema.decode(files.get(targetIndexPath), 'BRSavedBrickChunkIndexSoA');
  const row = index.Chunk3DIndices.findIndex(chunk =>
    chunk.X === CHUNK.x && chunk.Y === CHUNK.y && chunk.Z === CHUNK.z);
  assert(row >= 0, 'Missing left-page chunk index row');
  assert.equal(index.NumWires[row], 7);
  index.NumWires[row] = 8;
  files.set(targetIndexPath,
    chunkSchema.encode('BRSavedBrickChunkIndexSoA', index));
}

function transform(inputBytes, data) {
  validateData(data);
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const original = new Map(archive.listPaths().map(filePath =>
    [filePath, archive.readFile(filePath).slice()]));
  const files = new Map(original);

  for (const grid of [LEFT_PAGE_GRID, RIGHT_PAGE_GRID, LOGIC_GRID]) {
    const refs = reader.brickChunkIndex(grid);
    assert.equal(refs.length, 1, `Expected one chunk in grid ${grid}`);
    assert.deepEqual(refs[0].index, CHUNK);
  }

  const logic = rewriteLogic(reader, data);
  files.set(componentPath(LOGIC_GRID), logic.bytes);
  files.set(componentPath(LEFT_PAGE_GRID),
    rewritePage(reader, LEFT_PAGE_GRID, LEFT_DISPLAYS, 0, data));
  files.set(componentPath(RIGHT_PAGE_GRID),
    rewritePage(reader, RIGHT_PAGE_GRID, RIGHT_DISPLAYS, 1, data));
  addLeftProseWire(reader, files);

  const raw = writeBrzContainer(archiveTree(archive, files), {
    compress: bytes => zlib.zstdCompressSync(bytes),
  });
  const bytes = preserveIndexCompression(raw, inputBytes);
  const output = WorldReader.from(bytes);

  assert.deepEqual(output.fs.listPaths().toSorted(), archive.listPaths().toSorted(),
    'Archive path set changed');
  for (const [filePath, before] of original) {
    const after = output.fs.readFile(filePath);
    if (CHANGED_PATHS.includes(filePath)) {
      assert(!Buffer.from(after).equals(Buffer.from(before)),
        `Expected payload to change: ${filePath}`);
    } else {
      assert(Buffer.from(after).equals(Buffer.from(before)),
        `Unexpected payload changed: ${filePath}`);
    }
  }

  assert.equal(bytes[4], inputBytes[4], 'Archive index compression mode changed');
  assert.equal(output.brickChunkIndex(LEFT_PAGE_GRID)[0].numWires, 8);
  return {
    bytes,
    pages: data.textPages.length,
    spreads: logic.spreadCount,
    changedPaths: [...CHANGED_PATHS],
  };
}

module.exports = {
  transform,
  splitSpreads,
  validateData,
  STREAMS,
  LEFT_DISPLAYS,
  RIGHT_DISPLAYS,
  LEFT_PAGE_GRID,
  RIGHT_PAGE_GRID,
  LOGIC_GRID,
  CHUNK,
  CHANGED_PATHS,
};

if (require.main === module) {
  const [input, dataFile, output] = process.argv.slice(2);
  if (!input || !dataFile || !output) {
    throw new Error(
      'Usage: node reflow-opticks-large-text-book.cjs input.brz pages.json output.brz'
    );
  }
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const result = transform(fs.readFileSync(input), data);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    input,
    dataFile,
    output,
    bytes: result.bytes.length,
    pages: result.pages,
    spreads: result.spreads,
    changedPaths: result.changedPaths,
  }, null, 2));
}
