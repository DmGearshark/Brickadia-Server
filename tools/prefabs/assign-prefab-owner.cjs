'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { WorldReader, brdb } = require('brs-js');

const {
  ByteReader,
  ByteWriter,
  file,
  folder,
  guidToUuid,
  writeBrzContainer,
} = brdb;

function archiveTree(archive, files, prefix = '') {
  const here = name => prefix ? `${prefix}/${name}` : name;
  return [
    ...archive.childFolders(prefix).map(name =>
      [name, folder(archiveTree(archive, files, here(name)))]),
    ...archive.childFiles(prefix).map(name =>
      [name, file(files.get(here(name)))]),
  ];
}

function repackLikeDonor(archive, files, donorBytes) {
  const compressed = donorBytes[4] === 1;
  const raw = writeBrzContainer(
    archiveTree(archive, files),
    compressed ? { compress: data => zlib.zstdCompressSync(data) } : undefined,
  );
  if (!compressed) return raw;

  // Current Brickadia exports zstd-compress the archive index as method 1.
  // brs-js compresses the files but needs this final index conversion.
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const indexSize = view.getInt32(5, true);
  const index = zlib.zstdCompressSync(raw.subarray(45, 45 + indexSize));
  const bytes = new Uint8Array(45 + index.length + (raw.length - 45 - indexSize));
  bytes.set(raw.subarray(0, 45));
  bytes[4] = 1;
  const outputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  outputView.setInt32(9, index.length, true);
  bytes.set(index, 45);
  bytes.set(raw.subarray(45 + indexSize), 45 + index.length);
  return bytes;
}

function selectOwner(reader, requestedId) {
  const owners = reader.owners();
  const ownerIds = owners.UserIds.map(guid => guidToUuid(guid).toLowerCase());
  let targetId = requestedId?.toLowerCase();
  if (!targetId) {
    const bundle = JSON.parse(Buffer.from(reader.fs.readFile('Meta/Bundle.json')).toString());
    const authorIds = (bundle.authors || [])
      .map(author => (author.iD || author.id || '').toLowerCase())
      .filter(Boolean);
    targetId = authorIds.find(id => ownerIds.includes(id));
  }
  if (!targetId) {
    const nonPublic = ownerIds.filter(id => id !== 'ffffffff-ffff-ffff-ffff-ffffffffffff');
    assert.equal(nonPublic.length, 1,
      'Could not infer one non-PUBLIC owner; pass an explicit owner UUID');
    [targetId] = nonPublic;
  }
  const index = ownerIds.indexOf(targetId);
  assert(index >= 0, `Owner UUID ${targetId} is not embedded in this prefab`);
  assert.notEqual(targetId, 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Refusing to assign the prefab to PUBLIC');
  return {
    id: targetId,
    index,
    name: owners.UserNames[index],
    displayName: owners.DisplayNames[index],
  };
}

function transform(inputBytes, requestedId) {
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const owner = selectOwner(reader, requestedId);
  const originalFiles = new Map(
    archive.listPaths().map(filePath => [filePath, archive.readFile(filePath).slice()]),
  );
  const files = new Map(originalFiles);
  const changedPaths = new Set();
  let reassignedBricks = 0;
  let reassignedEntities = 0;

  const mark = (filePath, bytes) => {
    if (!Buffer.from(bytes).equals(Buffer.from(files.get(filePath)))) {
      files.set(filePath, bytes);
      changedPaths.add(filePath);
    }
  };

  const brickSchema = reader.schema('World/0/Bricks/ChunksShared.schema');
  for (const grid of reader.gridIds()) {
    for (const chunk of reader.brickChunkIndex(grid)) {
      const soa = structuredClone(reader.brickChunkSoa(grid, chunk.index));
      assert.equal(soa.OwnerIndices.length, chunk.numBricks);
      assert.equal(soa.OriginalOwnerIndices.length, chunk.numBricks);
      for (let index = 0; index < chunk.numBricks; index++) {
        if (soa.OwnerIndices[index] !== owner.index ||
            soa.OriginalOwnerIndices[index] !== owner.index) reassignedBricks++;
        soa.OwnerIndices[index] = owner.index;
        soa.OriginalOwnerIndices[index] = owner.index;
      }
      const filePath = `World/0/Bricks/Grids/${grid}/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
      mark(filePath, brickSchema.encode('BRSavedBrickChunkSoA', soa));
    }
  }

  const entitySchema = reader.schema('World/0/Entities/ChunksShared.schema');
  for (const chunk of reader.entityChunkIndex().chunks) {
    const filePath = `World/0/Entities/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
    const original = files.get(filePath);
    const byteReader = new ByteReader(original);
    const soa = entitySchema.readValue(byteReader, 'BRSavedEntityChunkSoA');
    assert.equal(soa.OwnerIndices.length, chunk.numEntities);
    assert.equal(soa.OriginalOwnerIndices.length, chunk.numEntities);
    for (let index = 0; index < chunk.numEntities; index++) {
      if (soa.OwnerIndices[index] !== owner.index ||
          soa.OriginalOwnerIndices[index] !== owner.index) reassignedEntities++;
      soa.OwnerIndices[index] = owner.index;
      soa.OriginalOwnerIndices[index] = owner.index;
    }
    const byteWriter = new ByteWriter();
    entitySchema.writeValue(byteWriter, 'BRSavedEntityChunkSoA', soa);
    const prefix = byteWriter.toBytes();
    assert.equal(prefix.length, byteReader.offset,
      `Entity ownership rewrite changed the header size in ${filePath}`);
    const bytes = new Uint8Array(original.length);
    bytes.set(prefix);
    bytes.set(original.subarray(byteReader.offset), prefix.length);
    mark(filePath, bytes);
  }

  const bytes = repackLikeDonor(archive, files, inputBytes);
  WorldReader.from(bytes); // Parse once before returning any user-facing file.
  return {
    bytes,
    owner,
    reassignedBricks,
    reassignedEntities,
    changedPaths: [...changedPaths].sort(),
    originalFiles,
  };
}

module.exports = { transform, selectOwner };

if (require.main === module) {
  const [input, output, ownerId] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: node assign-prefab-owner.cjs input.brz output.brz [owner-uuid]');
  const result = transform(fs.readFileSync(input), ownerId);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    input,
    output,
    bytes: result.bytes.length,
    owner: result.owner,
    reassignedBricks: result.reassignedBricks,
    reassignedEntities: result.reassignedEntities,
    changedPaths: result.changedPaths,
  }, null, 2));
}
