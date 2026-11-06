'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read, write} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {assertNoInstantCycles} = require('./loadboard-queue-repair.cjs');

const TYPES = {
  microchip: 'Component_Internal_Microchip',
  microchipInput: 'BrickComponentType_Internal_MicrochipInput',
  microchipOutput: 'BrickComponentType_Internal_MicrochipOutput',
  interacted: 'BrickComponentType_Event_WholeGridInteracted',
  targeted: 'BrickComponentType_Event_WholeGridTargeted',
  chat: 'BrickComponentType_Event_ChatCommand',
  zoneEntities: 'BrickComponentType_Exec_Zone_GetEntities',
  playAudioAt: 'Component_WireGraph_PlayAudioAt',
  mathDivide: 'BrickComponentType_Expr_MathDivide',
  readBrickGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  sweep: 'BrickComponentType_Exec_Sweep',
  engine: 'Component_Internal_WheelEngine',
  servo: 'Component_Internal_Servo',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  text: 'Component_TextDisplay',
  zone: 'Component_Internal_AttachedZone',
  audio: 'Component_AudioEmitter',
  interact: 'Component_Interact',
};

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('Usage: node test-cat-companion-expanded.cjs source-cat.brz output-cat.brz');
}

const source = read(fs.readFileSync(sourcePath));
const output = read(fs.readFileSync(outputPath));
const all = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type)
  .map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};
const component = (brick, type) => brick.comps.find(comp => comp.type === type);

assertNoInstantCycles(output);
const placement = validatePlacement(fs.readFileSync(outputPath));
assert.equal(placement.strictOk, true, JSON.stringify(placement));
assert.equal(placement.invalidBricks.length, 0);
assert.equal(placement.confirmedPairs.length, 0);
assert.equal(placement.uncertainPairs.length, 0);
assert(placement.warnings.every(warning => warning.type === 'unknown-native-bounds'
  && warning.asset === 'BP_ZoneProjector'), JSON.stringify(placement.warnings));

assert.equal(output.links.length, 1, 'One brain link');
assert.equal(output.joints.length, 5, 'Four wheel joints and one body servo joint');
assert.equal(all(output, TYPES.interacted).length, 1, 'One pet interaction event');
assert.equal(all(output, TYPES.targeted).length, 1, 'One fear/damage event');
const chat = one(all(output, TYPES.chat), '/cat command event');
assert.equal(chat.comp.data.CommandName, 'cat');
assert.equal(chat.comp.data.HelpText, 'Call a nearby cat');

const recognizedTags = all(output, TYPES.zoneEntities)
  .map(({comp}) => comp.data.TagFilter)
  .sort();
assert.deepEqual(recognizedTags, [
  'Cat Bed 1',
  'Cat Food 1',
  'Cat toy 1',
  'Kitty Treat 1',
  'cat:bed',
  'cat:food',
  'cat:toy',
  'cat:treat',
].sort());

const meows = all(output, TYPES.playAudioAt);
assert(meows.length >= 1, 'At least one meow action');
for (const {brick, comp} of meows) {
  assert.equal(comp.data.bSpatialization, true);
  assert.equal(output.r.externalAssets()[comp.data.AudioDescriptor].name, 'OBA_Beep_3');
  const pitch = one(output.edges.filter(edge => edge.z === brick.key
    && edge.zt === TYPES.playAudioAt && edge.q === 'PitchMultiplier'), 'random meow pitch');
  assert.equal(pitch.at, TYPES.mathDivide);
  const location = one(output.edges.filter(edge => edge.z === brick.key
    && edge.zt === TYPES.playAudioAt && edge.q === 'Entity'), 'meow location entity');
  assert.equal(location.p, 'Output');
}

const sweeps = all(output, TYPES.sweep);
assert.equal(sweeps.length, 3, 'Pickup, ground, and obstacle sweeps');
const pickupSweep = one(sweeps.filter(({comp}) => comp.data.Radius === 210), 'pickup player sweep').comp.data;
assert.equal(pickupSweep.bDetectBricks, false);
assert.equal(pickupSweep.bDetectPhysics, false);
assert.equal(pickupSweep.bDetectMap, false);
assert.equal(pickupSweep.bDetectPlayers1, true);
assert.equal(pickupSweep.bOnlyHitPlayerBodyParts, false);
const groundSweep = one(sweeps.filter(({comp}) => comp.data.Distance === 72), 'ground sweep').comp.data;
assert.equal(groundSweep.bDetectBricks, true);
assert.equal(groundSweep.bDetectPhysics, false,
  'The cat must not mistake its four attached wheel entities for the ground');
assert.equal(groundSweep.bDetectMap, true);
assert.equal(groundSweep.bDetectPlayers1, false);
const obstacleSweep = one(sweeps.filter(({comp}) => comp.data.Distance === 92), 'obstacle sweep').comp.data;
assert.equal(obstacleSweep.bDetectBricks, true);
assert.equal(obstacleSweep.bDetectPhysics, false,
  'Tagged physics targets must not be mistaken for obstacles');
assert.equal(obstacleSweep.bDetectMap, true);
assert.equal(obstacleSweep.bDetectPlayers1, false);

const wheelSnapshot = scene => [...scene.r.entities()]
  .filter(entity => entity.typeName === 'Entity_Wheel_Offroad1')
  .map(entity => ({
    location: entity.location,
    rotation: entity.rotation,
    data: entity.data,
    colors: entity.colors,
    frozen: entity.frozen,
    sleeping: entity.sleeping,
    linearVelocity: entity.linearVelocity,
    angularVelocity: entity.angularVelocity,
  }))
  .sort((a, z) => JSON.stringify(a.location).localeCompare(JSON.stringify(z.location)));
assert.equal(wheelSnapshot(output).length, 4, 'Four native wheels survive');
assert.deepEqual(wheelSnapshot(output), wheelSnapshot(source), 'Native wheel records changed');

const engine = one(all(output, TYPES.engine), 'wheel engine');
assert.equal(engine.comp.data.bEnableManualControl, true);
assert.equal(engine.comp.data.ManualControlMode, 1);
const neck = one(all(output, TYPES.servo), 'neck servo');
const sourceNeck = one(all(source, TYPES.servo), 'source neck servo');
assert.equal(neck.brick.g, engine.brick.g, 'Neck servo remains on the chassis');
assert.deepEqual(neck.brick.data, sourceNeck.brick.data, 'Neck servo brick changed');
assert.deepEqual(neck.comp.data, sourceNeck.comp.data, 'Neck servo settings changed');
const face = one(all(output, TYPES.text).filter(({comp}) =>
  /[😺😼😿😻😾]/u.test(comp.data.Text || '')), 'cat face');

const outputs = new Map(all(output, TYPES.microchipOutput)
  .map(item => [item.comp.data.PortLabel, item]));
const inputs = new Map(all(output, TYPES.microchipInput)
  .map(item => [item.comp.data.PortLabel, item]));
const controlPin = (scene, pattern, label) => one(all(scene, TYPES.microchipInput)
  .filter(({comp}) => pattern.test(comp.data.PortLabel || '')), label);
const controls = {
  DriveSpeed: controlPin(output, /^Input Speed(?:,|$)/i, 'speed control pin'),
  FrontSuspension: controlPin(output,
    /^Input Front Wheel Suspension(?:,|$)/i, 'front suspension control pin'),
  RearSuspension: controlPin(output,
    /^Input Rear Wheel Suspension(?:,|$)/i, 'rear suspension control pin'),
};
const sourceControls = {
  DriveSpeed: controlPin(source, /^Input Speed(?:,|$)/i, 'source speed control pin'),
  FrontSuspension: controlPin(source,
    /^Input Front Wheel Suspension(?:,|$)/i, 'source front suspension control pin'),
  RearSuspension: controlPin(source,
    /^Input Rear Wheel Suspension(?:,|$)/i, 'source rear suspension control pin'),
};
for (const label of ['Drive', 'Steer', 'Brake', 'DriveSpeed', 'FrontSuspension',
  'RearSuspension', 'HeadAngle', 'FaceText', 'Purr']) {
  assert(outputs.has(label), `Missing output ${label}`);
}
for (const label of ['Chassis', 'Sensor', 'Petter']) {
  assert(inputs.has(label), `Missing input ${label}`);
}

function drivers(type, port) {
  return output.edges.filter(edge => edge.zt === type && edge.q === port);
}
function assertOutputDriver(type, port, label, count = 1) {
  const edges = drivers(type, port);
  assert.equal(edges.length, count, `${type}.${port} driver count`);
  for (const edge of edges) {
    assert.equal(edge.a, outputs.get(label).brick.key, `${type}.${port} source`);
    assert.equal(edge.at, TYPES.microchipOutput);
    assert.equal(edge.p, 'RER_Output');
  }
}
assertOutputDriver(TYPES.engine, 'ManualInput_Drive', 'Drive');
assertOutputDriver(TYPES.engine, 'ManualInput_Steer', 'Steer');
assertOutputDriver(TYPES.engine, 'bManualInput_Brake', 'Brake');
assertOutputDriver(TYPES.servo, 'TargetAngle', 'HeadAngle');
assertOutputDriver(TYPES.text, 'Text', 'FaceText');

for (const label of ['DriveSpeed', 'FrontSuspension', 'RearSuspension']) {
  const before = sourceControls[label];
  const after = controls[label];
  assert.deepEqual(after.brick.data, before.brick.data, `${label} control brick changed`);
  assert.deepEqual(after.comp.data, before.comp.data, `${label} control note/settings changed`);
  const incoming = one(output.edges.filter(edge => edge.z === after.brick.key
    && edge.zt === TYPES.microchipInput && edge.q === 'RER_Input'), `${label} adapter input`);
  assert.equal(incoming.a, outputs.get(label).brick.key, `${label} WireScript adapter source`);
  assert.equal(incoming.at, TYPES.microchipOutput);
  assert.equal(incoming.p, 'RER_Output');
}

const speedDrivers = drivers(TYPES.engine, 'DriveSpeed');
assert.equal(speedDrivers.length, 1, 'One speed driver');
assert.equal(speedDrivers[0].a, controls.DriveSpeed.brick.key);
assert.equal(speedDrivers[0].at, TYPES.microchipInput);
assert.equal(speedDrivers[0].p, 'RER_Output');
const suspensionDrivers = drivers(TYPES.suspension, 'SuspensionStiffness');
assert.equal(suspensionDrivers.length, 4, 'Four suspension drivers');
assert.equal(suspensionDrivers.filter(edge =>
  edge.a === controls.FrontSuspension.brick.key
    && edge.at === TYPES.microchipInput && edge.p === 'RER_Output').length, 2);
assert.equal(suspensionDrivers.filter(edge =>
  edge.a === controls.RearSuspension.brick.key
    && edge.at === TYPES.microchipInput && edge.p === 'RER_Output').length, 2);

const zone = one(all(output, TYPES.zone), 'attached sensor zone');
assert.equal(zone.brick.g, engine.brick.g, 'Sensor follows chassis');
assert.deepEqual(zone.brick.data.size, [60, 120, 2]);
assert.equal(zone.brick.data.direction, 0);
assert.equal(zone.brick.data.visibility, false);
assert.equal(zone.comp.data.ZoneEndDistance, 900);
assert.equal(zone.comp.data.bDetectEntities, true);
assert.equal(zone.comp.data.bDetectPlayers, true);
assert.equal(zone.comp.data.TagFilter, '');

const speaker = one(all(output, TYPES.audio), 'purr speaker');
assert.equal(speaker.brick.g, engine.brick.g, 'Purr follows chassis');
assert.equal(speaker.brick.data.visibility, false);
assert.equal(speaker.comp.data.bEnabled, false);
assert(Math.abs(speaker.comp.data.VolumeMultiplier - 0.08) < 1e-6);
const speakerAsset = output.r.externalAssets()[speaker.comp.data.AudioDescriptor];
assert.deepEqual(speakerAsset,
  {type: 'BrickAudioDescriptor', name: 'BA_Thumpy_Machine'});
assertOutputDriver(TYPES.audio, 'bEnabled', 'Purr');

const chassisReader = one(all(output, TYPES.readBrickGrid)
  .filter(({brick}) => brick.g === engine.brick.g), 'chassis ReadBrickGrid adapter');
const interaction = one(all(output, TYPES.interacted), 'pet interaction event');
assert.equal(interaction.comp.data.PromptCustomLabel, 'Pet Cat');
assert.equal(interaction.comp.data.bAllowNearbyInteraction, true);
assert.equal(interaction.comp.data.bHiddenInteraction, false);

const inputSource = label => {
  const target = inputs.get(label).brick;
  return one(output.edges.filter(edge => edge.z === target.key
    && edge.zt === TYPES.microchipInput && edge.q === 'RER_Input'), `${label} input wire`);
};
assert.deepEqual(
  {a: inputSource('Sensor').a, at: inputSource('Sensor').at, p: inputSource('Sensor').p},
  {a: zone.brick.key, at: TYPES.zone, p: 'ZoneRef'},
);
assert.deepEqual(
  {a: inputSource('Petter').a, at: inputSource('Petter').at, p: inputSource('Petter').p},
  {a: interaction.brick.key, at: TYPES.interacted, p: 'Character'},
);
assert.deepEqual(
  {a: inputSource('Chassis').a, at: inputSource('Chassis').at, p: inputSource('Chassis').p},
  {a: chassisReader.brick.key, at: TYPES.readBrickGrid, p: 'BrickGrid'},
);

const shell = one(output.bricks.filter(brick => component(brick, TYPES.microchip)
  && output.links.some(link => link.key === brick.key)), 'brain shell');
assert.equal(shell.g, face.brick.g, 'Brain shell should remain mounted on the head grid');
assert.equal(component(shell, TYPES.interact), undefined,
  'Old brain-note interaction should not override petting');
assert.equal(face.comp.data.bEnabled, true);

const rebuilt = write(output, {
  assets: output.r.externalAssets(),
  prefab: output.r.prefabJson(),
  name: output.r.bundle().name,
  description: output.r.bundle().description,
}).bytes;
const reopened = read(rebuilt);
assert.equal(reopened.bricks.length, output.bricks.length, 'Round-trip brick count');
assert.equal(reopened.edges.length, output.edges.length, 'Round-trip wire count');
assert.equal(reopened.links.length, output.links.length, 'Round-trip link count');
assert.equal(reopened.joints.length, output.joints.length, 'Round-trip joint count');
assert.equal(wheelSnapshot(reopened).length, 4, 'Round-trip native wheels');

console.log(JSON.stringify({
  strictPlacement: true,
  bricks: output.bricks.length,
  wires: output.edges.length,
  brainGates: output.bricks.filter(brick => brick.g === output.links[0].grid).length,
  outputs: 9,
  inputs: 3,
  nativeWheels: 4,
  joints: output.joints.length,
  instantCycles: 0,
  roundTrip: true,
}, null, 2));
