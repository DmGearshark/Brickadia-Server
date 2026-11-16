'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {WorldReader} = require('brs-js');
const build = require('./reflow-opticks-large-text-book.cjs');

const TYPES = Object.freeze({
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  text: 'Component_TextDisplay',
});

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function componentAt(reader, grid, brick, type) {
  return one(reader.componentChunk(grid, build.CHUNK).components.filter(component =>
    component.brickIndex === brick && component.typeName === type),
  `${type} on ${grid}:${brick}`);
}

function fileMap(reader) {
  return new Map(reader.fs.listPaths().map(filePath =>
    [filePath, reader.fs.readFile(filePath)]));
}

function assertArchiveIsolation(source, output) {
  const before = fileMap(source);
  const after = fileMap(output);
  assert.deepEqual([...after.keys()].toSorted(), [...before.keys()].toSorted(),
    'Archive path set changed');
  const changed = [];
  for (const [filePath, bytes] of before) {
    if (!Buffer.from(after.get(filePath)).equals(Buffer.from(bytes))) changed.push(filePath);
  }
  assert.deepEqual(changed.toSorted(), [...build.CHANGED_PATHS].toSorted(),
    'Archive-level edit escaped its five intended payloads');
}

function assertPageComponents(source, output, grid, displayMap, data, pageIndex) {
  const sourceComponents = source.componentChunk(grid, build.CHUNK).components;
  const outputComponents = output.componentChunk(grid, build.CHUNK).components;
  assert.equal(outputComponents.length, sourceComponents.length);

  for (const oldComponent of sourceComponents) {
    const component = componentAt(output, grid, oldComponent.brickIndex, oldComponent.typeName);
    const stream = Object.entries(displayMap)
      .find(([, brick]) => brick === oldComponent.brickIndex)?.[0];
    if (oldComponent.typeName !== TYPES.text || !stream) {
      assert.deepEqual(component.data, oldComponent.data,
        `Unrelated page component changed at ${grid}:${oldComponent.brickIndex}`);
      continue;
    }
    assert.equal(component.data.Text, data[stream][pageIndex] ?? '',
      `${stream} opening value on page grid ${grid}`);
    const normalized = structuredClone(component.data);
    normalized.Text = oldComponent.data.Text;
    assert.deepEqual(normalized, oldComponent.data,
      `Display geometry/style changed at ${grid}:${oldComponent.brickIndex}`);
  }
}

function assertLogic(output, data) {
  const spreadCount = Math.ceil(data.textPages.length / 2);
  const cycle = componentAt(output, build.LOGIC_GRID, 0, TYPES.cycle);
  assert.equal(cycle.data.Count, spreadCount);
  assert.equal(cycle.data.Value, spreadCount - 1);

  for (const spec of build.STREAMS) {
    const spread = build.splitSpreads(data[spec.key]);
    for (const side of ['left', 'right']) {
      const getter = componentAt(output, build.LOGIC_GRID, spec[`${side}Get`], TYPES.get);
      const array = componentAt(output, build.LOGIC_GRID, spec[`${side}Array`], TYPES.array);
      const pages = spread[side];
      assert.equal(pages.length, spreadCount);
      assert.equal(getter.data.Index, spreadCount - 1);
      assert.deepEqual(getter.data.Value, {$variant: 'str', value: pages[0]});
      assert.equal(getter.data.bOutOfBounds, false);
      assert.equal(getter.data.ArrayVarRef.Brick.BrickIndexInChunk,
        spec[`${side}Array`]);
      assert.deepEqual(array.data.Value,
        {$elementType: 'str', $array: pages.slice().reverse()},
      `${side} ${spec.key} array`);
    }
  }
}

function assertLeftProseWire(source, output) {
  const before = source.wireChunk(build.LEFT_PAGE_GRID, build.CHUNK);
  const after = output.wireChunk(build.LEFT_PAGE_GRID, build.CHUNK);
  assert.equal(before.local.length, 0);
  assert.equal(after.local.length, 0);
  assert.equal(before.remote.length, 7);
  assert.equal(after.remote.length, 8);
  assert.deepEqual(after.remote.slice(0, 7), before.remote,
    'Existing left-page wires changed');
  assert.deepEqual(after.remote[7], {
    source: {
      brickIndex: 9,
      componentType: TYPES.get,
      port: 'Value',
      gridId: build.LOGIC_GRID,
      chunk: build.CHUNK,
    },
    target: {
      brickIndex: build.LEFT_DISPLAYS.textPages,
      componentType: TYPES.text,
      port: 'Text',
    },
  });
  assert.equal(output.brickChunkIndex(build.LEFT_PAGE_GRID)[0].numWires, 8);
}

function count(reader) {
  let bricks = 0;
  let components = 0;
  let wires = 0;
  for (const grid of reader.gridIds()) {
    for (const chunk of reader.brickChunkIndex(grid)) {
      bricks += chunk.numBricks;
      components += chunk.numComponents;
      wires += chunk.numWires;
    }
  }
  return {grids: reader.gridIds().length, bricks, components, wires};
}

function validate(sourceBytes, outputBytes, data) {
  build.validateData(data);
  const source = WorldReader.from(sourceBytes);
  const output = WorldReader.from(outputBytes);
  assertArchiveIsolation(source, output);
  assert.equal(outputBytes[4], sourceBytes[4], 'Archive index compression mode changed');

  assertPageComponents(source, output, build.LEFT_PAGE_GRID,
    build.LEFT_DISPLAYS, data, 0);
  assertPageComponents(source, output, build.RIGHT_PAGE_GRID,
    build.RIGHT_DISPLAYS, data, 1);
  assertLogic(output, data);
  assertLeftProseWire(source, output);

  const sourceCount = count(source);
  const outputCount = count(output);
  assert.deepEqual({...outputCount, wires: sourceCount.wires}, sourceCount,
    'Grid/brick/component inventory changed');
  assert.equal(outputCount.wires, sourceCount.wires + 1,
    'Exactly one left prose wire should be added');
  assert.equal(componentAt(output, build.LEFT_PAGE_GRID, 2, TYPES.text).data.LineHeight,
    componentAt(source, build.LEFT_PAGE_GRID, 2, TYPES.text).data.LineHeight);
  assert.equal(componentAt(output, build.LEFT_PAGE_GRID, 2, TYPES.text).data.WidthScale, 0.75);
  assert.equal(componentAt(output, build.RIGHT_PAGE_GRID, 6, TYPES.text).data.WidthScale, 0.75);

  return {
    pages: data.textPages.length,
    spreads: Math.ceil(data.textPages.length / 2),
    ...outputCount,
    isolatedPayloads: build.CHANGED_PATHS.length,
  };
}

module.exports = validate;

if (require.main === module) {
  const [sourceFile, outputFile, dataFile] = process.argv.slice(2);
  if (!sourceFile || !outputFile || !dataFile) {
    throw new Error(
      'Usage: node test-opticks-large-text-book.cjs source.brz output.brz pages.json'
    );
  }
  const result = validate(
    fs.readFileSync(sourceFile),
    fs.readFileSync(outputFile),
    JSON.parse(fs.readFileSync(dataFile, 'utf8')),
  );
  console.log(JSON.stringify({ok: true, ...result}, null, 2));
}
