'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {WorldReader} = require('brs-js');
const mergeBase = require('./merge-rigid-cat-state-machine.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');

const I = mergeBase._internals;
const T = {
  ...mergeBase.T,
  servo: 'Component_Internal_Servo',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  audio: 'Component_AudioEmitter',
  oneShotAudio: 'Component_OneShotAudioEmitter',
  audioReference: 'BrickComponentType_AudioReference',
};

const INPUTS = [
  'Chassis',
  'Head',
  'Radar',
  'Mouth',
  'Petter',
  'CurrentSpeed',
  'EngineStalling',
  'HeadCurrentAngle',
];

const OUTPUTS = [
  'Drive',
  'Steer',
  'Brake',
  'DriveSpeed',
  'FrontSuspension',
  'RearSuspension',
  'HeadAngle',
  'FaceText',
  'StateText',
  'MoodColor',
  'Purr',
  'PurrAudio',
];

const PIN_ALIASES = {
  PurrAudio: [
    'PurrAudio',
    'PURR AUDIO - select Purring',
    'PURR AUDIO — select Purring',
    'Purring Audio Constant',
  ],
};

const NAME = 'Autonomous Learning Cat';
const DESCRIPTION = 'Autonomous cat with committed goals, bounded preference learning, per-player relationships, food, treats, toys, beds, sleep, petting, purring, expressive faces, head tracking, and obstacle recovery.';

function component(scene, type, predicate = () => true, description = type) {
  return I.one(I.components(scene, type, predicate), description);
}

function endpointKey(edge) {
  return `${edge.z}|${edge.zt}|${edge.q}`;
}

function noDuplicateDrivers(edges) {
  const seen = new Set();
  for (const edge of edges) {
    const key = endpointKey(edge);
    assert(!seen.has(key), `Duplicate wire destination ${key}`);
    seen.add(key);
  }
}

function normalizeJoint(joint) {
  return {
    offset: structuredClone(joint.offset),
    rotation: structuredClone(joint.rotation),
  };
}

function sortedJson(values) {
  return values.map(value => JSON.stringify(value)).sort();
}

function bundle(reader) {
  return JSON.parse(Buffer.from(reader.fs.readFile('Meta/Bundle.json')).toString());
}

function cloneWithoutPresentation(value) {
  const result = structuredClone(value);
  delete result.name;
  delete result.description;
  return result;
}

function findHardware(scene) {
  const brain = I.brain(scene);
  const targetGrid = brain.link.grid;
  const engine = component(scene, T.engine,
    (_comp, brick) => brick.g !== targetGrid, 'wheel engine');
  const chassisGrid = engine.brick.g;
  const servo = component(scene, T.servo,
    (_comp, brick) => brick.g === chassisGrid, 'neck servo');
  const servoJoint = I.one(scene.joints.filter(joint => joint.key === servo.brick.key),
    'neck servo joint');
  const headGrid = servoJoint.entity;

  const wheels = I.components(scene, T.suspension,
    (_comp, brick) => brick.g === chassisGrid);
  assert.equal(wheels.length, 4, 'Expected four suspension wheels');
  const frontWheels = wheels.filter(({brick}) => brick.data.position[0] < 0);
  const rearWheels = wheels.filter(({brick}) => brick.data.position[0] > 0);
  assert.equal(frontWheels.length, 2, 'Expected two front wheels at local -X');
  assert.equal(rearWheels.length, 2, 'Expected two rear wheels at local +X');

  const chassisReader = component(scene, T.readGrid,
    (_comp, brick) => brick.g === chassisGrid, 'chassis-grid reader');
  const headReader = component(scene, T.readGrid,
    (_comp, brick) => brick.g === headGrid, 'head-grid reader');
  const radar = component(scene, T.zone,
    (_comp, brick) => brick.g === chassisGrid, 'chassis radar zone');
  const mouth = component(scene, T.zone,
    (_comp, brick) => brick.g === headGrid, 'mouth zone');
  const purrSpeaker = component(scene, T.audio,
    (_comp, brick) => brick.g === chassisGrid, 'continuous purr speaker');
  const oneShotSpeaker = component(scene, T.oneShotAudio,
    (_comp, brick) => brick.g === chassisGrid, 'one-shot speaker');

  const face = component(scene, T.text,
    (comp, brick) => brick.g === headGrid && comp.data.Text === 'Face Text Display',
    'face text display');
  const state = component(scene, T.text,
    (comp, brick) => brick.g === headGrid && comp.data.Text === 'Mood Display',
    'state text display');
  const mood = component(scene, T.text,
    (comp, brick) => brick.g === headGrid && comp.data.Text === '■',
    'mood square display');
  const guide = component(scene, T.text,
    (_comp, brick) => brick.g === chassisGrid, 'front-direction guide');

  return {
    brain, targetGrid, chassisGrid, headGrid,
    engine, servo, servoJoint, wheels, frontWheels, rearWheels,
    chassisReader, headReader, radar, mouth,
    purrSpeaker, oneShotSpeaker, face, state, mood, guide,
  };
}

function configureHardware(hardware) {
  const {engine, wheels, frontWheels, radar, mouth, servo,
    purrSpeaker, oneShotSpeaker, face, state, mood, guide} = hardware;

  Object.assign(engine.comp.data, {
    bEnabled: true,
    bEnableManualControl: true,
    ManualControlMode: 1,
    bAutodiscoverWheels: true,
    bTankSteering: false,
    DriveSpeed: 100,
  });

  const frontKeys = new Set(frontWheels.map(item => item.brick.key));
  for (const {brick, comp} of wheels) {
    Object.assign(comp.data, {
      bEnabled: true,
      bDiscoverable: true,
      bSuspensionEnabled: true,
      bCanBrake: true,
      bSteerEnabled: frontKeys.has(brick.key),
      SuspensionStiffness: 500,
      DrivePower: Math.max(20, comp.data.DrivePower || 0),
    });
  }

  Object.assign(radar.comp.data, {
    ZoneStartDistance: 0,
    ZoneEndDistance: 900,
    bDetectPlayers: true,
    bDetectPlayers1: true,
    bDetectPlayers2: true,
    bDetectPlayers3: true,
    bDetectEntities: true,
    bDetectProjectiles: false,
    TagFilter: '',
  });

  mouth.brick.data.size = [10, 10, 2];
  Object.assign(mouth.comp.data, {
    ZoneStartDistance: 0,
    ZoneEndDistance: 35,
    bDetectPlayers: false,
    bDetectPlayers1: false,
    bDetectPlayers2: false,
    bDetectPlayers3: false,
    bDetectEntities: true,
    bDetectProjectiles: false,
    TagFilter: '',
  });

  Object.assign(servo.comp.data, {
    bEnabled: true,
    Power: 100,
    ActiveDamping: 30,
  });

  for (const display of [face, state, mood]) {
    display.comp.data.bEnabled = true;
    display.comp.data.bOverrideColor = true;
  }
  guide.comp.data.Text = '';
  guide.comp.data.bEnabled = false;

  // The descriptor itself is supplied by the editable Audio Reference constant
  // in the brain. Keep the physical emitter quiet until Purr is asserted.
  Object.assign(purrSpeaker.comp.data, {
    bEnabled: false,
    VolumeMultiplier: 0.65,
    PitchMultiplier: 1,
    InnerRadius: 20,
    MaxDistance: 350,
    bSpatialization: true,
  });
  Object.assign(oneShotSpeaker.comp.data, {
    VolumeMultiplier: 0.8,
    PitchMultiplier: 1,
    InnerRadius: 20,
    MaxDistance: 450,
    bSpatialization: true,
  });
}

function build(catPath, brainPath) {
  const donorBytes = fs.readFileSync(catPath);
  const original = read(donorBytes);
  const scene = read(donorBytes);
  const compiled = read(fs.readFileSync(brainPath));
  const source = I.compiledRoot(compiled);
  const hardware = findHardware(scene);
  const originalJoints = original.joints.map(normalizeJoint)
    .sort((a, z) => JSON.stringify(a).localeCompare(JSON.stringify(z)));
  const originalNativeWheels = [...original.r.entities()]
    .filter(entity => /^Entity_Wheel_/.test(entity.typeName))
    .map(entity => ({typeName: entity.typeName,
      data: structuredClone(entity.data)}));
  assert.equal(originalNativeWheels.length, 4, 'Expected four native wheel entities');

  configureHardware(hardware);

  const oldBrainKeys = new Set(scene.bricks
    .filter(brick => brick.g === hardware.targetGrid)
    .map(brick => brick.key));
  assert(oldBrainKeys.size > 0, 'Existing chip plane must not be empty');
  scene.bricks = scene.bricks.filter(brick => !oldBrainKeys.has(brick.key));
  scene.edges = scene.edges.filter(edge =>
    !oldBrainKeys.has(edge.a) && !oldBrainKeys.has(edge.z));
  const retainedPhysicalEdges = scene.edges.length;
  assert.equal(scene.edges.filter(edge => edge.at === T.engine
    && edge.p === 'Control_DriveAndSteer'
    && edge.zt === T.suspension
    && edge.q === 'Control_DriveAndSteer').length, 4,
  'Retain all four engine-to-wheel control wires');

  const importing = I.assetImporter(scene, compiled);
  const keyMap = new Map();
  let interactionGates = 0;
  for (const brick of compiled.bricks.filter(item => item.g === source.grid)) {
    const key = `full-cat:${brick.key}`;
    keyMap.set(brick.key, key);
    const comps = brick.comps.map(importing.component);
    for (const comp of comps) {
      if (comp.type !== T.interacted) continue;
      Object.assign(comp.data, {
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
        PromptCustomLabel: 'Pet Cat',
      });
      interactionGates++;
    }
    scene.bricks.push({...structuredClone(brick), key,
      g: hardware.targetGrid, comps});
  }
  assert(keyMap.size > 0, 'Compiled brain plane must contain bricks');
  assert.equal(interactionGates, 1, 'Expected one WholeGridInteracted gate');

  const importedEdges = compiled.edges.map(edge => {
    assert(keyMap.has(edge.a) && keyMap.has(edge.z),
      'Compiled edge escaped the flat root plane');
    return {...edge, a: keyMap.get(edge.a), z: keyMap.get(edge.z)};
  });
  scene.edges.push(...importedEdges);

  const imported = scene.bricks.filter(brick => brick.g === hardware.targetGrid);
  const brainTitle = I.one(I.components({bricks: imported}, T.text,
    comp => /^<size="96">/.test(comp.data.Text || '')), 'compiled brain title');
  brainTitle.comp.data.Text = '<size="72">FULL CAT BRAIN\nPURR AUDIO CONSTANT: PurrAudio\nSELECT "Purring"</>';
  const pin = (type, logicalLabel) => {
    const labels = PIN_ALIASES[logicalLabel] || [logicalLabel];
    return I.one(imported.filter(brick => brick.comps.some(comp =>
      comp.type === type && labels.includes(comp.data.PortLabel))),
    `${logicalLabel} pin (${labels.join(' / ')})`);
  };

  for (const label of INPUTS) pin(T.microchipInput, label);
  for (const label of OUTPUTS) pin(T.microchipOutput, label);

  const interaction = I.one(imported.filter(brick => brick.comps.some(comp =>
    comp.type === T.interacted)), 'pet interaction event');
  const connect = (sourceBrick, sourceType, sourcePort,
    destinationBrick, destinationType, destinationPort) => {
    assert(!scene.edges.some(edge => edge.z === destinationBrick.key
      && edge.zt === destinationType && edge.q === destinationPort),
    `Duplicate output target ${destinationType}.${destinationPort}`);
    scene.edges.push({a: sourceBrick.key, at: sourceType, p: sourcePort,
      z: destinationBrick.key, zt: destinationType, q: destinationPort});
  };

  const inputSources = {
    Chassis: [hardware.chassisReader.brick, T.readGrid, 'BrickGrid'],
    Head: [hardware.headReader.brick, T.readGrid, 'BrickGrid'],
    Radar: [hardware.radar.brick, T.zone, 'ZoneRef'],
    Mouth: [hardware.mouth.brick, T.zone, 'ZoneRef'],
    Petter: [interaction, T.interacted, 'Character'],
    CurrentSpeed: [hardware.engine.brick, T.engine, 'Speed'],
    EngineStalling: [hardware.engine.brick, T.engine, 'bStalling'],
    HeadCurrentAngle: [hardware.servo.brick, T.servo, 'CurrentAngle'],
  };
  for (const label of INPUTS) {
    const sourceEndpoint = inputSources[label];
    const target = pin(T.microchipInput, label);
    connect(sourceEndpoint[0], sourceEndpoint[1], sourceEndpoint[2],
      target, T.microchipInput, 'RER_Input');
  }

  const outputTargets = {
    Drive: [[hardware.engine.brick, T.engine, 'ManualInput_Drive']],
    Steer: [[hardware.engine.brick, T.engine, 'ManualInput_Steer']],
    Brake: [[hardware.engine.brick, T.engine, 'bManualInput_Brake']],
    DriveSpeed: [[hardware.engine.brick, T.engine, 'DriveSpeed']],
    FrontSuspension: hardware.frontWheels.map(item =>
      [item.brick, T.suspension, 'SuspensionStiffness']),
    RearSuspension: hardware.rearWheels.map(item =>
      [item.brick, T.suspension, 'SuspensionStiffness']),
    HeadAngle: [[hardware.servo.brick, T.servo, 'TargetAngle']],
    FaceText: [[hardware.face.brick, T.text, 'Text']],
    StateText: [[hardware.state.brick, T.text, 'Text']],
    MoodColor: [
      [hardware.face.brick, T.text, 'Color'],
      [hardware.state.brick, T.text, 'Color'],
      [hardware.mood.brick, T.text, 'Color'],
    ],
    Purr: [[hardware.purrSpeaker.brick, T.audio, 'bEnabled']],
    PurrAudio: [[hardware.purrSpeaker.brick, T.audio, 'AudioDescriptor']],
  };
  for (const label of OUTPUTS) {
    const sourcePin = pin(T.microchipOutput, label);
    for (const [brick, type, port] of outputTargets[label]) {
      connect(sourcePin, T.microchipOutput, 'RER_Output', brick, type, port);
    }
  }

  assert.equal(I.components({bricks: imported}, T.audioReference).length, 1,
    'Expected one editable purr Audio Reference constant');
  noDuplicateDrivers(scene.edges);
  I.fitBrainPlane(scene, hardware.targetGrid, compiled, source.grid);

  const embedded = scene.r.prefabPaths().map(prefabPath =>
    scene.r.readPrefab(prefabPath));
  const generated = write(scene, {
    assets: importing.assets,
    embedded,
    name: NAME,
    description: DESCRIPTION,
  }).bytes;
  const finalBytes = repack(generated, donorBytes, {
    name: NAME,
    description: DESCRIPTION,
  });
  const saved = read(finalBytes);
  const savedHardware = findHardware(saved);

  assert.equal(saved.links.length, original.links.length,
    'Preserve microchip link count');
  assert.equal(saved.joints.length, original.joints.length,
    'Preserve joint count');
  assert.deepEqual(sortedJson(saved.joints.map(normalizeJoint)),
    sortedJson(originalJoints),
  'Preserve all five joint relationships and transforms');

  const savedNativeWheels = [...saved.r.entities()]
    .filter(entity => /^Entity_Wheel_/.test(entity.typeName))
    .map(entity => ({typeName: entity.typeName,
      data: structuredClone(entity.data)}));
  assert.deepEqual(sortedJson(savedNativeWheels), sortedJson(originalNativeWheels),
    'Preserve native wheel entity type, scale, friction, and data');

  assert.equal(saved.edges.filter(edge => edge.at === T.engine
    && edge.p === 'Control_DriveAndSteer'
    && edge.zt === T.suspension
    && edge.q === 'Control_DriveAndSteer').length, 4,
  'Saved prefab retains all engine-to-wheel wires');
  assert(!saved.edges.some(edge => oldBrainKeys.has(edge.a)
    || oldBrainKeys.has(edge.z)), 'No wire may reference a deleted old brain gate');
  noDuplicateDrivers(saved.edges);

  const expectedBricks = original.bricks.length - oldBrainKeys.size + keyMap.size;
  assert.equal(saved.bricks.length, expectedBricks,
    'Only the old chip plane may be replaced');
  const externalWireCount = INPUTS.length
    + Object.values(outputTargets).reduce((total, targets) => total + targets.length, 0);
  assert.equal(saved.edges.length,
    retainedPhysicalEdges + importedEdges.length + externalWireCount,
  'Saved wire count must match retained, brain-internal, and interface wires');

  const donorReader = WorldReader.from(donorBytes);
  const finalReader = WorldReader.from(finalBytes);
  assert.deepEqual(cloneWithoutPresentation(bundle(finalReader)),
    cloneWithoutPresentation(bundle(donorReader)),
  'Retain donor bundle metadata beyond name and description');
  assert.equal(bundle(finalReader).name, NAME);
  assert.equal(bundle(finalReader).description, DESCRIPTION);

  return {
    bytes: finalBytes,
    saved,
    oldBrainBricks: oldBrainKeys.size,
    importedBrainBricks: keyMap.size,
    importedBrainWires: importedEdges.length,
    externalWires: externalWireCount,
    targetGrid: hardware.targetGrid,
    chassisGrid: hardware.chassisGrid,
    headGrid: hardware.headGrid,
  };
}

module.exports = build;
module.exports.T = T;
module.exports.INPUTS = INPUTS;
module.exports.OUTPUTS = OUTPUTS;

if (require.main === module) {
  const [catPath, brainPath, outputPath] = process.argv.slice(2);
  if (!catPath || !brainPath || !outputPath) {
    throw new Error('Usage: node build-cat-frame-brain.cjs "Cat Frame.brz" full-cat-brain.brz output.brz');
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), {recursive: true});
  const result = build(catPath, brainPath);
  fs.writeFileSync(outputPath, result.bytes);
  console.log(JSON.stringify({
    output: path.resolve(outputPath),
    bricks: result.saved.bricks.length,
    wires: result.saved.edges.length,
    oldBrainBricks: result.oldBrainBricks,
    importedBrainBricks: result.importedBrainBricks,
    importedBrainWires: result.importedBrainWires,
    externalWires: result.externalWires,
    targetGrid: result.targetGrid,
    chassisGrid: result.chassisGrid,
    headGrid: result.headGrid,
    bytes: result.bytes.length,
  }, null, 2));
}
