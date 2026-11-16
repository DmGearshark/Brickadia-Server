'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { WorldReader, brdb } = require('brs-js');
const { transform } = require('./assign-prefab-owner.cjs');
const validatePlacement = require('./validate-placement.cjs');

const TARGET_ID = 'afee2120-d5ad-44d5-97ef-b3a20552e7cf';

function normalizeOwnership(soa) {
  const copy = structuredClone(soa);
  delete copy.OwnerIndices;
  delete copy.OriginalOwnerIndices;
  return copy;
}

function entitySoa(reader, chunk) {
  const filePath = `World/0/Entities/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
  const byteReader = new brdb.ByteReader(reader.fs.readFile(filePath));
  const soa = reader.schema('World/0/Entities/ChunksShared.schema')
    .readValue(byteReader, 'BRSavedEntityChunkSoA');
  return { filePath, soa, tail: reader.fs.readFile(filePath).subarray(byteReader.offset) };
}

function test(inputPath) {
  const inputBytes = fs.readFileSync(inputPath);
  const source = WorldReader.from(inputBytes);
  const result = transform(inputBytes, TARGET_ID);
  const output = WorldReader.from(result.bytes);
  const placement = validatePlacement(result.bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));

  assert.deepEqual(result.owner, {
    id: TARGET_ID,
    index: 0,
    name: 'Gearshark',
    displayName: 'Gearshark',
  });
  assert.equal(result.reassignedBricks, 309);
  assert.equal(result.reassignedEntities, 3);
  assert.deepEqual(result.changedPaths, [
    'World/0/Bricks/Grids/1/Chunks/-10_-19_1.mps',
    'World/0/Bricks/Grids/912999/Chunks/-1_-1_-1.mps',
    'World/0/Bricks/Grids/913000/Chunks/-1_-1_-1.mps',
    'World/0/Bricks/Grids/913001/Chunks/-1_-1_-1.mps',
    'World/0/Entities/Chunks/0_0_0.mps',
  ]);

  const sourcePaths = source.fs.listPaths().sort();
  const outputPaths = output.fs.listPaths().sort();
  assert.deepEqual(outputPaths, sourcePaths, 'archive path set is preserved');
  for (const filePath of sourcePaths) {
    if (result.changedPaths.includes(filePath)) continue;
    assert(Buffer.from(output.fs.readFile(filePath))
      .equals(Buffer.from(source.fs.readFile(filePath))),
    `non-ownership payload changed: ${filePath}`);
  }

  assert.deepEqual(output.owners(), source.owners(), 'owner table and counts are unchanged');
  const bundle = JSON.parse(Buffer.from(output.fs.readFile('Meta/Bundle.json')).toString());
  assert(bundle.authors.some(author => (author.iD || author.id).toLowerCase() === TARGET_ID));
  assert.deepEqual(output.prefabJson(), source.prefabJson());
  assert.deepEqual(output.externalAssets(), source.externalAssets());
  assert.deepEqual(output.gridIds(), source.gridIds());
  assert.equal(output.prefabPaths().length, 0, 'no embedded prefab ownership was skipped');

  let brickCount = 0;
  let componentCount = 0;
  let wireCount = 0;
  for (const grid of source.gridIds()) {
    const sourceChunks = source.brickChunkIndex(grid);
    const outputChunks = output.brickChunkIndex(grid);
    assert.deepEqual(outputChunks, sourceChunks, `chunk index changed for grid ${grid}`);
    for (let index = 0; index < sourceChunks.length; index++) {
      const chunk = sourceChunks[index];
      const before = source.brickChunkSoa(grid, chunk.index);
      const after = output.brickChunkSoa(grid, chunk.index);
      assert.deepEqual(normalizeOwnership(after), normalizeOwnership(before),
        `non-owner brick data changed in grid ${grid}`);
      assert(after.OwnerIndices.every(ownerIndex => ownerIndex === result.owner.index));
      assert(after.OriginalOwnerIndices.every(ownerIndex => ownerIndex === result.owner.index));
      brickCount += chunk.numBricks;
      componentCount += chunk.numComponents;
      wireCount += chunk.numWires;
    }
  }
  assert.equal(brickCount, 330);
  assert.equal(componentCount, 299);
  assert.equal(wireCount, 425);

  const sourceEntityChunks = source.entityChunkIndex().chunks;
  const outputEntityChunks = output.entityChunkIndex().chunks;
  assert.deepEqual(outputEntityChunks, sourceEntityChunks);
  for (let index = 0; index < sourceEntityChunks.length; index++) {
    const before = entitySoa(source, sourceEntityChunks[index]);
    const after = entitySoa(output, outputEntityChunks[index]);
    assert.deepEqual(normalizeOwnership(after.soa), normalizeOwnership(before.soa),
      'non-owner entity data changed');
    assert(after.soa.OwnerIndices.every(ownerIndex => ownerIndex === result.owner.index));
    assert(after.soa.OriginalOwnerIndices.every(ownerIndex => ownerIndex === result.owner.index));
    assert(Buffer.from(after.tail).equals(Buffer.from(before.tail)),
      'entity class-data tail changed');
  }
  const entities = [...output.entities()];
  assert.equal(entities.length, 3);
  assert(entities.every(entity => entity.ownerIndex === result.owner.index));
  assert(entities.every(entity => entity.originalOwnerIndex === result.owner.index));

  const second = transform(result.bytes, TARGET_ID);
  assert.equal(second.reassignedBricks, 0);
  assert.equal(second.reassignedEntities, 0);
  assert.deepEqual(second.changedPaths, []);
  assert(Buffer.from(second.bytes).equals(Buffer.from(result.bytes)),
    'ownership rewrite is byte-identical when repeated');

  return { result, placement, brickCount, componentCount, wireCount, entities: entities.length };
}

module.exports = test;

if (require.main === module) {
  const input = process.argv[2];
  assert(input, 'Usage: node test-assign-prefab-owner.cjs input.brz');
  const checked = test(input);
  console.log(JSON.stringify({
    ok: true,
    owner: checked.result.owner,
    reassignedBricks: checked.result.reassignedBricks,
    reassignedEntities: checked.result.reassignedEntities,
    bricks: checked.brickCount,
    components: checked.componentCount,
    wires: checked.wireCount,
    entities: checked.entities,
    strictPlacement: checked.placement.strictOk,
    changedPaths: checked.result.changedPaths,
  }, null, 2));
}
