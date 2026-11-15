'use strict';

// Surgically removes the in-world waypoint recorder/deleter from the supplied
// vehicle while preserving the hand-authored waypoint array and follower.
// This intentionally edits only the two chunks that own those bricks, plus
// any wire chunks whose endpoint indices have to be remapped. Every unrelated
// archive payload remains byte-for-byte identical after decompression.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { WorldReader, brdb } = require('brs-js');

const {
  ByteWriter,
  file,
  folder,
  writeBrzContainer,
} = brdb;

const CONTROLLER_GRID = 61710;
const VEHICLE_GRID = 61706;
const CHUNK = { x: -1, y: -1, z: -1 };

// These are the complete record and delete paths in the controller. The
// existing array variable (45), reader path, clock, steering, and outputs are
// deliberately not included.
const CONTROLLER_EDITOR_BRICKS = new Set([
  1, 3, 7, 10, 15, 31, 32, 62, 63,
  76, 77, 82, 83, 84, 85, 86, 87, 88,
]);

// Dedicated, labelled "Delete Waypoints" and "Record Waypoint" buttons.
const VEHICLE_EDITOR_BRICKS = new Set([550, 551]);

const keyOf = (grid, chunk = CHUNK) =>
  `${grid}/${chunk.x}/${chunk.y}/${chunk.z}`;

const deletions = new Map([
  [keyOf(CONTROLLER_GRID), CONTROLLER_EDITOR_BRICKS],
  [keyOf(VEHICLE_GRID), VEHICLE_EDITOR_BRICKS],
]);

const chunkFile = (grid, kind, chunk = CHUNK) =>
  `World/0/Bricks/Grids/${grid}/${kind}/${chunk.x}_${chunk.y}_${chunk.z}.mps`;

function remapIndex(grid, chunk, oldIndex) {
  const removed = deletions.get(keyOf(grid, chunk));
  if (!removed) return oldIndex;
  assert(!removed.has(oldIndex), `Attempted to remap deleted brick ${grid}:${oldIndex}`);
  let before = 0;
  for (const i of removed) if (i < oldIndex) before++;
  return oldIndex - before;
}

function isDeleted(grid, chunk, index) {
  return deletions.get(keyOf(grid, chunk))?.has(index) ?? false;
}

function filterBits(flags, count, removed) {
  const input = Array.from(flags.Flags);
  const output = [];
  let outIndex = 0;
  for (let i = 0; i < count; i++) {
    if (removed.has(i)) continue;
    if ((input[i >> 3] ?? 0) & (1 << (i & 7)))
      output[outIndex >> 3] = (output[outIndex >> 3] ?? 0) | (1 << (outIndex & 7));
    else if (output[outIndex >> 3] === undefined)
      output[outIndex >> 3] = 0;
    outIndex++;
  }
  return { Flags: output };
}

function filterBrickSoa(soa, removed) {
  const count = soa.BrickTypeIndices.length;
  const keep = values => values.filter((_, i) => !removed.has(i));
  const out = { ...soa };
  for (const name of [
    'BrickTypeIndices',
    'OwnerIndices',
    'OriginalOwnerIndices',
    'RelativePositions',
    'Orientations',
    'MaterialIndices',
    'ColorsAndAlphas',
  ]) out[name] = keep(soa[name]);
  for (const name of [
    'CollisionFlags_Player',
    'CollisionFlags_Player1',
    'CollisionFlags_Player2',
    'CollisionFlags_Player3',
    'CollisionFlags_Weapon',
    'CollisionFlags_Interaction',
    'CollisionFlags_Physics',
    'VisibilityFlags',
  ]) out[name] = filterBits(soa[name], count, removed);
  return out;
}

function filterParallelBrickRefs(soa, grid, chunk, prefix) {
  const brickKey = `${prefix}BrickIndices`;
  const brickIndices = soa[brickKey];
  if (!brickIndices) return;
  const fields = Object.keys(soa).filter(name =>
    name.startsWith(prefix) && name !== brickKey && Array.isArray(soa[name]) &&
    soa[name].length === brickIndices.length
  );
  const keptRows = [];
  for (let i = 0; i < brickIndices.length; i++)
    if (!isDeleted(grid, chunk, brickIndices[i])) keptRows.push(i);
  soa[brickKey] = keptRows.map(i => remapIndex(grid, chunk, brickIndices[i]));
  for (const field of fields) soa[field] = keptRows.map(i => soa[field][i]);
}

function remapComponentBrickRefs(value, currentGrid, currentChunk) {
  if (Array.isArray(value)) {
    for (const item of value)
      remapComponentBrickRefs(item, currentGrid, currentChunk);
    return;
  }
  if (!value || typeof value !== 'object') return;

  // VarRef/ArrayVarRef/MapVarRef fields contain a BRSavedBrickRef. A zero
  // grid and zero chunk are the on-disk shorthand for this component's own
  // grid/chunk. These indices must move with the bricks independently of the
  // visible wire graph.
  if (Number.isInteger(value.BrickIndexInChunk) && value.ChunkIndex &&
      Number.isInteger(value.GridPersistentIndex)) {
    const isLocal = value.GridPersistentIndex === 0 &&
      value.ChunkIndex.X === 0 &&
      value.ChunkIndex.Y === 0 &&
      value.ChunkIndex.Z === 0;
    const grid = isLocal ? currentGrid : value.GridPersistentIndex;
    const chunk = isLocal ? currentChunk : {
      x: value.ChunkIndex.X,
      y: value.ChunkIndex.Y,
      z: value.ChunkIndex.Z,
    };
    if (deletions.has(keyOf(grid, chunk)))
      value.BrickIndexInChunk = remapIndex(grid, chunk, value.BrickIndexInChunk);
  }

  for (const nested of Object.values(value))
    remapComponentBrickRefs(nested, currentGrid, currentChunk);
}

function encodeFilteredComponents(reader, grid, chunk, removed) {
  const decoded = reader.componentChunk(grid, chunk);
  const schema = reader.schema('World/0/Bricks/ComponentsShared.schema');
  const counters = [];
  const kept = [];
  let cursor = 0;
  for (const counter of decoded.soa.ComponentTypeCounters) {
    const group = decoded.components.slice(cursor, cursor + counter.NumInstances);
    cursor += counter.NumInstances;
    const survivors = group
      .filter(component => !removed.has(component.brickIndex))
      .map(component => structuredClone(component));
    for (const component of survivors)
      remapComponentBrickRefs(component.data, grid, chunk);
    if (survivors.length)
      counters.push({ ...counter, NumInstances: survivors.length });
    kept.push(...survivors);
  }
  assert.equal(cursor, decoded.components.length);

  const soa = {
    ...decoded.soa,
    ComponentTypeCounters: counters,
    ComponentBrickIndices: kept.map(component =>
      remapIndex(grid, chunk, component.brickIndex)),
  };
  filterParallelBrickRefs(soa, grid, chunk, 'Joint');
  filterParallelBrickRefs(soa, grid, chunk, 'Microchip');

  const writer = new ByteWriter();
  schema.writeValue(writer, 'BRSavedComponentChunkSoA', soa);
  for (const component of kept)
    if (component.structName)
      schema.writeValue(writer, component.structName, component.data);
  return { bytes: writer.toBytes(), count: kept.length };
}

function filterWireRows(soa, grid, chunk) {
  const keptRemote = [];
  for (let i = 0; i < soa.RemoteWireSources.length; i++) {
    const source = soa.RemoteWireSources[i];
    const target = soa.RemoteWireTargets[i];
    const sourceChunk = {
      x: source.ChunkIndex.X,
      y: source.ChunkIndex.Y,
      z: source.ChunkIndex.Z,
    };
    if (isDeleted(grid, chunk, target.BrickIndexInChunk)) continue;
    if (isDeleted(source.GridPersistentIndex, sourceChunk, source.BrickIndexInChunk)) continue;
    keptRemote.push({
      source: {
        ...source,
        BrickIndexInChunk: remapIndex(
          source.GridPersistentIndex,
          sourceChunk,
          source.BrickIndexInChunk
        ),
      },
      target: {
        ...target,
        BrickIndexInChunk: remapIndex(grid, chunk, target.BrickIndexInChunk),
      },
    });
  }

  const keptLocal = [];
  for (let i = 0; i < soa.LocalWireSources.length; i++) {
    const source = soa.LocalWireSources[i];
    const target = soa.LocalWireTargets[i];
    if (isDeleted(grid, chunk, source.BrickIndexInChunk)) continue;
    if (isDeleted(grid, chunk, target.BrickIndexInChunk)) continue;
    keptLocal.push({
      source: {
        ...source,
        BrickIndexInChunk: remapIndex(grid, chunk, source.BrickIndexInChunk),
      },
      target: {
        ...target,
        BrickIndexInChunk: remapIndex(grid, chunk, target.BrickIndexInChunk),
      },
    });
  }

  // All observed game-authored chunks in this prefab store no pending bits.
  // Refuse to guess their ordering if that ever changes.
  assert.equal(soa.PendingPropagationFlags.Flags.length, 0,
    `Unexpected pending wire flags in ${grid}:${chunk.x},${chunk.y},${chunk.z}`);
  return {
    ...soa,
    RemoteWireSources: keptRemote.map(row => row.source),
    RemoteWireTargets: keptRemote.map(row => row.target),
    LocalWireSources: keptLocal.map(row => row.source),
    LocalWireTargets: keptLocal.map(row => row.target),
  };
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

function transform(inputBytes) {
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const originalFiles = new Map(
    archive.listPaths().map(filePath => [filePath, archive.readFile(filePath).slice()])
  );
  const files = new Map(originalFiles);
  const changedPaths = new Set();
  const changedCounts = new Map();
  const mark = (filePath, bytes) => {
    files.set(filePath, bytes);
    changedPaths.add(filePath);
  };

  // Remove the editor bricks and their components from exactly two chunks.
  for (const [grid, removed] of [
    [CONTROLLER_GRID, CONTROLLER_EDITOR_BRICKS],
    [VEHICLE_GRID, VEHICLE_EDITOR_BRICKS],
  ]) {
    const ref = reader.brickChunkIndex(grid).find(ref =>
      ref.index.x === CHUNK.x && ref.index.y === CHUNK.y && ref.index.z === CHUNK.z);
    assert(ref, `Missing expected grid ${grid} chunk`);
    const brickSchema = reader.schema('World/0/Bricks/ChunksShared.schema');
    const brickSoa = filterBrickSoa(reader.brickChunkSoa(grid, CHUNK), removed);
    mark(chunkFile(grid, 'Chunks'), brickSchema.encode('BRSavedBrickChunkSoA', brickSoa));

    const components = encodeFilteredComponents(reader, grid, CHUNK, removed);
    mark(chunkFile(grid, 'Components'), components.bytes);
    changedCounts.set(keyOf(grid), {
      bricks: ref.numBricks - removed.size,
      components: components.count,
      wires: ref.numWires,
    });
  }

  // Wires live in their target chunk. Scan every wire chunk so outbound
  // references to either edited chunk are also removed/remapped.
  const wireSchema = reader.schema('World/0/Bricks/WiresShared.schema');
  for (const grid of reader.gridIds()) {
    for (const ref of reader.brickChunkIndex(grid)) {
      if (!ref.numWires) continue;
      const filePath = chunkFile(grid, 'Wires', ref.index);
      const soa = wireSchema.decode(files.get(filePath), 'BRSavedWireChunkSoA');
      const filtered = filterWireRows(soa, grid, ref.index);
      const bytes = wireSchema.encode('BRSavedWireChunkSoA', filtered);
      const wireCount = filtered.RemoteWireSources.length + filtered.LocalWireSources.length;
      const semanticallyChanged = wireCount !== ref.numWires ||
        !Buffer.from(bytes).equals(Buffer.from(files.get(filePath)));
      if (semanticallyChanged) mark(filePath, bytes);
      if (wireCount !== ref.numWires || changedCounts.has(keyOf(grid, ref.index))) {
        const counts = changedCounts.get(keyOf(grid, ref.index)) ?? {
          bricks: ref.numBricks,
          components: ref.numComponents,
          wires: ref.numWires,
        };
        counts.wires = wireCount;
        changedCounts.set(keyOf(grid, ref.index), counts);
      }
    }
  }

  // Synchronize the per-grid chunk counters used by Brickadia and readers.
  const indexSchema = reader.schema('World/0/Bricks/ChunkIndexShared.schema');
  for (const grid of reader.gridIds()) {
    const refs = reader.brickChunkIndex(grid);
    if (!refs.some(ref => changedCounts.has(keyOf(grid, ref.index)))) continue;
    const filePath = `World/0/Bricks/Grids/${grid}/ChunkIndex.mps`;
    const soa = indexSchema.decode(files.get(filePath), 'BRSavedBrickChunkIndexSoA');
    for (let i = 0; i < soa.Chunk3DIndices.length; i++) {
      const chunk = {
        x: soa.Chunk3DIndices[i].X,
        y: soa.Chunk3DIndices[i].Y,
        z: soa.Chunk3DIndices[i].Z,
      };
      const counts = changedCounts.get(keyOf(grid, chunk));
      if (!counts) continue;
      soa.NumBricks[i] = counts.bricks;
      soa.NumComponents[i] = counts.components;
      soa.NumWires[i] = counts.wires;
    }
    mark(filePath, indexSchema.encode('BRSavedBrickChunkIndexSoA', soa));
  }

  const outputBytes = writeBrzContainer(archiveTree(archive, files), {
    compress: data => zlib.zstdCompressSync(data),
  });

  // The special character-scale gates live in grid 561840. This assertion
  // generalizes that guarantee: every payload outside changedPaths must be
  // exactly the original uncompressed bytes.
  const output = WorldReader.from(outputBytes);
  for (const [filePath, before] of originalFiles) {
    if (changedPaths.has(filePath)) continue;
    assert(Buffer.from(output.fs.readFile(filePath)).equals(Buffer.from(before)),
      `Unexpected change outside the waypoint editor: ${filePath}`);
  }

  return { bytes: outputBytes, changedPaths: [...changedPaths].sort() };
}

module.exports = {
  transform,
  CONTROLLER_EDITOR_BRICKS,
  VEHICLE_EDITOR_BRICKS,
};

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: node strip-waypoint-editor.cjs input.brz output.brz');
  const result = transform(fs.readFileSync(input));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    input,
    output,
    bytes: result.bytes.length,
    removedControllerGates: CONTROLLER_EDITOR_BRICKS.size,
    removedVehicleButtons: VEHICLE_EDITOR_BRICKS.size,
    changedPaths: result.changedPaths,
  }, null, 2));
}
