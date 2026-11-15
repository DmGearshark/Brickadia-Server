'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {WorldReader} = require('brs-js');
const {
  BODY_REFS,
  EXCLUDED_BLUE_REFS,
  CONFIG_GRID,
  ARRAY_BRICK,
  CHUNK,
} = require('./populate-truck1-blue-body-array.cjs');

function refKey(ref) {
  return `${ref.GridPersistentIndex}:${ref.ChunkIndex.X},${ref.ChunkIndex.Y},${ref.ChunkIndex.Z}:${ref.BrickIndexInChunk}`;
}

function expectedKey([grid, brick]) {
  return `${grid}:-1,-1,-1:${brick}`;
}

function validate(outputPath) {
  const bytes = fs.readFileSync(outputPath);
  const reader = WorldReader.from(bytes);
  const array = reader.componentChunk(CONFIG_GRID, CHUNK).components.find(component =>
    component.brickIndex === ARRAY_BRICK &&
    component.typeName === 'BrickComponentType_ArrayVar');
  assert(array, 'Missing Truck1 color-target array');
  assert.equal(array.data.Value.$elementType, 'brick_handle');
  assert.equal(array.data.Value.$array.length, 31);

  const actual = array.data.Value.$array.map(refKey);
  const expected = BODY_REFS.map(expectedKey);
  assert.deepEqual(actual, expected, 'Blue body reference order/content changed');
  assert.equal(new Set(actual).size, 31, 'References must be unique');
  for (const excluded of EXCLUDED_BLUE_REFS)
    assert(!actual.includes(expectedKey(excluded)),
      `Mechanical brick was included: ${expectedKey(excluded)}`);

  for (const ref of array.data.Value.$array) {
    const grid = ref.GridPersistentIndex;
    const brick = ref.BrickIndexInChunk;
    const saved = [...reader.bricks(grid)][brick];
    assert(saved, `Broken reference ${refKey(ref)}`);
    assert.deepEqual(saved.color, [0, 138, 184]);
    assert.equal(saved.visibility, true);
  }

  return {
    output: outputPath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    arrayEntries: actual.length,
    mainBodyEntries: BODY_REFS.filter(([grid]) => grid === 981257).length,
    movablePanelEntries: BODY_REFS.filter(([grid]) => grid !== 981257).length,
    excludedMechanicalEntries: EXCLUDED_BLUE_REFS.length,
  };
}

if (require.main === module) {
  const [output] = process.argv.slice(2);
  if (!output)
    throw new Error('Usage: node test-truck1-blue-body-array.cjs output.brz');
  console.log(JSON.stringify(validate(output), null, 2));
}

module.exports = {validate};
