'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const {brdb: b} = require('./node_modules/brs-js');
const {orientedHalfExtents} = require('./brick-shapes.cjs');
const nativeHalfExtents = require('./native-brick-half-extents.json').assets;

const TYPES = {
  microchip: 'Component_Internal_Microchip',
  microchipInput: 'BrickComponentType_Internal_MicrochipInput',
  microchipOutput: 'BrickComponentType_Internal_MicrochipOutput',
  interacted: 'BrickComponentType_Event_WholeGridInteracted',
  readBrickGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  engine: 'Component_Internal_WheelEngine',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  text: 'Component_TextDisplay',
  zone: 'Component_Internal_AttachedZone',
  audio: 'Component_AudioEmitter',
};

const OUTPUTS = [
  'Drive',
  'Steer',
  'Brake',
  'DriveSpeed',
  'FrontSuspension',
  'RearSuspension',
  'FaceText',
  'Purr',
];

const INPUTS = ['Sensor', 'Petter', 'Chassis'];

const CONTROL_PINS = {
  DriveSpeed: {label: /^Input Speed(?:,|$)/i, outputs: 1},
  FrontSuspension: {label: /^Input Front Wheel Suspension(?:,|$)/i, outputs: 2},
  RearSuspension: {label: /^Input Rear Wheel Suspension(?:,|$)/i, outputs: 2},
};

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
  const linksByBrick = new Map(scene.links.map(link => [link.key, link]));
  const candidates = components(scene, TYPES.microchip)
    .filter(({brick}) => linksByBrick.has(brick.key))
    .map(({brick, comp}) => ({brick, comp, link: linksByBrick.get(brick.key)}));
  const marked = candidates.filter(({brick}) => brick.comps.some(comp =>
    comp.type === 'Component_Interact' && /brain/i.test(comp.data.Message || '')));
  return one(marked.length ? marked : candidates, 'cat brain microchip');
}

function compiledRoot(scene) {
  const link = one(scene.links, 'compiled root microchip link');
  const shell = one(scene.bricks.filter(brick => brick.key === link.key), 'compiled root shell');
  assert.equal(shell.g, 1, 'Compiled root shell must be on the global grid');
  assert(shell.comps.some(comp => comp.type === TYPES.microchip),
    'Compiled root link must originate at a microchip brick');

  const grids = new Set(scene.bricks.map(brick => brick.g));
  assert.deepEqual([...grids].sort((a, z) => a - z), [1, link.grid].sort((a, z) => a - z),
    'Compiled save is not flat: expected only the global grid and one root logic grid');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const outsideEdges = scene.edges.filter(edge =>
    byKey.get(edge.a)?.g !== link.grid || byKey.get(edge.z)?.g !== link.grid);
  assert.equal(outsideEdges.length, 0,
    'Compiled save has wires outside its root plane; remove @left/@right/@top/@bottom annotations');
  return {link, shell, grid: link.grid};
}

function controlPins(scene, grid) {
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  return Object.fromEntries(Object.entries(CONTROL_PINS).map(([name, spec]) => {
    const pin = one(components(scene, TYPES.microchipInput,
      (comp, brick) => brick.g === grid && spec.label.test(comp.data.PortLabel || '')),
    `provided ${name} control pin`);
    const outputs = scene.edges.filter(edge => edge.a === pin.brick.key
      && edge.at === TYPES.microchipInput
      && edge.p === 'RER_Output'
      && byKey.get(edge.z)?.g !== grid);
    assert.equal(outputs.length, spec.outputs,
      `Expected ${spec.outputs} external wires from provided ${name} pin, found ${outputs.length}`);
    return [name, {brick: structuredClone(pin.brick), outputs: structuredClone(outputs)}];
  }));
}

function physicalTargets(scene, brainGrid) {
  const engine = one(components(scene, TYPES.engine,
    (_comp, brick) => brick.g !== brainGrid), 'cat wheel engine').brick;
  const faceCandidates = components(scene, TYPES.text,
    (_comp, brick) => brick.g !== brainGrid);
  const emojiFaces = faceCandidates.filter(({comp}) => /[😺😼😿😻😾]/u.test(comp.data.Text || ''));
  const face = one(emojiFaces.length ? emojiFaces : faceCandidates, 'cat face text display').brick;

  return {
    chassisGrid: engine.g,
    Drive: [{key: engine.key, type: TYPES.engine, port: 'ManualInput_Drive'}],
    Steer: [{key: engine.key, type: TYPES.engine, port: 'ManualInput_Steer'}],
    Brake: [{key: engine.key, type: TYPES.engine, port: 'bManualInput_Brake'}],
    FaceText: [{key: face.key, type: TYPES.text, port: 'Text'}],
  };
}

function assetImporter(targetScene, sourceScene) {
  const assets = structuredClone(targetScene.r.externalAssets());
  const remap = new Map();
  function asset(index) {
    if (index == null || index < 0) return index;
    if (remap.has(index)) return remap.get(index);
    const source = sourceScene.r.externalAssets()[index];
    assert(source, `Compiled component references missing external asset ${index}`);
    const target = ensureAsset(source.type, source.name);
    remap.set(index, target);
    return target;
  }
  function ensureAsset(type, name) {
    let target = assets.findIndex(item => item.type === type && item.name === name);
    if (target < 0) {
      target = assets.length;
      assets.push({type, name});
    }
    return target;
  }
  function component(source) {
    const result = structuredClone(source);
    const structName = b.COMPONENT_TYPE_STRUCTS.get(result.type);
    const fields = componentSchema.structs.get(structName);
    if (!fields) return result;
    for (const [field, descriptor] of fields) {
      if (descriptor.kind === 'type' && descriptor.type === 'object'
          && Number.isInteger(result.data[field])) {
        result.data[field] = asset(result.data[field]);
      }
    }
    return result;
  }
  return {assets, component, ensureAsset};
}

function brickExtents(brick) {
  const local = brick.data.size?.some(Boolean)
    ? brick.data.size
    : nativeHalfExtents[brick.data.asset];
  assert(local, `No half-extents for ${brick.data.asset}`);
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
  const peers = scene.bricks.filter(item => item.g === grid && item !== brick);
  const position = candidates.find(candidate => {
    brick.data.position = candidate;
    return peers.every(peer => !overlaps(brick, peer));
  });
  assert(position, `No non-overlapping placement found for ${brick.data.asset}`);
  brick.data.position = position;
  if (!scene.bricks.includes(brick)) scene.bricks.push(brick);
  return brick;
}

function ensureHardware(scene, chassisGrid, importing) {
  function existing(type, description) {
    const matches = components(scene, type, (_comp, brick) => brick.g === chassisGrid);
    assert(matches.length <= 1,
      `Expected at most one chassis ${description}, found ${matches.length}`);
    return matches[0]?.brick;
  }
  function hide(brick) {
    brick.data.collision = structuredClone(HIDDEN_COLLISION);
    brick.data.visibility = false;
    brick.data.material_intensity = 0;
  }

  let added = 0;
  let zone = existing(TYPES.zone, 'sensor zone');
  if (!zone) {
    // With direction 0, local [60, 120, 2] becomes a thin X-facing plate
    // approximately 240 units wide and 120 units tall in chassis space.
    zone = hiddenBrick('cat-adapter:sensor', chassisGrid, 'BP_ZoneProjector',
      [23, 0, 10], [60, 120, 2], 0);
    zone.comps.push({type: TYPES.zone, data: {}});
    added++;
  }
  Object.assign(zone.data, {
    asset: 'BP_ZoneProjector',
    size: [60, 120, 2],
    direction: 0,
    rotation: 0,
  });
  hide(zone);
  place(scene, chassisGrid, zone, [[23, 0, 10], [28, 0, 10], [33, 0, 10]]);
  Object.assign(one(zone.comps.filter(comp => comp.type === TYPES.zone), 'zone component').data, {
    ZoneStartDistance: 0,
    ZoneEndDistance: 900,
    bIsBuildingZone: false,
    bIsLooseZone: false,
    bIsShareZone: false,
    bWater: false,
    bDetectPlayers: true,
    bDetectPlayers1: true,
    bDetectPlayers2: true,
    bDetectPlayers3: true,
    bDetectEntities: true,
    bDetectProjectiles: false,
    TagFilter: '',
    ZoneWindForce: 0,
  });

  let speaker = existing(TYPES.audio, 'purr speaker');
  if (!speaker) {
    speaker = hiddenBrick('cat-adapter:purr', chassisGrid, 'B_1x1F_Speaker', [-15, 17, 18]);
    speaker.comps.push({type: TYPES.audio, data: {}});
    added++;
  }
  Object.assign(speaker.data, {
    asset: 'B_1x1F_Speaker',
    size: [0, 0, 0],
    direction: 4,
    rotation: 0,
  });
  hide(speaker);
  place(scene, chassisGrid, speaker,
    [[-15, 17, 18], [-15, -17, 18], [0, -17, 18], [0, 17, 18]]);
  Object.assign(one(speaker.comps.filter(comp => comp.type === TYPES.audio), 'audio component').data, {
    bEnabled: false,
    AudioDescriptor: importing.ensureAsset('BrickAudioDescriptor', 'BA_Thumpy_Machine'),
    VolumeMultiplier: 0.08,
    PitchMultiplier: 0.55,
    InnerRadius: 20,
    MaxDistance: 450,
    bSpatialization: true,
    FocusAzimuth: 360,
    NonFocusAzimuth: 360,
    NonFocusVolumeAttenuation: 1,
  });

  let chassis = existing(TYPES.readBrickGrid, 'ReadBrickGrid adapter');
  if (!chassis) {
    chassis = hiddenBrick('cat-adapter:chassis', chassisGrid,
      'B_1x1_Gate_Internal_ReadBrickGrid', [0, 0, 18]);
    chassis.comps.push({type: TYPES.readBrickGrid, data: {}});
    added++;
  }
  Object.assign(chassis.data, {
    asset: 'B_1x1_Gate_Internal_ReadBrickGrid',
    size: [0, 0, 0],
    direction: 4,
    rotation: 0,
  });
  hide(chassis);
  place(scene, chassisGrid, chassis,
    [[0, 0, 18], [0, -17, 18], [0, 17, 18], [-15, -17, 18], [-15, 17, 18]]);
  return {zone, speaker, chassis, added};
}

function insertControlPins(scene, targetGrid, controls) {
  const inserted = {};
  const outputEdges = [];
  for (const [name, control] of Object.entries(controls)) {
    const brick = structuredClone(control.brick);
    brick.key = `cat-control:${name}`;
    brick.g = targetGrid;
    assert(!scene.bricks.some(item => item.key === brick.key),
      `Duplicate retained control-pin key ${brick.key}`);
    const peers = scene.bricks.filter(item => item.g === targetGrid);
    assert(peers.every(peer => !overlaps(brick, peer)),
      `Provided ${name} pin overlaps the compiled brain at ${brick.data.position}`);
    scene.bricks.push(brick);
    inserted[name] = brick;
    for (const old of control.outputs) {
      const edge = {...old, a: brick.key};
      assert(!scene.edges.some(item => item.z === edge.z
        && item.zt === edge.zt && item.q === edge.q),
      `Provided ${name} output target already has a driver: ${edge.z} ${edge.zt}.${edge.q}`);
      scene.edges.push(edge);
      outputEdges.push(edge);
    }
  }
  return {bricks: inserted, outputEdges};
}

function fitBrainPlane(scene, targetGrid, sourceScene, sourceGrid) {
  const target = one([...scene.r.entities()].filter(entity =>
    entity.persistentIndex === targetGrid), 'target brain grid entity');
  const source = one([...sourceScene.r.entities()].filter(entity =>
    entity.persistentIndex === sourceGrid), 'compiled root grid entity');
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
  scene.entityOverrides ??= new Map();
  scene.entityOverrides.set(targetGrid, {
    ...target,
    data: {
      ...structuredClone(target.data),
      PlaneCenter: {X: center[0], Y: center[1], Z: source.data.PlaneCenter.Z},
      PlaneExtent: {X: extent[0], Y: extent[1], Z: Math.ceil(zExtent)},
    },
  });
}

function merge(catPath, compiledPath) {
  const original = read(fs.readFileSync(catPath));
  const scene = read(fs.readFileSync(catPath));
  const compiled = read(fs.readFileSync(compiledPath));
  const catBrain = brain(scene);
  const source = compiledRoot(compiled);
  const targetGrid = catBrain.link.grid;
  const providedControls = controlPins(scene, targetGrid);
  const targets = physicalTargets(scene, targetGrid);
  const importing = assetImporter(scene, compiled);
  const hardware = ensureHardware(scene, targets.chassisGrid, importing);
  targets.Purr = [{key: hardware.speaker.key, type: TYPES.audio, port: 'bEnabled'}];
  const oldBrainInteractions = catBrain.brick.comps.filter(comp =>
    comp.type === 'Component_Interact').length;
  catBrain.brick.comps = catBrain.brick.comps.filter(comp =>
    comp.type !== 'Component_Interact');

  const oldBrainKeys = new Set(scene.bricks.filter(brick => brick.g === targetGrid)
    .map(brick => brick.key));
  const retainedBricks = scene.bricks.filter(brick => !oldBrainKeys.has(brick.key));
  const retainedEdges = scene.edges.filter(edge =>
    !oldBrainKeys.has(edge.a) && !oldBrainKeys.has(edge.z));
  const retainedEdgeCount = retainedEdges.length;
  scene.bricks = retainedBricks;
  scene.edges = retainedEdges;

  const keyMap = new Map();
  let interactionGates = 0;
  for (const brick of compiled.bricks.filter(item => item.g === source.grid)) {
    const key = `wirescript:${brick.key}`;
    assert(!scene.bricks.some(item => item.key === key), `Duplicate imported brick key ${key}`);
    keyMap.set(brick.key, key);
    const comps = brick.comps.map(importing.component);
    for (const comp of comps) {
      if (comp.type !== TYPES.interacted) continue;
      comp.data.bAllowNearbyInteraction = true;
      comp.data.bHiddenInteraction = false;
      comp.data.PromptCustomLabel = 'Pet Cat';
      interactionGates++;
    }
    scene.bricks.push({...structuredClone(brick), key, g: targetGrid, comps});
  }

  const importedEdges = compiled.edges.filter(edge => keyMap.has(edge.a) && keyMap.has(edge.z))
    .map(edge => ({...edge, a: keyMap.get(edge.a), z: keyMap.get(edge.z)}));
  assert.equal(importedEdges.length, compiled.edges.length,
    'A compiled wire did not remain inside the flat root plane');
  scene.edges.push(...importedEdges);
  const controls = insertControlPins(scene, targetGrid, providedControls);
  for (const name of Object.keys(CONTROL_PINS)) {
    targets[name] = [{
      key: controls.bricks[name].key,
      type: TYPES.microchipInput,
      port: 'RER_Input',
    }];
  }

  const imported = scene.bricks.filter(brick => brick.g === targetGrid);
  function output(label) {
    const matches = imported.filter(brick => brick.comps.some(comp =>
      comp.type === TYPES.microchipOutput && comp.data.PortLabel === label));
    return one(matches, `WireScript output ${label}`);
  }
  function input(label) {
    const matches = imported.filter(brick => brick.comps.some(comp =>
      comp.type === TYPES.microchipInput && comp.data.PortLabel === label));
    return one(matches, `WireScript input ${label}`);
  }
  function connect(sourceBrick, destination) {
    assert(!scene.edges.some(edge => edge.z === destination.key
      && edge.zt === destination.type && edge.q === destination.port),
    `Output target already has a driver: ${destination.key} ${destination.type}.${destination.port}`);
    scene.edges.push({
      a: sourceBrick.key,
      at: TYPES.microchipOutput,
      p: 'RER_Output',
      z: destination.key,
      zt: destination.type,
      q: destination.port,
    });
  }
  let outputWireCount = 0;
  for (const label of OUTPUTS) {
    const sourceBrick = output(label);
    for (const destination of targets[label]) {
      connect(sourceBrick, destination);
      outputWireCount++;
    }
  }

  const interaction = one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === TYPES.interacted)), 'WireScript WholeGridInteracted event');
  const inputSources = {
    Sensor: {brick: hardware.zone, type: TYPES.zone, port: 'ZoneRef'},
    Petter: {brick: interaction, type: TYPES.interacted, port: 'Character'},
    Chassis: {brick: hardware.chassis, type: TYPES.readBrickGrid, port: 'BrickGrid'},
  };
  let inputWireCount = 0;
  for (const label of INPUTS) {
    const target = input(label);
    const sourceEndpoint = inputSources[label];
    assert(!scene.edges.some(edge => edge.z === target.key
      && edge.zt === TYPES.microchipInput && edge.q === 'RER_Input'),
    `WireScript input ${label} already has a driver`);
    scene.edges.push({
      a: sourceEndpoint.brick.key,
      at: sourceEndpoint.type,
      p: sourceEndpoint.port,
      z: target.key,
      zt: TYPES.microchipInput,
      q: 'RER_Input',
    });
    inputWireCount++;
  }

  fitBrainPlane(scene, targetGrid, compiled, source.grid);
  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const result = write(scene, {
    assets: importing.assets,
    embedded,
    name: 'Autonomous Cat Companion - WireScript Brain',
    description: 'Original cat body and native wheel joints with a compiled WireScript behavior brain.',
  });
  const saved = read(result.bytes);

  assert.equal(saved.links.length, original.links.length, 'Microchip link count changed');
  assert.equal(saved.joints.length, original.joints.length, 'Joint count changed');
  assert.equal(saved.bricks.length,
    original.bricks.length - oldBrainKeys.size + keyMap.size
      + Object.keys(controls.bricks).length + hardware.added,
    'Unexpected brick count after merge');
  assert.equal(saved.edges.length,
    retainedEdgeCount + importedEdges.length + controls.outputEdges.length
      + outputWireCount + inputWireCount,
    'Unexpected wire count after merge');
  const nativeWheelCount = [...saved.r.entities()].filter(entity =>
    /^Entity_Wheel_/.test(entity.typeName)).length;
  const originalWheelCount = [...original.r.entities()].filter(entity =>
    /^Entity_Wheel_/.test(entity.typeName)).length;
  assert.equal(nativeWheelCount, originalWheelCount, 'Native wheel entity count changed');

  return {
    bytes: result.bytes,
    targetGrid,
    sourceGrid: source.grid,
    removedBrainBricks: oldBrainKeys.size,
    importedBrainBricks: keyMap.size,
    importedBrainWires: importedEdges.length,
    retainedControlPins: Object.keys(controls.bricks).length,
    retainedControlOutputWires: controls.outputEdges.length,
    outputWires: outputWireCount,
    inputWires: inputWireCount,
    interactionGates,
    hardwareAdded: hardware.added,
    oldBrainInteractionsRemoved: oldBrainInteractions,
    externalAssets: importing.assets.length,
  };
}

module.exports = merge;
module.exports.TYPES = TYPES;

if (require.main === module) {
  const [catPath, compiledPath, outputPath] = process.argv.slice(2);
  if (!catPath || !compiledPath || !outputPath) {
    throw new Error('Usage: node merge-cat-wirescript.cjs cat.brz compiled-flat.brz output.brz');
  }
  const result = merge(catPath, compiledPath);
  fs.writeFileSync(outputPath, result.bytes);
  console.log(JSON.stringify({output: outputPath, ...result, bytes: result.bytes.length}, null, 2));
}
