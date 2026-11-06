'use strict';

const fs = require('fs');
const path = require('path');
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
  select: 'BrickComponentType_Expr_Select',
  destroySpawnedPrefab: 'BrickComponentType_Exec_Entity_DestroySpawnedPrefab',
  varGet: 'BrickComponentType_Exec_Var_Get',
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
const behaviorSource = fs.readFileSync(
  path.join(__dirname, 'cat-companion-brain.ws'), 'utf8');
const all = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type)
  .map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};
const component = (brick, type) => brick.comps.find(comp => comp.type === type);

for (const [label, pattern] of [
  ['Stalk orange mapping', /mode\.Value == STALK then ColorSRGB\(255, 145, 35, 255\)/],
  ['Chase yellow mapping', /mode\.Value == CHASE then ColorSRGB\(255, 225, 45, 255\)/],
  ['Angry red mapping', /mode\.Value == ANGRY then ColorSRGB\(255, 65, 65, 255\)/],
  ['Tired cyan mapping', /mode\.Value == RETURN_BED then ColorSRGB\(45, 225, 235, 255\)/],
  ['Sleep dark-blue mapping', /mode\.Value == SLEEP then ColorSRGB\(25, 55, 150, 255\)/],
  ['Hungry lime mapping', /hunger\.Value >= 72\.0 then ColorSRGB\(155, 230, 80, 255\)/],
  ['Stretch amber mapping', /mode\.Value == STRETCH then ColorSRGB\(245, 180, 45, 255\)/],
  ['Angry face mapping', /mode\.Value == ANGRY then "😾"/u],
  ['Stretch face mapping', /mode\.Value == STRETCH then "🐈"/u],
  ['Stalk and Chase face mapping', /mode\.Value == STALK \|\| mode\.Value == CHASE then "😼"/u],
  ['Sleep face mapping', /mode\.Value == SLEEP then "zzZ"/],
  ['Sleepy face mapping', /tired\.Value \|\| mode\.Value == RETURN_BED then "zzz"/],
  ['Sad face mapping', /mode\.Value == FLEE then "😿"/u],
  ['Angry front-low posture', /let wantedFront = if mode == ANGRY then 100\.0/],
  ['Angry rear-low posture', /let wantedRear = if mode == ANGRY then 100\.0/],
  ['Stretch front-low posture', /else if mode == STRETCH then 100\.0/],
  ['Stretch rear-high posture', /else if mode == STRETCH then 500\.0/],
  ['Stalk front-low posture', /else if mode == STALK then 100\.0/],
  ['Stalk rear-high posture', /else if mode == STALK then 500\.0/],
  ['Angry retreat timer', /angryDriveUntil = seconds \+ 5/],
  ['Angry retreat from live player', /let threat = if playerNearby then nearestPlayerPosition/],
  ['Angry retreat target', /aimAway\(threat\)/],
  ['Stretch duration', /stretchUntil = seconds \+ Random\(4, 7\)/],
  ['Stretch reverse motion', /if mode == STRETCH \{\s+driveCommand = -0\.18/],
  ['Stretch releases brake', /driveCommand = -0\.18\s+steerCommand = 0\.0\s+brakeCommand = false/],
  ['Five-to-ten-minute awake interval', /nextNapAt = seconds \+ Random\(300, 600\)/],
  ['Thirty-to-sixty-second nap', /napUntil = seconds \+ Random\(30, 60\)/],
  ['Fifteen-second pet request', /petRequestUntil = seconds \+ 15/],
  ['Requested over-petting threshold', /requestedSession && petBurstCount >= 6/],
  ['Unsolicited over-petting threshold', /!requestedSession && petBurstCount >= 3/],
]) {
  assert.match(behaviorSource, pattern, `Missing behavior contract: ${label}`);
}

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
  'Cat Food',
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

const consumeProps = all(output, TYPES.destroySpawnedPrefab);
assert.equal(consumeProps.length, 2, 'Treat and exact Cat Food prefab delete gates');
const consumedSources = [];
for (const consume of consumeProps) {
  const consumedEntity = one(output.edges.filter(edge => edge.z === consume.brick.key
    && edge.zt === TYPES.destroySpawnedPrefab && edge.q === 'Entity'),
    'consumed prop entity');
  assert.equal(consumedEntity.at, TYPES.varGet);
  assert.equal(consumedEntity.p, 'Value');
  consumedSources.push(consumedEntity.a);
}
assert.equal(new Set(consumedSources).size, 2, 'Food and treat use distinct entity variables');

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
const sourceFace = one(all(source, TYPES.text).filter(({comp}) =>
  /[😺😼😿😻😾]/u.test(comp.data.Text || '')), 'source cat face');
const mood = one(all(output, TYPES.text).filter(({comp}) =>
  comp.data.Text === '■'), 'cat mood indicator');
const sourceMood = one(all(source, TYPES.text).filter(({comp}) =>
  comp.data.Text === '■'), 'source cat mood indicator');
assert.equal(mood.brick.g, face.brick.g, 'Mood indicator remains on the head grid');
assert.deepEqual(face.brick.data, sourceFace.brick.data, 'Face display brick changed');
assert.deepEqual(face.comp.data, sourceFace.comp.data, 'Face display settings changed');
assert.deepEqual(mood.brick.data, sourceMood.brick.data, 'Mood indicator brick changed');
assert.deepEqual(mood.comp.data, sourceMood.comp.data, 'Mood indicator settings changed');
const palette = all(output, TYPES.select).flatMap(({comp}) =>
  [comp.data.InputA, comp.data.InputB]
    .filter(value => value?.$variant === 'LinearColor')
    .map(value => value.value));
const hasColor = expected => palette.some(color => ['R', 'G', 'B', 'A']
  .every((channel, index) => Math.abs(color[channel] - expected[index]) < 1e-5));
const linearChannel = value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const linearColor = (r, g, b, a = 255) => [
  linearChannel(r), linearChannel(g), linearChannel(b), a / 255,
];
for (const [label, rgb] of [
  ['orange Stalk', [255, 145, 35]],
  ['yellow Chase', [255, 225, 45]],
  ['red Angry', [255, 65, 65]],
  ['cyan Tired', [45, 225, 235]],
  ['dark-blue Sleep', [25, 55, 150]],
  ['lime Hungry', [155, 230, 80]],
  ['magenta Treat', [230, 80, 210]],
  ['amber Stretch', [245, 180, 45]],
]) {
  assert(hasColor(linearColor(...rgb)), `Missing ${label} indicator color`);
}
const faceLiterals = new Set(all(output, TYPES.select).flatMap(({comp}) =>
  [comp.data.InputA, comp.data.InputB]
    .filter(value => value?.$variant === 'str')
    .map(value => value.value)));
for (const faceText of ['😾', '😼', '😿', '😺', '😻', '🐈', 'zzz', 'zzZ']) {
  assert(faceLiterals.has(faceText), `Missing state-driven ${faceText} face literal`);
}

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
  'RearSuspension', 'HeadAngle', 'FaceText', 'MoodColor', 'Purr']) {
  assert(outputs.has(label), `Missing output ${label}`);
}
for (const label of ['Chassis', 'Sensor', 'Petter']) {
  assert(inputs.has(label), `Missing input ${label}`);
}
for (const label of ['FaceText', 'MoodColor']) {
  const pin = outputs.get(label);
  const incoming = one(output.edges.filter(edge => edge.z === pin.brick.key
    && edge.zt === TYPES.microchipOutput && edge.q === 'RER_Input'), `${label} state expression`);
  assert.equal(incoming.at, TYPES.select, `${label} should be state-derived`);
  assert.equal(incoming.p, 'Output');
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
assertOutputDriver(TYPES.text, 'Color', 'MoodColor', 2);
assert.deepEqual(new Set(drivers(TYPES.text, 'Color').map(edge => edge.z)),
  new Set([mood.brick.key, face.brick.key]),
  'Mood color should drive both the square and face displays');

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
assert.equal(shell.g, engine.brick.g, 'Brain shell should be mounted on the chassis');
assert.notEqual(shell.g, face.brick.g, 'Brain shell must not rotate with the head');
assert.deepEqual(shell.data.position, [15, 17, 18], 'Brain shell body position changed');
assert.equal(output.links[0].key, shell.key, 'Brain link must originate at the moved shell');
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
  outputs: 10,
  inputs: 3,
  nativeWheels: 4,
  joints: output.joints.length,
  instantCycles: 0,
  roundTrip: true,
}, null, 2));
