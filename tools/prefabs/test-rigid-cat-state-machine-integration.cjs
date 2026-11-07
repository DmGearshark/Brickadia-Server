'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {brdb: b} = require('./node_modules/brs-js');
const validatePlacement = require('./validate-placement.cjs');
const {assertNoInstantCycles} = require('./loadboard-queue-repair.cjs');

const T = {
  microchip: 'Component_Internal_Microchip',
  input: 'BrickComponentType_Internal_MicrochipInput',
  output: 'BrickComponentType_Internal_MicrochipOutput',
  readGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  engine: 'Component_Internal_WheelEngine',
  bearing: 'Component_Internal_RigidBearing',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  text: 'Component_TextDisplay',
  zone: 'Component_Internal_AttachedZone',
  zoneEntities: 'BrickComponentType_Exec_Zone_GetEntities',
  sweep: 'BrickComponentType_Exec_Sweep',
  interacted: 'BrickComponentType_Event_WholeGridInteracted',
  destroyPrefab: 'BrickComponentType_Exec_Entity_DestroySpawnedPrefab',
  varGet: 'BrickComponentType_Exec_Var_Get',
  select: 'BrickComponentType_Expr_Select',
  playAudioAt: 'Component_WireGraph_PlayAudioAt',
  chatCommand: 'BrickComponentType_Event_ChatCommand',
};

const [outputPath = '/workspace/outputs/Rigid Cat - Random State Machine.brz',
  sourcePath = '/workspace/outputs/Cat - Rigid Head Ignore Fixed.brz'] =
  process.argv.slice(2);

const outputBytes = fs.readFileSync(outputPath);
const sourceBytes = fs.readFileSync(sourcePath);
const output = read(outputBytes);
const source = read(sourceBytes);
const all = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type)
  .map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};

// Every serialized wire names real components and declared ports, and every
// input has exactly one driver.
const byKey = new Map(output.bricks.map(brick => [brick.key, brick]));
const driven = new Set();
for (const edge of output.edges) {
  const sourceBrick = byKey.get(edge.a);
  const targetBrick = byKey.get(edge.z);
  assert(sourceBrick, `Missing wire source ${edge.a}`);
  assert(targetBrick, `Missing wire target ${edge.z}`);
  assert(sourceBrick.comps.some(comp => comp.type === edge.at),
    `Missing ${edge.at} on ${edge.a}`);
  assert(targetBrick.comps.some(comp => comp.type === edge.zt),
    `Missing ${edge.zt} on ${edge.z}`);
  const sourcePorts = b.COMPONENT_WIRE_PORTS.get(edge.at);
  const targetPorts = b.COMPONENT_WIRE_PORTS.get(edge.zt);
  assert(sourcePorts?.outputs.includes(edge.p), `${edge.at}.${edge.p} is not an output`);
  assert(targetPorts?.inputs.includes(edge.q), `${edge.zt}.${edge.q} is not an input`);
  const destination = `${edge.z}|${edge.zt}|${edge.q}`;
  assert(!driven.has(destination), `Duplicate input driver ${destination}`);
  driven.add(destination);
}
assertNoInstantCycles(output);

assert.equal(output.links.length, 1, 'One populated brain link');
const brainLink = output.links[0];
const shell = one(output.bricks.filter(brick => brick.key === brainLink.key), 'brain shell');
assert(shell.comps.some(comp => comp.type === T.microchip));
assert(output.bricks.some(brick => brick.g === brainLink.grid), 'Brain is empty');

const inputs = new Map(all(output, T.input).map(item => [item.comp.data.PortLabel, item]));
const outputs = new Map(all(output, T.output).map(item => [item.comp.data.PortLabel, item]));
assert.deepEqual([...inputs.keys()].sort(), ['Chassis', 'Head', 'Mouth', 'Petter', 'Radar']);
assert.deepEqual([...outputs.keys()].sort(), [
  'Brake', 'CurrentAction', 'Drive', 'FaceColor', 'FaceText', 'HeadAngle', 'Steer',
].sort());
for (const {brick} of [...inputs.values(), ...outputs.values()]) {
  const comp = brick.comps.find(item => item.type === T.input || item.type === T.output);
  const port = comp.type === T.input ? 'RER_Input' : 'RER_Input';
  assert.equal(output.edges.filter(edge => edge.z === brick.key
    && edge.zt === comp.type && edge.q === port).length, 1,
  `Exactly one internal driver for ${comp.data.PortLabel}`);
}

const engine = one(all(output, T.engine), 'wheel engine');
for (const port of ['ManualInput_Drive', 'ManualInput_Steer', 'bManualInput_Brake']) {
  assert.equal(output.edges.filter(edge => edge.z === engine.brick.key
    && edge.zt === T.engine && edge.q === port).length, 1,
  `One engine driver for ${port}`);
}
assert.equal(engine.comp.data.bEnableManualControl, true);

const bearing = one(all(output, T.bearing), 'rigid head bearing');
assert.equal(output.edges.filter(edge => edge.z === bearing.brick.key
  && edge.zt === T.bearing && edge.q === 'TargetAngle').length, 1,
'One rigid-bearing angle driver');
const sourceBearing = one(all(source, T.bearing), 'source rigid bearing');
assert.deepEqual(bearing.brick.data, sourceBearing.brick.data, 'Rigid-bearing brick changed');
assert.deepEqual(bearing.comp.data, sourceBearing.comp.data, 'Rigid-bearing settings changed');

const bearingJoint = one(output.joints.filter(joint => joint.key === bearing.brick.key),
  'rigid head joint');
const headGrid = bearingJoint.entity;
const face = one(all(output, T.text).filter(({brick}) => brick.g === headGrid),
  'head face display');
for (const port of ['Text', 'Color']) {
  assert.equal(output.edges.filter(edge => edge.z === face.brick.key
    && edge.zt === T.text && edge.q === port).length, 1,
  `One face ${port} driver`);
}
assert.equal(face.comp.data.bOverrideColor, true);

// Every requested face literal and color survives WireScript lowering.
const literals = new Set(all(output, T.select).flatMap(({comp}) =>
  [comp.data.InputA, comp.data.InputB]
    .filter(value => value?.$variant === 'str')
    .map(value => value.value)));
for (const text of ['>⩊<', 'o⩊o', '◉⩊◉', '-⩊-', '^⩊^', 'o)⩊(o',
  '(⧫⩊⧫)', '⟐⩊⟐', '♢W♢', '◈W◈']) {
  assert(literals.has(text), `Missing face literal ${text}`);
}
const palette = all(output, T.select).flatMap(({comp}) =>
  [comp.data.InputA, comp.data.InputB]
    .filter(value => value?.$variant === 'LinearColor')
    .map(value => value.value));
const linearChannel = value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const hasColor = rgb => palette.some(color => ['R', 'G', 'B'].every((channel, index) =>
  Math.abs(color[channel] - linearChannel(rgb[index])) < 1e-5));
for (const [label, rgb] of [
  ['Relax green', [80, 220, 100]],
  ['Follow/Petted pink', [255, 105, 180]],
  ['Stalk red', [255, 65, 65]],
  ['Sleep dark blue', [25, 55, 150]],
  ['Sleepy cyan', [45, 225, 235]],
  ['Chase/Hungry yellow', [255, 225, 45]],
  ['Eating orange', [255, 145, 35]],
]) assert(hasColor(rgb), `Missing ${label}`);

// The physical head reader drives the public Head pin, and both player and
// obstacle sweeps ignore that exact entity. This is the self-hit regression.
const headReaders = all(output, T.readGrid).filter(({brick}) => brick.g === headGrid);
const headReader = one(headReaders, 'head-grid reader');
assert.equal(headReader.brick.data.visibility, false);
assert.equal(headReader.brick.data.collision.physics, false);
const headPin = inputs.get('Head');
assert.deepEqual(output.edges.filter(edge => edge.z === headPin.brick.key
  && edge.zt === T.input && edge.q === 'RER_Input'), [{
  a: headReader.brick.key,
  at: T.readGrid,
  p: 'BrickGrid',
  z: headPin.brick.key,
  zt: T.input,
  q: 'RER_Input',
}]);

const sweeps = all(output, T.sweep);
assert.equal(sweeps.length, 2, 'One player and one obstacle sweep');
const playerSweep = one(sweeps.filter(({comp}) => comp.data.Radius === 900
  && comp.data.Distance === 1), 'player sweep');
const obstacleSweep = one(sweeps.filter(({comp}) => comp.data.Radius === 5
  && comp.data.Distance === 65), 'wall sweep');
for (const sweep of sweeps) {
  assert.equal(output.edges.filter(edge => edge.z === sweep.brick.key
    && edge.zt === T.sweep && edge.q === 'IgnoreEntity'
    && edge.a === headPin.brick.key && edge.at === T.input
    && edge.p === 'RER_Output').length, 1,
  'Sweep does not ignore the public Head entity');
  assert.equal(sweep.comp.data.bIgnoreOwningGrid, true);
}
assert.equal(playerSweep.comp.data.bDetectBricks, false);
assert.equal(playerSweep.comp.data.bDetectPhysics, false);
assert.equal(playerSweep.comp.data.bDetectMap, false);
assert.equal(playerSweep.comp.data.bDetectPlayers1, true);
assert.equal(playerSweep.comp.data.bDetectPlayers2, true);
assert.equal(playerSweep.comp.data.bDetectPlayers3, true);
assert.equal(playerSweep.comp.data.bDetectPlayers4, true);
assert.equal(obstacleSweep.comp.data.bDetectBricks, true);
assert.equal(obstacleSweep.comp.data.bDetectPhysics, true);
assert.equal(obstacleSweep.comp.data.bDetectMap, true);
assert.equal(obstacleSweep.comp.data.bDetectPlayers1, false);

// Radar and mouth are distinct hidden entity zones wired to their named pins.
const zones = all(output, T.zone);
assert.equal(zones.length, 2, 'Radar and mouth zones');
function zoneFor(label) {
  const pin = inputs.get(label);
  const edge = one(output.edges.filter(item => item.z === pin.brick.key
    && item.zt === T.input && item.q === 'RER_Input'
    && item.at === T.zone && item.p === 'ZoneRef'), `${label} zone wire`);
  return one(zones.filter(({brick}) => brick.key === edge.a), `${label} zone`);
}
const radar = zoneFor('Radar');
const mouth = zoneFor('Mouth');
for (const zone of [radar, mouth]) {
  assert.equal(zone.brick.data.visibility, false);
  assert.equal(zone.brick.data.collision.physics, false);
  assert.equal(zone.comp.data.bDetectEntities, true);
  assert.equal(zone.comp.data.bDetectPlayers, false);
}
assert.equal(radar.comp.data.ZoneEndDistance, 900);
assert.deepEqual(radar.brick.data.size, [60, 120, 2]);
assert.equal(mouth.comp.data.ZoneEndDistance, 30);
assert.deepEqual(mouth.brick.data.size, [20, 20, 2]);

const queries = all(output, T.zoneEntities);
const observedTags = queries.map(({comp}) => comp.data.TagFilter);
assert.deepEqual([...observedTags].sort(), [
  'Cat Food 1', 'Cat Food 1', 'Cat Toy 1', 'Cat Toy 2', 'Cat Toy 3',
].sort(), 'Exact case-sensitive food/toy tags');
function queryZoneSource(query) {
  return one(output.edges.filter(edge => edge.z === query.brick.key
    && edge.zt === T.zoneEntities && edge.q === 'Zone'), 'zone-query source').a;
}
const foodQueries = queries.filter(({comp}) => comp.data.TagFilter === 'Cat Food 1');
assert.equal(foodQueries.length, 2);
assert.equal(foodQueries.filter(query => queryZoneSource(query) === inputs.get('Radar').brick.key).length, 1,
  'One radar food query');
assert.equal(foodQueries.filter(query => queryZoneSource(query) === inputs.get('Mouth').brick.key).length, 1,
  'One mouth food query');
for (const query of queries.filter(({comp}) => /^Cat Toy /.test(comp.data.TagFilter))) {
  assert.equal(queryZoneSource(query), inputs.get('Radar').brick.key,
    `${query.comp.data.TagFilter} must use Radar`);
}

const petEvent = one(all(output, T.interacted), 'pet interaction event');
assert.equal(petEvent.comp.data.PromptCustomLabel, 'Pet Cat');
assert.equal(petEvent.comp.data.bAllowNearbyInteraction, true);
assert.equal(petEvent.comp.data.bHiddenInteraction, false);
assert.equal(output.edges.filter(edge => edge.a === petEvent.brick.key
  && edge.at === T.interacted && edge.p === 'bHeld').length > 0, true,
'Petting held signal is unused');
assert.equal(output.edges.filter(edge => edge.a === petEvent.brick.key
  && edge.at === T.interacted && edge.p === 'Character'
  && edge.z === inputs.get('Petter').brick.key && edge.zt === T.input
  && edge.q === 'RER_Input').length, 1, 'Petter input wiring');
assert.equal(all(output, T.playAudioAt).length, 1, 'One pet sound action');

const chatCommand = one(all(output, T.chatCommand), '/cat chat command');
assert.deepEqual(chatCommand.comp.data, {
  CommandName: 'cat',
  HelpText: 'Call a nearby cat',
});
assert.equal(output.edges.filter(edge => edge.a === chatCommand.brick.key
  && edge.at === T.chatCommand && edge.p === 'ExecOut').length, 1,
'The /cat event has one execution path');

const destroy = one(all(output, T.destroyPrefab), 'food prefab deletion action');
assert.equal(output.edges.filter(edge => edge.z === destroy.brick.key
  && edge.zt === T.destroyPrefab && edge.q === 'Exec').length, 1);
const destroyEntity = one(output.edges.filter(edge => edge.z === destroy.brick.key
  && edge.zt === T.destroyPrefab && edge.q === 'Entity'), 'food delete entity');
assert.equal(destroyEntity.at, T.varGet);
assert.equal(destroyEntity.p, 'Value');

// Preserve native wheels and every physical joint transform from the supplied
// rigid-bearing frame.
function wheels(scene) {
  return [...scene.r.entities()].filter(entity => /^Entity_Wheel_/.test(entity.typeName))
    .map(entity => ({
      typeName: entity.typeName,
      location: entity.location,
      rotation: entity.rotation,
      data: entity.data,
      colors: entity.colors,
      frozen: entity.frozen,
      sleeping: entity.sleeping,
      linearVelocity: entity.linearVelocity,
      angularVelocity: entity.angularVelocity,
    })).sort((a, z) => JSON.stringify(a.location).localeCompare(JSON.stringify(z.location)));
}
assert.equal(wheels(output).length, 4);
assert.deepEqual(wheels(output), wheels(source), 'Native wheel records changed');
assert.equal(output.joints.length, source.joints.length, 'Joint count changed');
const jointTransforms = scene => scene.joints.map(joint => ({
  offset: joint.offset,
  rotation: joint.rotation,
})).sort((a, z) => JSON.stringify(a).localeCompare(JSON.stringify(z)));
assert.deepEqual(jointTransforms(output), jointTransforms(source), 'Joint transforms changed');
assert.equal(all(output, T.suspension).length, 4);

const placement = validatePlacement(outputBytes);
assert.equal(placement.strictOk, true, JSON.stringify(placement));
assert.equal(placement.invalidBricks.length, 0);
assert.equal(placement.confirmedPairs.length, 0);
assert.equal(placement.uncertainPairs.length, 0);
assert.equal(placement.warnings.length, 0, JSON.stringify(placement.warnings));

console.log(JSON.stringify({
  integration: 'passed',
  output: outputPath,
  bricks: output.bricks.length,
  wires: output.edges.length,
  brainGates: output.bricks.filter(brick => brick.g === brainLink.grid).length,
  faces: 10,
  colors: 7,
  tags: observedTags,
  sweeps: sweeps.length,
  zones: zones.length,
  wheels: wheels(output).length,
  joints: output.joints.length,
  chatCommands: 1,
  placementWarnings: placement.warnings.length,
}, null, 2));
