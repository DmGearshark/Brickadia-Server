'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {brdb: b} = require('./node_modules/brs-js');
const {orientedHalfExtents} = require('./brick-shapes.cjs');
const nativeHalfExtents = require('./native-brick-half-extents.json').assets;

const T = {
  microchip: 'Component_Internal_Microchip',
  microchipInput: 'BrickComponentType_Internal_MicrochipInput',
  microchipOutput: 'BrickComponentType_Internal_MicrochipOutput',
  interacted: 'BrickComponentType_Event_WholeGridInteracted',
  readGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  engine: 'Component_Internal_WheelEngine',
  bearing: 'Component_Internal_RigidBearing',
  text: 'Component_TextDisplay',
  zone: 'Component_Internal_AttachedZone',
  interact: 'Component_Interact',
};

const INPUTS = ['Chassis', 'Head', 'Radar', 'Mouth', 'Petter'];
const OUTPUTS = ['Drive', 'Steer', 'Brake', 'HeadAngle', 'FaceText', 'FaceColor'];
const HIDDEN_COLLISION = {
  player: false,
  weapon: false,
  interaction: false,
  tool: true,
  physics: false,
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

function brain(scene) {
  const links = new Map(scene.links.map(link => [link.key, link]));
  const candidates = components(scene, T.microchip)
    .filter(({brick}) => links.has(brick.key))
    .map(({brick, comp}) => ({brick, comp, link: links.get(brick.key)}));
  return one(candidates, 'cat brain microchip');
}

function compiledRoot(scene) {
  const link = one(scene.links, 'compiled root link');
  const shell = one(scene.bricks.filter(brick => brick.key === link.key), 'compiled shell');
  assert.equal(shell.g, 1);
  const grids = new Set(scene.bricks.map(brick => brick.g));
  assert.deepEqual([...grids].sort((a, z) => a - z), [1, link.grid].sort((a, z) => a - z),
    'Priority brain must be @flat');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  assert.equal(scene.edges.filter(edge => byKey.get(edge.a)?.g !== link.grid
    || byKey.get(edge.z)?.g !== link.grid).length, 0,
  'Compiled brain contains a cross-plane wire');
  return {link, shell, grid: link.grid};
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

function hiddenBrick(key, grid, asset, position, size = [0, 0, 0], direction = 4) {
  return {
    key,
    g: grid,
    data: {
      asset,
      material: 'BMC_Plastic',
      position,
      size,
      direction,
      rotation: 0,
      collision: structuredClone(HIDDEN_COLLISION),
      visibility: false,
      material_intensity: 0,
      color: [255, 255, 255],
      owner_index: 0,
    },
    comps: [],
  };
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

function addHardware(scene, chassisGrid, headGrid) {
  const headReader = one(components(scene, T.readGrid,
    (_comp, brick) => brick.g === headGrid), 'head-grid reader').brick;

  const chassisReader = hiddenBrick('priority-cat:chassis-reader', chassisGrid,
    'B_1x1_Gate_Internal_ReadBrickGrid', [0, 0, 18]);
  chassisReader.comps.push({type: T.readGrid, data: {}});
  place(scene, chassisGrid, chassisReader,
    [[0, 0, 18], [-15, 18, 18], [-15, -18, 18], [15, 18, 18]]);

  const radar = hiddenBrick('priority-cat:radar', chassisGrid, 'BP_ZoneProjector',
    [23, 0, 10], [60, 120, 2], 0);
  radar.comps.push({type: T.zone, data: {
    ZoneStartDistance: 0,
    ZoneEndDistance: 900,
    bIsBuildingZone: false,
    bIsLooseZone: false,
    bIsShareZone: false,
    bWater: false,
    bDetectPlayers: false,
    bDetectPlayers1: false,
    bDetectPlayers2: false,
    bDetectPlayers3: false,
    bDetectEntities: true,
    bDetectProjectiles: false,
    TagFilter: '',
    ZoneWindForce: 0,
  }});
  place(scene, chassisGrid, radar, [[23, 0, 10], [28, 0, 10], [33, 0, 10]]);

  const mouth = hiddenBrick('priority-cat:mouth', chassisGrid, 'BP_ZoneProjector',
    [28, 0, 10], [20, 20, 2], 0);
  mouth.comps.push({type: T.zone, data: {
    ZoneStartDistance: 0,
    ZoneEndDistance: 30,
    bIsBuildingZone: false,
    bIsLooseZone: false,
    bIsShareZone: false,
    bWater: false,
    bDetectPlayers: false,
    bDetectPlayers1: false,
    bDetectPlayers2: false,
    bDetectPlayers3: false,
    bDetectEntities: true,
    bDetectProjectiles: false,
    TagFilter: '',
    ZoneWindForce: 0,
  }});
  place(scene, chassisGrid, mouth, [[28, 0, 10], [33, 0, 10], [38, 0, 10]]);
  return {headReader, chassisReader, radar, mouth, added: 3};
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

function merge(catPath, compiledPath) {
  const original = read(fs.readFileSync(catPath));
  const scene = read(fs.readFileSync(catPath));
  const compiled = read(fs.readFileSync(compiledPath));
  const catBrain = brain(scene);
  const source = compiledRoot(compiled);
  const targetGrid = catBrain.link.grid;
  const engine = one(components(scene, T.engine,
    (_comp, brick) => brick.g !== targetGrid), 'wheel engine').brick;
  const bearing = one(components(scene, T.bearing,
    (_comp, brick) => brick.g !== targetGrid), 'rigid head bearing').brick;
  const bearingJoint = one(scene.joints.filter(joint => joint.key === bearing.key),
    'rigid head joint');
  const headGrid = bearingJoint.entity;
  const face = one(components(scene, T.text,
    (_comp, brick) => brick.g === headGrid), 'head face display').brick;
  const faceComp = one(face.comps.filter(comp => comp.type === T.text), 'face component');
  faceComp.data.bOverrideColor = true;
  const importing = assetImporter(scene, compiled);

  const oldBrainKeys = new Set(scene.bricks.filter(brick => brick.g === targetGrid)
    .map(brick => brick.key));
  scene.bricks = scene.bricks.filter(brick => !oldBrainKeys.has(brick.key));
  scene.edges = scene.edges.filter(edge =>
    !oldBrainKeys.has(edge.a) && !oldBrainKeys.has(edge.z));
  const retainedEdgeCount = scene.edges.length;

  catBrain.brick.comps = catBrain.brick.comps.filter(comp => comp.type !== T.interact);
  const hardware = addHardware(scene, engine.g, headGrid);

  const keyMap = new Map();
  let interactionGates = 0;
  for (const brick of compiled.bricks.filter(item => item.g === source.grid)) {
    const key = `priority-ws:${brick.key}`;
    keyMap.set(brick.key, key);
    const comps = brick.comps.map(importing.component);
    for (const comp of comps) {
      if (comp.type !== T.interacted) continue;
      comp.data.bAllowNearbyInteraction = true;
      comp.data.bHiddenInteraction = false;
      comp.data.PromptCustomLabel = 'Pet Cat';
      interactionGates++;
    }
    scene.bricks.push({...structuredClone(brick), key, g: targetGrid, comps});
  }
  const importedEdges = compiled.edges.map(edge => {
    assert(keyMap.has(edge.a) && keyMap.has(edge.z), 'Compiled edge escaped root plane');
    return {...edge, a: keyMap.get(edge.a), z: keyMap.get(edge.z)};
  });
  scene.edges.push(...importedEdges);

  const imported = scene.bricks.filter(brick => brick.g === targetGrid);
  const pin = (type, label) => one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === type && comp.data.PortLabel === label)), `${label} pin`);
  const connect = (sourceBrick, sourceType, sourcePort, destination) => {
    assert(!scene.edges.some(edge => edge.z === destination.key
      && edge.zt === destination.type && edge.q === destination.port),
    `Duplicate output target ${destination.type}.${destination.port}`);
    scene.edges.push({a: sourceBrick.key, at: sourceType, p: sourcePort,
      z: destination.key, zt: destination.type, q: destination.port});
  };

  const outputTargets = {
    Drive: {key: engine.key, type: T.engine, port: 'ManualInput_Drive'},
    Steer: {key: engine.key, type: T.engine, port: 'ManualInput_Steer'},
    Brake: {key: engine.key, type: T.engine, port: 'bManualInput_Brake'},
    HeadAngle: {key: bearing.key, type: T.bearing, port: 'TargetAngle'},
    FaceText: {key: face.key, type: T.text, port: 'Text'},
    FaceColor: {key: face.key, type: T.text, port: 'Color'},
  };
  for (const label of OUTPUTS) {
    connect(pin(T.microchipOutput, label), T.microchipOutput, 'RER_Output',
      outputTargets[label]);
  }

  const interaction = one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === T.interacted)), 'pet interaction event');
  const inputSources = {
    Chassis: {brick: hardware.chassisReader, type: T.readGrid, port: 'BrickGrid'},
    Head: {brick: hardware.headReader, type: T.readGrid, port: 'BrickGrid'},
    Radar: {brick: hardware.radar, type: T.zone, port: 'ZoneRef'},
    Mouth: {brick: hardware.mouth, type: T.zone, port: 'ZoneRef'},
    Petter: {brick: interaction, type: T.interacted, port: 'Character'},
  };
  for (const label of INPUTS) {
    const target = pin(T.microchipInput, label);
    const sourceEndpoint = inputSources[label];
    connect(sourceEndpoint.brick, sourceEndpoint.type, sourceEndpoint.port,
      {key: target.key, type: T.microchipInput, port: 'RER_Input'});
  }

  fitBrainPlane(scene, targetGrid, compiled, source.grid);
  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const result = write(scene, {
    assets: importing.assets,
    embedded,
    name: 'Rigid Cat - Priority Behavior System',
    description: 'Four-wheel rigid-head cat with priority needs, food/toy states, petting, sleep, stalking/chasing, following, relaxing, roaming, and head-safe obstacle avoidance.',
  });
  const saved = read(result.bytes);
  assert.equal(saved.links.length, original.links.length);
  assert.equal(saved.joints.length, original.joints.length);
  assert.equal(saved.bricks.length,
    original.bricks.length - oldBrainKeys.size + keyMap.size + hardware.added);
  assert.equal(saved.edges.length,
    retainedEdgeCount + importedEdges.length + OUTPUTS.length + INPUTS.length);

  return {
    bytes: result.bytes,
    original,
    scene,
    targetGrid,
    headGrid,
    oldBrainKeys,
    keyMap,
    engine,
    bearing,
    bearingJoint,
    face,
    hardware,
    sourceGrid: source.grid,
    importedBrainBricks: keyMap.size,
    importedBrainWires: importedEdges.length,
    removedBrainBricks: oldBrainKeys.size,
    retainedEdgeCount,
    interactionGates,
    assets: importing.assets,
  };
}

module.exports = merge;
module.exports.T = T;

if (require.main === module) {
  const [catPath, compiledPath, outputPath] = process.argv.slice(2);
  if (!catPath || !compiledPath || !outputPath) {
    throw new Error('Usage: node merge-rigid-cat-priority.cjs cat.brz brain.brz output.brz');
  }
  const result = merge(catPath, compiledPath);
  fs.writeFileSync(outputPath, result.bytes);
  console.log(JSON.stringify({
    output: outputPath,
    removedBrainBricks: result.removedBrainBricks,
    importedBrainBricks: result.importedBrainBricks,
    importedBrainWires: result.importedBrainWires,
    interactionGates: result.interactionGates,
    hardwareAdded: result.hardware.added,
    bytes: result.bytes.length,
  }, null, 2));
}
