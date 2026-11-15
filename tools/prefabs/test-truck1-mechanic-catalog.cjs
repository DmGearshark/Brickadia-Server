'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {WorldReader, brdb} = require('brs-js');
const {ROWS, GROUPS, validateRows} = require('./populate-truck1-mechanic-catalog.cjs');

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath)
  throw new Error('Usage: node test-truck1-mechanic-catalog.cjs source.brz output.brz');

const source = WorldReader.from(fs.readFileSync(sourcePath));
const output = WorldReader.from(fs.readFileSync(outputPath));
const componentPath = 'World/0/Bricks/Grids/1/Components/-1_-1_-1.mps';
const chunk = {x: -1, y: -1, z: -1};

assert.deepEqual(output.fs.listPaths(), source.fs.listPaths());
for (const filePath of source.fs.listPaths()) {
  if (filePath === componentPath) continue;
  assert(Buffer.from(output.fs.readFile(filePath)).equals(
    Buffer.from(source.fs.readFile(filePath))), `Unexpected change: ${filePath}`);
}

assert.deepEqual(output.gridIds(), [1]);
assert.deepEqual(output.brickChunkIndex(1), source.brickChunkIndex(1));
const index = output.brickChunkIndex(1)[0];
assert.deepEqual({bricks: index.numBricks, components: index.numComponents, wires: index.numWires},
  {bricks: 1, components: 1, wires: 0});

const components = output.componentChunk(1, chunk).components;
assert.equal(components.length, 1);
assert.equal(components[0].typeName, brdb.COMPONENTS.MapVar.NAME);
assert.deepEqual(components[0].data.Value, {
  $keyType: 'str',
  $valueType: 'str',
  $map: ROWS,
});
validateRows(components[0].data.Value.$map);

const rowsByGroup = new Map([...GROUPS].map(([group]) =>
  [group, ROWS.filter(([key]) => key.startsWith(`${group}.`))]));
assert.equal(rowsByGroup.get('Truck1Owned.Engine').at(-1)[1],
  'The Slow Turtle Engine|Truck1Engine|4|10000');
assert.equal(rowsByGroup.get('Truck1Owned.FuelTank')[1][1],
  'Mid 25000|Truck1Fueltank|1|5000');
assert.equal(rowsByGroup.get('Truck1Owned.WheelSpacing')[3][1],
  '7.5|Truck1Wheelspacing|3|3000');
assert(rowsByGroup.get('Truck1Owned.SteerAngle').every(([, value]) => value.endsWith('|0')));
assert(rowsByGroup.get('Truck1Owned.SteerTurnSpeed').every(([, value]) => value.endsWith('|0')));

console.log(JSON.stringify({
  output: outputPath,
  rows: ROWS.length,
  categories: GROUPS.size,
  onlyMapComponentChanged: true,
  exactRowsVerified: true,
}, null, 2));
