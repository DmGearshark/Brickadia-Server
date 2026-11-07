'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {brdb: b} = require('./node_modules/brs-js');
const {orientedHalfExtents} = require('./brick-shapes.cjs');
const nativeHalfExtents = require('./native-brick-half-extents.json').assets;

const T = {
  microchip: 'Component_Internal_Microchip',
  input: 'BrickComponentType_Internal_MicrochipInput',
  output: 'BrickComponentType_Internal_MicrochipOutput',
  readGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  bearing: 'Component_Internal_RigidBearing',
  variable: 'BrickComponentType_Var',
  text: 'Component_TextDisplay',
};
const HIDDEN_COLLISION = {
  player: false, weapon: false, interaction: false, tool: true, physics: false,
};
const componentSchema = b.embeddedSchema('BRSavedComponentChunkSoA_max');

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function components(scene, type, predicate = () => true) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type && predicate(comp, brick))
    .map(comp => ({brick, comp})));
}

function assetImporter(targetScene, sourceScene) {
  const assets = structuredClone(targetScene.r.externalAssets());
  const remap = new Map();
  function ensure(type, name) {
    let index = assets.findIndex(asset => asset.type === type && asset.name === name);
    if (index < 0) {
      index = assets.length;
      assets.push({type, name});
    }
    return index;
  }
  function asset(index) {
    if (index == null || index < 0) return index;
    if (remap.has(index)) return remap.get(index);
    const source = sourceScene.r.externalAssets()[index];
    assert(source, `Missing compiled external asset ${index}`);
    const target = ensure(source.type, source.name);
    remap.set(index, target);
    return target;
  }
  function component(source) {
    const result = structuredClone(source);
    const fields = componentSchema.structs.get(b.COMPONENT_TYPE_STRUCTS.get(result.type));
    if (!fields) return result;
    for (const [field, descriptor] of fields) {
      if (descriptor.kind === 'type' && descriptor.type === 'object'
        && Number.isInteger(result.data[field])) result.data[field] = asset(result.data[field]);
    }
    return result;
  }
  return {assets, component};
}

function brickExtents(brick) {
  const local = brick.data.size?.some(Boolean)
    ? brick.data.size : nativeHalfExtents[brick.data.asset];
  assert(local, `No extents for ${brick.data.asset}`);
  return orientedHalfExtents(local, brick.data.direction ?? 4, brick.data.rotation ?? 0);
}

function overlaps(a, z) {
  const ae = brickExtents(a);
  const ze = brickExtents(z);
  return a.data.position.every((value, axis) =>
    Math.abs(value - z.data.position[axis]) < ae[axis] + ze[axis]);
}

function place(scene, grid, brick, candidates) {
  const peers = scene.bricks.filter(candidate => candidate.g === grid && candidate !== brick);
  const position = candidates.find(candidate => {
    brick.data.position = candidate;
    return peers.every(peer => !overlaps(brick, peer));
  });
  assert(position, `No non-overlapping placement for ${brick.data.asset}`);
  brick.data.position = position;
  if (!scene.bricks.includes(brick)) scene.bricks.push(brick);
  return brick;
}

function fitBrainPlane(scene, targetGrid, compiled, sourceGrid) {
  const target = one([...scene.r.entities()].filter(entity =>
    entity.persistentIndex === targetGrid), 'target brain entity');
  const source = one([...compiled.r.entities()].filter(entity =>
    entity.persistentIndex === sourceGrid), 'compiled brain entity');
  const bricks = scene.bricks.filter(brick => brick.g === targetGrid);
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  let zExtent = source.data.PlaneExtent.Z;
  for (const brick of bricks) {
    const half = brickExtents(brick);
    for (let axis = 0; axis < 2; axis++) {
      min[axis] = Math.min(min[axis], brick.data.position[axis] - half[axis]);
      max[axis] = Math.max(max[axis], brick.data.position[axis] + half[axis]);
    }
    zExtent = Math.max(zExtent, Math.abs(brick.data.position[2]) + half[2]);
  }
  const center = min.map((value, axis) => Math.round((value + max[axis]) / 2));
  const extent = center.map((value, axis) =>
    Math.ceil(Math.max(value - min[axis], max[axis] - value)) + 5);
  scene.entityOverrides = new Map([[targetGrid, {
    ...target,
    data: {
      ...structuredClone(target.data),
      PlaneCenter: {X: center[0], Y: center[1], Z: source.data.PlaneCenter.Z},
      PlaneExtent: {X: extent[0], Y: extent[1], Z: Math.ceil(zExtent)},
    },
  }]]);
}

function merge(monitorPath, compiledPath) {
  const original = read(fs.readFileSync(monitorPath));
  const scene = read(fs.readFileSync(monitorPath));
  const compiled = read(fs.readFileSync(compiledPath));
  const link = one(scene.links, 'monitor microchip link');
  const shell = one(scene.bricks.filter(brick => brick.key === link.key), 'monitor microchip');
  assert(shell.comps.some(comp => comp.type === T.microchip));
  const targetGrid = link.grid;
  const sourceLink = one(compiled.links, 'compiled microchip link');
  const sourceGrid = sourceLink.grid;
  const sourceShell = one(compiled.bricks.filter(brick => brick.key === sourceLink.key),
    'compiled microchip shell');
  assert(sourceShell.comps.some(comp => comp.type === T.microchip));
  assert.deepEqual([...new Set(compiled.bricks.map(brick => brick.g))].sort(),
    [1, sourceGrid].sort(), 'Monitor brain must compile @flat');

  const bearing = one(components(scene, T.bearing), 'rigid bearing');
  const bearingJoint = one(scene.joints.filter(joint => joint.key === bearing.brick.key),
    'rigid bearing joint');
  const monitorGrid = bearingJoint.entity;
  assert.equal(shell.g, monitorGrid, 'Microchip is not mounted on the rotating monitor grid');

  const oldBrainKeys = new Set(scene.bricks.filter(brick => brick.g === targetGrid)
    .map(brick => brick.key));
  scene.bricks = scene.bricks.filter(brick => !oldBrainKeys.has(brick.key));
  scene.edges = scene.edges.filter(edge =>
    !oldBrainKeys.has(edge.a) && !oldBrainKeys.has(edge.z));

  const reader = {
    key: 'monitor-tracker:grid-reader',
    g: monitorGrid,
    data: {
      asset: 'B_1x1_Gate_Internal_ReadBrickGrid',
      material: 'BMC_Plastic',
      position: [12, 0, 35],
      size: [0, 0, 0],
      direction: 4,
      rotation: 0,
      collision: structuredClone(HIDDEN_COLLISION),
      visibility: false,
      material_intensity: 0,
      color: [255, 255, 255],
      owner_index: 0,
    },
    comps: [{type: T.readGrid, data: {}}],
  };
  place(scene, monitorGrid, reader,
    [[12, 0, 35], [18, 0, 35], [12, 12, 35], [18, 12, 35]]);

  const importing = assetImporter(scene, compiled);
  const keyMap = new Map();
  for (const brick of compiled.bricks.filter(item => item.g === sourceGrid)) {
    const key = `monitor-ws:${brick.key}`;
    keyMap.set(brick.key, key);
    scene.bricks.push({...structuredClone(brick), key, g: targetGrid,
      comps: brick.comps.map(importing.component)});
  }
  for (const edge of compiled.edges) {
    assert(keyMap.has(edge.a) && keyMap.has(edge.z), 'Compiled edge escaped root plane');
    scene.edges.push({...edge, a: keyMap.get(edge.a), z: keyMap.get(edge.z)});
  }

  const imported = scene.bricks.filter(brick => brick.g === targetGrid);
  const pin = (type, label) => one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === type && comp.data.PortLabel === label)), `${label} pin`);
  const connect = (sourceBrick, sourceType, sourcePort, targetBrick, targetType, targetPort) => {
    assert(!scene.edges.some(edge => edge.z === targetBrick.key
      && edge.zt === targetType && edge.q === targetPort),
    `Duplicate target ${targetType}.${targetPort}`);
    scene.edges.push({a: sourceBrick.key, at: sourceType, p: sourcePort,
      z: targetBrick.key, zt: targetType, q: targetPort});
  };

  connect(reader, T.readGrid, 'BrickGrid', pin(T.input, 'Monitor'), T.input, 'RER_Input');
  connect(bearing.brick, T.bearing, 'CurrentAngle', pin(T.input, 'CurrentAngle'),
    T.input, 'RER_Input');
  const bearingOutput = pin(T.output, 'BearingAngle');
  connect(bearingOutput, T.output, 'RER_Output', bearing.brick,
    T.bearing, 'TargetAngle');
  one(bearingOutput.comps.filter(comp => comp.type === T.output),
    'bearing output component').data.PortLabel = 'Bearing Angle';

  const rangeVar = one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === T.variable && comp.data.Value?.$variant === 'f64'
      && comp.data.Value.value === 15)), 'tracking range variable');
  rangeVar.data.color = [65, 220, 110];
  const titleDisplay = one(components(compiled, T.text,
    (_comp, brick) => brick.g === sourceGrid), 'compiled title display');
  const noteData = importing.component(titleDisplay.comp).data;
  Object.assign(noteData, {
    Text: 'TRACKING RANGE (BLOCKS)\nEDIT GREEN VARIABLE\nDEFAULT: 15',
    LineHeight: 1.5,
    WidthScale: 0.72,
    bEnabled: true,
  });
  const note = {
    key: 'monitor-tracker:range-note',
    g: targetGrid,
    data: {
      asset: 'PB_DefaultTile',
      material: 'BMC_Plastic',
      position: [rangeVar.data.position[0], rangeVar.data.position[1] - 12, 2],
      size: [20, 5, 2],
      direction: 4,
      rotation: 0,
      collision: {player: false, weapon: false, interaction: false, tool: true, physics: false},
      visibility: true,
      material_intensity: 0,
      color: [20, 55, 35],
      owner_index: 0,
    },
    comps: [{type: T.text, data: noteData}],
  };
  place(scene, targetGrid, note, [
    [rangeVar.data.position[0], rangeVar.data.position[1] - 12, 2],
    [rangeVar.data.position[0], rangeVar.data.position[1] - 24, 2],
    [rangeVar.data.position[0] - 25, rangeVar.data.position[1], 2],
  ]);

  fitBrainPlane(scene, targetGrid, compiled, sourceGrid);
  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const result = write(scene, {
    assets: importing.assets,
    embedded,
    name: 'Closest Player Monitor - 15 Block Range',
    description: 'Rigid-bearing monitor that faces the closest player in an editable tracking range. Rewire the BearingAngle microchip output to control a different bearing.',
  });
  return {
    bytes: result.bytes,
    original,
    scene,
    targetGrid,
    monitorGrid,
    bearing,
    bearingJoint,
    reader,
    rangeVar,
    note,
    importedBrainBricks: keyMap.size,
    importedBrainWires: compiled.edges.length,
  };
}

module.exports = merge;
module.exports.T = T;

if (require.main === module) {
  const [monitorPath, compiledPath, outputPath] = process.argv.slice(2);
  if (!monitorPath || !compiledPath || !outputPath) {
    throw new Error('Usage: node merge-player-facing-monitor.cjs monitor.brz brain.brz output.brz');
  }
  const result = merge(monitorPath, compiledPath);
  fs.writeFileSync(outputPath, result.bytes);
  console.log(JSON.stringify({
    output: outputPath,
    importedBrainBricks: result.importedBrainBricks,
    importedBrainWires: result.importedBrainWires,
    monitorGrid: result.monitorGrid,
    bytes: result.bytes.length,
  }, null, 2));
}
