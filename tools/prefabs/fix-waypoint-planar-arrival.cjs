'use strict';

// Converts the immutable waypoint follower's arrival check from full 3D
// distance to XY-only distance. This is intentionally an archive-level edit:
// the supplied file contains newer unrelated gates that must remain intact.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {WorldReader, brdb} = require('brs-js');

const {ByteWriter, file, folder, writeBrzContainer} = brdb;
const CONTROLLER_GRID = 61710;
const IGNORED_GRID = 561840;
const CHUNK = {x: -1, y: -1, z: -1};
const CHUNK_STEM = '-1_-1_-1';
const MAKE_VECTOR_ASSET_INDEX = 19;
const MAKE_VECTOR_TYPE_INDEX = 26;
const MAKE_VECTOR_ASSET = 'B_1x1_Gate_Expr_MakeVector';
const MAKE_VECTOR_TYPE = 'BrickComponentType_Expr_MakeVector';
const MAKE_VECTOR_STRUCT = 'BCSComponentVertex_Expr_MakeVector';
const CURRENT_FLAT_BRICK = 80;
const TARGET_FLAT_BRICK = 81;

const paths = {
  global: 'World/0/GlobalData.mps',
  componentSchema: 'World/0/Bricks/ComponentsShared.schema',
  chunkIndex: `World/0/Bricks/Grids/${CONTROLLER_GRID}/ChunkIndex.mps`,
  bricks: `World/0/Bricks/Grids/${CONTROLLER_GRID}/Chunks/${CHUNK_STEM}.mps`,
  components: `World/0/Bricks/Grids/${CONTROLLER_GRID}/Components/${CHUNK_STEM}.mps`,
  wires: `World/0/Bricks/Grids/${CONTROLLER_GRID}/Wires/${CHUNK_STEM}.mps`,
};

const allowedChanges = new Set(Object.values(paths));

function archiveTree(archive, files, prefix = '') {
  const here = name => prefix ? `${prefix}/${name}` : name;
  return [
    ...archive.childFolders(prefix).map(name =>
      [name, folder(archiveTree(archive, files, here(name)))]),
    ...archive.childFiles(prefix).map(name =>
      [name, file(files.get(here(name)))]),
  ];
}

function bitAt(flags, index) {
  return ((flags.Flags[index >> 3] ?? 0) >> (index & 7)) & 1;
}

function appendBit(flags, index, enabled) {
  const byte = index >> 3;
  while (flags.Flags.length <= byte) flags.Flags.push(0);
  if (enabled) flags.Flags[byte] |= 1 << (index & 7);
  else flags.Flags[byte] &= ~(1 << (index & 7));
}

function clone(value) {
  return structuredClone(value);
}

function appendGateBrick(soa, templateIndex, position, assetIndex) {
  const index = soa.BrickTypeIndices.length;
  soa.BrickTypeIndices.push(assetIndex);
  for (const field of ['OwnerIndices', 'OriginalOwnerIndices', 'Orientations',
    'MaterialIndices', 'ColorsAndAlphas'])
    soa[field].push(clone(soa[field][templateIndex]));
  soa.RelativePositions.push(clone(position));
  for (const field of [
    'CollisionFlags_Player', 'CollisionFlags_Player1', 'CollisionFlags_Player2',
    'CollisionFlags_Player3', 'CollisionFlags_Weapon',
    'CollisionFlags_Interaction', 'CollisionFlags_Physics', 'VisibilityFlags',
  ]) appendBit(soa[field], index, bitAt(soa[field], templateIndex));
  return index;
}

function flatten(vector) {
  return {X: vector.X, Y: vector.Y, Z: 0};
}

function planarDistance(a, b) {
  return Math.hypot(a.X - b.X, a.Y - b.Y);
}

function writeComponents(reader, schema) {
  const decoded = reader.componentChunk(CONTROLLER_GRID, CHUNK);
  assert(!decoded.soa.ComponentTypeCounters.some(counter =>
    counter.TypeIndex === MAKE_VECTOR_TYPE_INDEX),
  'Repurposed MakeVector component slot is still in use');

  const components = decoded.components.map(component => clone(component));
  const radius = components.find(component =>
    component.brickIndex === 47 && component.typeName === 'BrickComponentType_Var');
  const distance = components.find(component =>
    component.brickIndex === 3 && component.typeName === 'BrickComponentType_Expr_VecDistance');
  const arrival = components.find(component =>
    component.brickIndex === 68 &&
    component.typeName === 'BrickComponentType_Expr_CompareLessOrEqual');
  assert(radius && distance && arrival, 'Expected follower arrival components');

  const current = flatten(distance.data.InputA);
  const target = flatten(distance.data.InputB);
  radius.data.Value = {$variant: 'f64', value: 150};
  distance.data.InputA = current;
  distance.data.InputB = target;
  arrival.data.InputA = {$variant: 'f64', value: planarDistance(current, target)};
  arrival.data.InputB = {$variant: 'f64', value: 150};

  const makeVectors = [current, target].map((data, offset) => ({
    brickIndex: CURRENT_FLAT_BRICK + offset,
    typeName: MAKE_VECTOR_TYPE,
    structName: MAKE_VECTOR_STRUCT,
    data,
  }));
  decoded.soa.ComponentTypeCounters.push({
    TypeIndex: MAKE_VECTOR_TYPE_INDEX,
    NumInstances: makeVectors.length,
  });
  decoded.soa.ComponentBrickIndices.push(CURRENT_FLAT_BRICK, TARGET_FLAT_BRICK);

  const writer = new ByteWriter();
  schema.writeValue(writer, 'BRSavedComponentChunkSoA', decoded.soa);
  for (const component of [...components, ...makeVectors])
    schema.writeValue(writer, component.structName, component.data);
  return {bytes: writer.toBytes(), count: components.length + makeVectors.length};
}

function localSource(brick, component, port) {
  return {
    BrickIndexInChunk: brick,
    ComponentTypeIndex: component,
    PortIndex: port,
  };
}

function localTarget(brick, component, port) {
  return localSource(brick, component, port);
}

function writeWires(reader, files) {
  const schema = reader.schema('World/0/Bricks/WiresShared.schema');
  const soa = schema.decode(files.get(paths.wires), 'BRSavedWireChunkSoA');
  assert.equal(soa.PendingPropagationFlags.Flags.length, 0);
  const sources = [];
  const targets = [];
  let removed = 0;
  for (let i = 0; i < soa.LocalWireSources.length; i++) {
    const target = soa.LocalWireTargets[i];
    if (target.BrickIndexInChunk === 3 &&
        target.ComponentTypeIndex === 22 &&
        (target.PortIndex === 24 || target.PortIndex === 25)) {
      removed++;
      continue;
    }
    sources.push(soa.LocalWireSources[i]);
    targets.push(target);
  }
  assert.equal(removed, 2, 'Expected two original 3D-distance input wires');

  // Existing port indices: Output=22, InputA=24, InputB=25,
  // X=38, Y=39. Z remains unwired and therefore zero.
  const added = [
    [localSource(9, 41, 38), localTarget(CURRENT_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 38)],
    [localSource(9, 41, 39), localTarget(CURRENT_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 39)],
    [localSource(10, 41, 38), localTarget(TARGET_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 38)],
    [localSource(10, 41, 39), localTarget(TARGET_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 39)],
    [localSource(CURRENT_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 22), localTarget(3, 22, 24)],
    [localSource(TARGET_FLAT_BRICK, MAKE_VECTOR_TYPE_INDEX, 22), localTarget(3, 22, 25)],
  ];
  for (const [source, target] of added) {
    sources.push(source);
    targets.push(target);
  }
  soa.LocalWireSources = sources;
  soa.LocalWireTargets = targets;
  return {
    bytes: schema.encode('BRSavedWireChunkSoA', soa),
    count: soa.RemoteWireSources.length + sources.length,
  };
}

function transform(inputBytes) {
  const reader = WorldReader.from(inputBytes);
  const archive = reader.fs;
  const original = new Map(archive.listPaths().map(filePath =>
    [filePath, archive.readFile(filePath).slice()]));
  const files = new Map(original);

  const controller = reader.brickChunkIndex(CONTROLLER_GRID);
  assert.equal(controller.length, 1);
  assert.deepEqual(controller[0].index, CHUNK);
  assert.equal(controller[0].numBricks, 80);
  assert.equal(controller[0].numComponents, 81);
  assert.equal(controller[0].numWires, 105);

  // Reuse the now-empty Push gate asset/component slots. This avoids shifting
  // every procedural asset or existing component index in the prefab.
  const globalSchema = reader.schema('World/0/GlobalData.schema');
  const global = clone(reader.globalData());
  assert.equal(global.BasicBrickAssetNames[MAKE_VECTOR_ASSET_INDEX],
    'B_1x1_Gate_Exec_ArrayVar_Push');
  assert.equal(global.ComponentTypeNames[MAKE_VECTOR_TYPE_INDEX],
    'BrickComponentType_Exec_ArrayVar_Push');
  assert.equal(global.ComponentDataStructNames[MAKE_VECTOR_TYPE_INDEX],
    'BCSComponentVertex_Exec_ArrayVar_Push');
  global.BasicBrickAssetNames[MAKE_VECTOR_ASSET_INDEX] = MAKE_VECTOR_ASSET;
  global.ComponentTypeNames[MAKE_VECTOR_TYPE_INDEX] = MAKE_VECTOR_TYPE;
  global.ComponentDataStructNames[MAKE_VECTOR_TYPE_INDEX] = MAKE_VECTOR_STRUCT;
  for (const port of ['Output', 'X', 'Y', 'Z'])
    assert(global.ComponentWirePortNames.includes(port));
  files.set(paths.global, globalSchema.encode('BRSavedGlobalDataSoA', global));

  const componentSchema = reader.schema(paths.componentSchema);
  const embedded = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
  componentSchema.merge(embedded.extractStructsTransitive([MAKE_VECTOR_STRUCT]));
  files.set(paths.componentSchema, componentSchema.toBinary());

  const brickSchema = reader.schema('World/0/Bricks/ChunksShared.schema');
  const bricks = clone(reader.brickChunkSoa(CONTROLLER_GRID, CHUNK));
  assert(!bricks.BrickTypeIndices.includes(MAKE_VECTOR_ASSET_INDEX),
    'Repurposed MakeVector asset slot is still in use');
  assert.equal(appendGateBrick(bricks, 9, {X: 65, Y: -100, Z: 2},
    MAKE_VECTOR_ASSET_INDEX), CURRENT_FLAT_BRICK);
  assert.equal(appendGateBrick(bricks, 10, {X: 95, Y: -100, Z: 2},
    MAKE_VECTOR_ASSET_INDEX), TARGET_FLAT_BRICK);
  files.set(paths.bricks, brickSchema.encode('BRSavedBrickChunkSoA', bricks));

  const components = writeComponents(reader, componentSchema);
  files.set(paths.components, components.bytes);
  const wires = writeWires(reader, files);
  files.set(paths.wires, wires.bytes);

  const indexSchema = reader.schema('World/0/Bricks/ChunkIndexShared.schema');
  const index = indexSchema.decode(files.get(paths.chunkIndex), 'BRSavedBrickChunkIndexSoA');
  assert.equal(index.NumBricks.length, 1);
  index.NumBricks[0] = 82;
  index.NumComponents[0] = components.count;
  index.NumWires[0] = wires.count;
  files.set(paths.chunkIndex,
    indexSchema.encode('BRSavedBrickChunkIndexSoA', index));

  const bytes = writeBrzContainer(archiveTree(archive, files), {
    compress: data => zlib.zstdCompressSync(data),
  });
  const output = WorldReader.from(bytes);

  // Only shared metadata plus the controller chunk may change. The unrelated
  // character-scale grid remains byte-for-byte identical.
  for (const [filePath, before] of original) {
    if (allowedChanges.has(filePath)) continue;
    assert(Buffer.from(output.fs.readFile(filePath)).equals(Buffer.from(before)),
      `Unexpected file changed: ${filePath}`);
  }
  for (const kind of ['Chunks', 'Components', 'Wires']) {
    const filePath = `World/0/Bricks/Grids/${IGNORED_GRID}/${kind}/${CHUNK_STEM}.mps`;
    assert(Buffer.from(output.fs.readFile(filePath)).equals(Buffer.from(original.get(filePath))),
      `Ignored grid payload changed: ${filePath}`);
  }

  const ref = output.brickChunkIndex(CONTROLLER_GRID)[0];
  assert.deepEqual({bricks: ref.numBricks, components: ref.numComponents, wires: ref.numWires},
    {bricks: 82, components: 83, wires: 109});
  const parsed = output.componentChunk(CONTROLLER_GRID, CHUNK).components;
  const makeVectors = parsed.filter(component => component.typeName === MAKE_VECTOR_TYPE);
  assert.equal(makeVectors.length, 2);
  assert(makeVectors.every(component => component.data.Z === 0));
  const radius = parsed.find(component =>
    component.brickIndex === 47 && component.typeName === 'BrickComponentType_Var');
  assert.equal(radius.data.Value.value, 150);
  const array = parsed.find(component =>
    component.typeName === 'BrickComponentType_ArrayVar');
  assert.equal(array.data.Value.$array.length, 34);
  const ignored = output.componentChunk(IGNORED_GRID, CHUNK).components;
  assert.equal(ignored.filter(component =>
    /Character_(?:GetScale|SetScale)$/.test(component.typeName)).length, 3);

  return {bytes, stats: {
    controllerBricks: ref.numBricks,
    controllerComponents: ref.numComponents,
    controllerWires: ref.numWires,
    captureRadius: 150,
    waypointCount: array.data.Value.$array.length,
  }};
}

module.exports = {transform};

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: node fix-waypoint-planar-arrival.cjs input.brz output.brz');
  const result = transform(fs.readFileSync(input));
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({input, output, bytes: result.bytes.length, ...result.stats}, null, 2));
}
