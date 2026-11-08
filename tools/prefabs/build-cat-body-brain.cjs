'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const mergeBase = require('./merge-rigid-cat-state-machine.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const I = mergeBase._internals;

const T = {...mergeBase.T,
  servo: 'Component_Internal_Servo',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  button: 'Component_Button',
  interact: 'Component_Interact',
};
const INPUTS = ['Chassis', 'Head', 'Radar', 'Mouth', 'Petter'];
const OUTPUTS = ['Drive', 'Steer', 'Brake', 'HeadAngle', 'FaceText', 'FaceColor'];

function component(scene, type, predicate = () => true) {
  return I.one(I.components(scene, type, predicate), type);
}

function addZone(scene, key, grid, position, size, distance) {
  const brick = I.hiddenBrick(key, grid, 'BP_ZoneProjector', position, size, 0);
  brick.comps.push({type: T.zone, data: {
    ZoneStartDistance: 0, ZoneEndDistance: distance,
    bIsBuildingZone: false, bIsLooseZone: false, bIsShareZone: false, bWater: false,
    bDetectPlayers: false, bDetectPlayers1: false, bDetectPlayers2: false,
    bDetectPlayers3: false, bDetectEntities: true, bDetectProjectiles: false,
    TagFilter: '', ZoneWindForce: 0,
  }});
  scene.bricks.push(brick);
  return brick;
}

function build(catPath, brainPath, engineDonorPath) {
  const original = read(fs.readFileSync(catPath));
  const scene = read(fs.readFileSync(catPath));
  const compiled = read(fs.readFileSync(brainPath));
  const donor = read(fs.readFileSync(engineDonorPath));
  const catBrain = I.brain(scene);
  // The checked-in donor is the previously integrated cat rather than the
  // compiler's standalone save. Its single linked plane is still the flat,
  // self-contained WireScript brain we need.
  const sourceLink = I.one(compiled.links, 'donor brain link');
  const source = {link: sourceLink, grid: sourceLink.grid};
  const targetGrid = catBrain.link.grid;
  const servo = component(scene, T.servo);
  const headGrid = I.one(scene.joints.filter(j => j.key === servo.brick.key), 'head joint').entity;
  const faceDisplays = I.components(scene, T.text, (_c, b) => b.g === headGrid);
  assert.equal(faceDisplays.length, 2, 'two head displays');
  const face = faceDisplays.find(x => x.comp.data.Text !== '■');
  const mood = faceDisplays.find(x => x.comp.data.Text === '■');
  assert(face && mood);
  face.comp.data.bOverrideColor = true;
  mood.comp.data.bOverrideColor = true;

  // The WholeGridInteracted gate inside the brain supplies the nearby
  // interaction prompt. Do not add Button/Interact components to the display:
  // current Brickadia rejects that unsupported component combination while
  // importing the prefab, before it reaches the inventory.

  const importing = I.assetImporter(scene, compiled);
  const oldKeys = new Set(scene.bricks.filter(b => b.g === targetGrid).map(b => b.key));
  scene.bricks = scene.bricks.filter(b => !oldKeys.has(b.key));
  scene.edges = scene.edges.filter(e => !oldKeys.has(e.a) && !oldKeys.has(e.z));

  const donorEngine = component(donor, T.engine);
  const engine = I.hiddenBrick('full-cat:engine', servo.brick.g,
    donorEngine.brick.data.asset, [20, 20, 20]);
  engine.comps.push({type: T.engine, data: structuredClone(donorEngine.comp.data)});
  engine.comps[0].data.bEnableManualControl = true;
  engine.comps[0].data.bAutodiscoverWheels = true;
  engine.comps[0].data.DriveSpeed = 100;
  scene.bricks.push(engine);

  // Front is -Y on this frame. All wheels drive; only the front pair steer.
  for (const {brick, comp} of I.components(scene, T.suspension)) {
    comp.data.bSteerEnabled = brick.data.position[1] < 0;
    comp.data.DrivePower = Math.max(comp.data.DrivePower || 0, 20);
  }

  const chassisReader = I.hiddenBrick('full-cat:chassis-reader', servo.brick.g,
    'B_1x1_Gate_Internal_ReadBrickGrid', [-20, 20, 20]);
  chassisReader.comps.push({type: T.readGrid, data: {}});
  scene.bricks.push(chassisReader);
  const headReader = I.hiddenBrick('full-cat:head-reader', headGrid,
    'B_1x1_Gate_Internal_ReadBrickGrid', [0, 8, 8]);
  headReader.comps.push({type: T.readGrid, data: {}});
  scene.bricks.push(headReader);
  const radar = addZone(scene, 'full-cat:radar', servo.brick.g, [30, 0, 12], [10, 10, 2], 900);
  const mouth = addZone(scene, 'full-cat:mouth', headGrid, [0, -20, -4], [10, 10, 2], 35);

  const keyMap = new Map();
  for (const brick of compiled.bricks.filter(b => b.g === source.grid)) {
    const key = `full-cat:${brick.key}`;
    keyMap.set(brick.key, key);
    const comps = brick.comps.map(importing.component);
    for (const comp of comps) if (comp.type === T.interacted) {
      comp.data.bAllowNearbyInteraction = true;
      comp.data.bHiddenInteraction = false;
      comp.data.PromptCustomLabel = 'Pet Cat';
    }
    scene.bricks.push({...structuredClone(brick), key, g: targetGrid, comps});
  }
  for (const edge of compiled.edges) {
    if (!keyMap.has(edge.a) || !keyMap.has(edge.z)) continue;
    scene.edges.push({...edge, a: keyMap.get(edge.a), z: keyMap.get(edge.z)});
  }

  const imported = scene.bricks.filter(b => b.g === targetGrid);
  const pin = (type, label) => I.one(imported.filter(b => b.comps.some(c =>
    c.type === type && c.data.PortLabel === label)), `${label} pin`);
  const connect = (a, at, p, z, zt, q) => scene.edges.push({a:a.key, at, p, z:z.key, zt, q});
  const out = {
    Drive: [engine, T.engine, 'ManualInput_Drive'],
    Steer: [engine, T.engine, 'ManualInput_Steer'],
    Brake: [engine, T.engine, 'bManualInput_Brake'],
    HeadAngle: [servo.brick, T.servo, 'TargetAngle'],
    FaceText: [face.brick, T.text, 'Text'],
    FaceColor: [face.brick, T.text, 'Color'],
  };
  for (const label of OUTPUTS) {
    const p = pin(T.microchipOutput, label); const [z, zt, q] = out[label];
    connect(p, T.microchipOutput, 'RER_Output', z, zt, q);
  }
  const interaction = component({bricks: imported}, T.interacted);
  const input = {
    Chassis: [chassisReader, T.readGrid, 'BrickGrid'],
    Head: [headReader, T.readGrid, 'BrickGrid'],
    Radar: [radar, T.zone, 'ZoneRef'],
    Mouth: [mouth, T.zone, 'ZoneRef'],
    Petter: [interaction.brick, T.interacted, 'Character'],
  };
  for (const label of INPUTS) {
    const [a, at, p] = input[label];
    const target = pin(T.microchipInput, label);
    const already = scene.edges.some(e => e.z === target.key
      && e.zt === T.microchipInput && e.q === 'RER_Input');
    if (!already) connect(a, at, p, target, T.microchipInput, 'RER_Input');
  }

  I.fitBrainPlane(scene, targetGrid, compiled, source.grid);
  const embedded = scene.r.prefabPaths().map(path => scene.r.readPrefab(path));
  const result = write(scene, {assets: importing.assets, embedded,
    name: 'Cat Body - Autonomous Brain',
    description: 'Autonomous four-wheel cat: roam, relax, follow /cat, seek food, eat, stalk, chase, sleep, accept pets, track targets with its head, and avoid walls.',
  });
  const saved = read(result.bytes);
  assert.equal(saved.links.length, original.links.length);
  assert.equal(saved.joints.length, original.joints.length);
  const bytes = repack(result.bytes, fs.readFileSync(catPath), {
    name: 'Cat Body - Autonomous Brain',
    description: 'Autonomous four-wheel cat: roam, relax, follow /cat, seek food, eat, stalk, chase, sleep, accept pets, track targets with its head, and avoid walls.',
  });
  return {bytes, saved: read(bytes), targetGrid, headGrid};
}

module.exports = build;
if (require.main === module) {
  const [cat, brain, donor, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node build-cat-body-brain.cjs cat brain donor output');
  const result = build(cat, brain, donor);
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({output, bricks: result.saved.bricks.length,
    wires: result.saved.edges.length, bytes: result.bytes.length}, null, 2));
}
