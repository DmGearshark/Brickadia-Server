'use strict';

// Structural validator for the full autonomous-cat build.  This deliberately
// compares the finished prefab with its frame donor instead of relying on
// serialized grid/entity ids: reskin-loadboard remaps those ids while keeping
// the physical graph and native wheel records intact.

const fs = require('fs');
const assert = require('assert/strict');
const {brdb: b} = require('./node_modules/brs-js');
const {read, write} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {assertNoInstantCycles} = require('./loadboard-queue-repair.cjs');

const T = {
  microchip: 'Component_Internal_Microchip',
  input: 'BrickComponentType_Internal_MicrochipInput',
  output: 'BrickComponentType_Internal_MicrochipOutput',
  readGrid: 'BrickComponentType_Internal_ReadBrickGrid',
  engine: 'Component_Internal_WheelEngine',
  servo: 'Component_Internal_Servo',
  suspension: 'Component_Internal_Joint_Wheel_Suspension',
  text: 'Component_TextDisplay',
  zone: 'Component_Internal_AttachedZone',
  audio: 'Component_AudioEmitter',
  audioReference: 'BrickComponentType_AudioReference',
  interacted: 'BrickComponentType_Event_WholeGridInteracted',
  zoneEntities: 'BrickComponentType_Exec_Zone_GetEntities',
};

const [outputPath, donorPath] = process.argv.slice(2);
if (!outputPath || !donorPath) {
  throw new Error('Usage: node validate-full-cat-output.cjs output.brz donor-frame.brz');
}

const outputBytes = fs.readFileSync(outputPath);
const donorBytes = fs.readFileSync(donorPath);
const output = read(outputBytes);
const donor = read(donorBytes);

const all = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type).map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};
const comp = (brick, type) => brick.comps.find(item => item.type === type);
const canonical = value => JSON.parse(JSON.stringify(value));

// Every serialized wire must refer to a real component and a declared port.
// No component input may have two drivers, a frequent source of silently
// invalid prefabs in Brickadia.
const byKey = new Map(output.bricks.map(brick => [brick.key, brick]));
const driven = new Set();
for (const edge of output.edges) {
  const source = byKey.get(edge.a);
  const target = byKey.get(edge.z);
  assert(source, `Missing wire source ${edge.a}`);
  assert(target, `Missing wire target ${edge.z}`);
  assert(source.comps.some(item => item.type === edge.at),
    `Wire source ${edge.a} lacks ${edge.at}`);
  assert(target.comps.some(item => item.type === edge.zt),
    `Wire target ${edge.z} lacks ${edge.zt}`);
  const sourcePorts = b.COMPONENT_WIRE_PORTS.get(edge.at);
  const targetPorts = b.COMPONENT_WIRE_PORTS.get(edge.zt);
  assert(sourcePorts?.outputs.includes(edge.p), `${edge.at}.${edge.p} is not an output`);
  assert(targetPorts?.inputs.includes(edge.q), `${edge.zt}.${edge.q} is not an input`);
  const destination = `${edge.z}|${edge.zt}|${edge.q}`;
  assert(!driven.has(destination), `Duplicate input driver ${destination}`);
  driven.add(destination);
}
assertNoInstantCycles(output);

// Locate the physical hierarchy semantically in each file.
function hardware(scene, label) {
  const engine = one(all(scene, T.engine), `${label} wheel engine`);
  const servo = one(all(scene, T.servo), `${label} neck servo`);
  const chassis = engine.brick.g;
  assert.equal(servo.brick.g, chassis, `${label} servo must remain on chassis`);
  const neckJoint = one(scene.joints.filter(joint => joint.key === servo.brick.key),
    `${label} neck joint`);
  const head = neckJoint.entity;
  const shell = one(scene.bricks.filter(brick => brick.g === chassis
    && comp(brick, T.microchip) && scene.links.some(link => link.key === brick.key)),
  `${label} brain shell`);
  const link = one(scene.links.filter(item => item.key === shell.key), `${label} brain link`);
  const wheels = all(scene, T.suspension).filter(({brick}) => brick.g === chassis);
  assert.equal(wheels.length, 4, `${label} four suspension wheels`);
  return {engine, servo, chassis, neckJoint, head, shell, link, wheels};
}
const outHw = hardware(output, 'output');
const donorHw = hardware(donor, 'donor');

// A @flat WireScript brain has one shell link and one populated logic grid;
// it must not add nested chip grids or physical grids.
assert.equal(output.links.length, 1, 'Exactly one flat brain link');
assert(output.bricks.some(brick => brick.g === outHw.link.grid), 'Brain grid is empty');
assert.equal(new Set(output.bricks.map(brick => brick.g)).size, 3,
  'Expected chassis, head, and one flat brain grid');
assert.equal(output.bricks.filter(brick => brick.g === outHw.link.grid
  && comp(brick, T.microchip)).length, 0, 'No nested microchip shell inside brain');
assert.deepEqual(outHw.shell.data.position, donorHw.shell.data.position,
  'Brain shell moved on the body');

// The joint graph is compared by the physical joint brick's local asset and
// position.  Persistent ids are intentionally excluded because the writer
// remaps them on a clean serialization.
function jointSnapshot(scene) {
  return scene.joints.map(joint => {
    const brick = one(scene.bricks.filter(item => item.key === joint.key), 'joint brick');
    const entity = [...scene.r.entities()].find(item => item.persistentIndex === joint.entity);
    assert(entity, `Missing joint entity ${joint.entity}`);
    return {
      asset: brick.data.asset,
      position: brick.data.position,
      size: brick.data.size,
      direction: brick.data.direction,
      rotation: brick.data.rotation,
      offset: joint.offset,
      jointRotation: joint.rotation,
      entityType: entity.typeName,
    };
  }).sort((a, z) => JSON.stringify(a.position).localeCompare(JSON.stringify(z.position)));
}
assert.deepEqual(jointSnapshot(output), jointSnapshot(donor),
  'Wheel/head joint transforms or entity types changed');

function nativeWheelSnapshot(scene) {
  return [...scene.r.entities()].filter(entity => /^Entity_Wheel_/.test(entity.typeName))
    .map(entity => ({
      typeName: entity.typeName,
      location: entity.location,
      rotation: entity.rotation,
      frozen: entity.frozen,
      sleeping: entity.sleeping,
      linearVelocity: entity.linearVelocity,
      angularVelocity: entity.angularVelocity,
      colors: entity.colors,
      data: entity.data,
    })).sort((a, z) => JSON.stringify(a.location).localeCompare(JSON.stringify(z.location)));
}
assert.equal(nativeWheelSnapshot(output).length, 4, 'Four native wheel entities survive');
assert.deepEqual(nativeWheelSnapshot(output), nativeWheelSnapshot(donor),
  'Native wheel scale/friction/transform records changed');

// Existing engine-to-wheel control fanout remains intact.
const engineFanout = output.edges.filter(edge => edge.a === outHw.engine.brick.key
  && edge.at === T.engine && edge.p === 'Control_DriveAndSteer'
  && edge.zt === T.suspension && edge.q === 'Control_DriveAndSteer');
assert.equal(engineFanout.length, 4, 'Engine control must reach all four wheels');
assert.deepEqual(new Set(engineFanout.map(edge => edge.z)),
  new Set(outHw.wheels.map(item => item.brick.key)), 'Engine wheel fanout changed');

// Public brain interface.  Extra diagnostic/audio pins are allowed, while
// every operational pin must be unique.
function pins(type) {
  const result = new Map();
  for (const item of all(output, type)) {
    const label = item.comp.data.PortLabel;
    assert(!result.has(label), `Duplicate public pin ${label}`);
    result.set(label, item);
  }
  return result;
}
const inputs = pins(T.input);
const outputs = pins(T.output);
for (const label of ['Chassis', 'Head', 'Radar', 'Mouth', 'Petter', 'CurrentSpeed',
  'EngineStalling', 'HeadCurrentAngle']) assert(inputs.has(label), `Missing input ${label}`);
for (const label of ['Drive', 'Steer', 'Brake', 'DriveSpeed', 'FrontSuspension',
  'RearSuspension', 'HeadAngle', 'FaceText', 'StateText', 'MoodColor', 'Purr',
  'PurrAudio']) assert(outputs.has(label), `Missing output ${label}`);
for (const pin of [...inputs.values(), ...outputs.values()]) {
  assert.equal(output.edges.filter(edge => edge.z === pin.brick.key
    && edge.zt === pin.comp.type && edge.q === 'RER_Input').length, 1,
  `Exactly one value must feed ${pin.comp.data.PortLabel}`);
}

const inputSource = label => one(output.edges.filter(edge =>
  edge.z === inputs.get(label).brick.key && edge.zt === T.input && edge.q === 'RER_Input'),
`${label} physical input`);
const outputTargets = (label, targetType, targetPort) => output.edges.filter(edge =>
  edge.a === outputs.get(label).brick.key && edge.at === T.output && edge.p === 'RER_Output'
  && edge.zt === targetType && edge.q === targetPort);
const assertOneOutputTarget = (label, targetType, targetPort, targetKey) => {
  const edges = outputTargets(label, targetType, targetPort);
  assert.equal(edges.length, 1, `${label} target count`);
  if (targetKey) assert.equal(edges[0].z, targetKey, `${label} target brick`);
  return edges[0];
};

const chassisReader = one(all(output, T.readGrid)
  .filter(({brick}) => brick.g === outHw.chassis), 'chassis reader');
const headReader = one(all(output, T.readGrid)
  .filter(({brick}) => brick.g === outHw.head), 'head reader');
for (const [label, source, type, port] of [
  ['Chassis', chassisReader, T.readGrid, 'BrickGrid'],
  ['Head', headReader, T.readGrid, 'BrickGrid'],
  ['CurrentSpeed', outHw.engine, T.engine, 'Speed'],
  ['EngineStalling', outHw.engine, T.engine, 'bStalling'],
  ['HeadCurrentAngle', outHw.servo, T.servo, 'CurrentAngle'],
]) {
  const edge = inputSource(label);
  assert.deepEqual({a: edge.a, at: edge.at, p: edge.p},
    {a: source.brick.key, at: type, p: port}, `${label} source`);
}

const interaction = one(all(output, T.interacted), 'Pet Cat interaction');
assert.equal(interaction.comp.data.PromptCustomLabel, 'Pet Cat');
assert.equal(interaction.comp.data.bAllowNearbyInteraction, true);
assert.equal(interaction.comp.data.bHiddenInteraction, false);
assert.deepEqual(((edge) => ({a: edge.a, at: edge.at, p: edge.p}))(inputSource('Petter')),
  {a: interaction.brick.key, at: T.interacted, p: 'Character'}, 'Petter source');

const donorRadar = one(all(donor, T.zone).filter(({brick}) => brick.g === donorHw.chassis),
  'donor radar');
const donorMouth = one(all(donor, T.zone).filter(({brick}) => brick.g === donorHw.head),
  'donor mouth');
const radar = one(all(output, T.zone).filter(({brick}) => brick.g === outHw.chassis),
  'chassis radar');
const mouth = one(all(output, T.zone).filter(({brick}) => brick.g === outHw.head),
  'head mouth');
for (const [label, zone] of [['Radar', radar], ['Mouth', mouth]]) {
  assert.deepEqual(((edge) => ({a: edge.a, at: edge.at, p: edge.p}))(inputSource(label)),
    {a: zone.brick.key, at: T.zone, p: 'ZoneRef'}, `${label} zone source`);
  assert.equal(zone.comp.data.bDetectEntities, true, `${label} entity sensing`);
}
assert.deepEqual(radar.brick.data.position, donorRadar.brick.data.position,
  'Radar moved from donor mounting point');
assert.equal(radar.comp.data.ZoneEndDistance, 900, 'Radar range');
assert.equal(radar.comp.data.bDetectPlayers, true, 'Radar detects players');
assert.equal(radar.comp.data.bDetectPlayers1, true, 'Radar detects player channel 1');
assert.equal(radar.comp.data.TagFilter, '', 'Radar accepts all requested tags');
assert.deepEqual(mouth.brick.data.position, donorMouth.brick.data.position,
  'Mouth moved from donor mounting point');
assert(mouth.comp.data.ZoneEndDistance >= 25 && mouth.comp.data.ZoneEndDistance <= 40,
  'Mouth range should stay local');
assert.equal(mouth.comp.data.bDetectPlayers, false, 'Mouth does not consume players');
assert.equal(mouth.comp.data.bDetectPlayers1, false, 'Mouth does not consume player channel 1');

assert.equal(outHw.engine.comp.data.bEnableManualControl, true, 'Manual engine control enabled');
assert.equal(outHw.engine.comp.data.bTankSteering, false, 'Ordinary steering enabled');
for (const [label, port] of [['Drive', 'ManualInput_Drive'], ['Steer', 'ManualInput_Steer'],
  ['Brake', 'bManualInput_Brake'], ['DriveSpeed', 'DriveSpeed']]) {
  assertOneOutputTarget(label, T.engine, port, outHw.engine.brick.key);
}
assertOneOutputTarget('HeadAngle', T.servo, 'TargetAngle', outHw.servo.brick.key);

const frontWheels = outHw.wheels.filter(({brick}) => brick.data.position[0] < 0);
const rearWheels = outHw.wheels.filter(({brick}) => brick.data.position[0] > 0);
assert.equal(frontWheels.length, 2, 'Two front wheels');
assert.equal(rearWheels.length, 2, 'Two rear wheels');
assert(frontWheels.every(({comp: wheel}) => wheel.data.bSteerEnabled),
  'Both front wheels steer');
assert(rearWheels.every(({comp: wheel}) => !wheel.data.bSteerEnabled),
  'Rear wheels do not steer');
assert.deepEqual(new Set(outputTargets('FrontSuspension', T.suspension, 'SuspensionStiffness')
  .map(edge => edge.z)), new Set(frontWheels.map(({brick}) => brick.key)),
'Front suspension output fanout');
assert.deepEqual(new Set(outputTargets('RearSuspension', T.suspension, 'SuspensionStiffness')
  .map(edge => edge.z)), new Set(rearWheels.map(({brick}) => brick.key)),
'Rear suspension output fanout');

// Match head displays by the donor positions, which remain stable even though
// their runtime Text and Color inputs are now controlled by the brain.
const donorHeadDisplays = all(donor, T.text).filter(({brick}) => brick.g === donorHw.head);
const outputHeadDisplays = all(output, T.text).filter(({brick}) => brick.g === outHw.head);
assert.equal(donorHeadDisplays.length, 3, 'Donor face, state, and color square');
assert.equal(outputHeadDisplays.length, 3, 'Output face, state, and color square');
const displayAtDonorText = text => {
  const source = one(donorHeadDisplays.filter(({comp: display}) => display.data.Text === text),
    `donor display ${text}`);
  return one(outputHeadDisplays.filter(({brick}) =>
    JSON.stringify(brick.data.position) === JSON.stringify(source.brick.data.position)),
  `output display at ${text}`);
};
const face = displayAtDonorText('Face Text Display');
const state = displayAtDonorText('Mood Display');
const square = displayAtDonorText('■');
assertOneOutputTarget('FaceText', T.text, 'Text', face.brick.key);
assertOneOutputTarget('StateText', T.text, 'Text', state.brick.key);
const colorTargets = outputTargets('MoodColor', T.text, 'Color');
assert.equal(colorTargets.length, 3, 'Mood color drives all three head displays');
assert.deepEqual(new Set(colorTargets.map(edge => edge.z)),
  new Set([face.brick.key, state.brick.key, square.brick.key]), 'Mood color display fanout');
assert([face, state, square].every(({comp: display}) => display.data.bOverrideColor),
  'Every head display accepts the mood color override');

// The purr sound is a real, user-editable continuous Audio Reference gate.
const speaker = one(all(output, T.audio), 'continuous purr speaker');
assertOneOutputTarget('Purr', T.audio, 'bEnabled', speaker.brick.key);
assertOneOutputTarget('PurrAudio', T.audio, 'AudioDescriptor', speaker.brick.key);
const purrReferences = all(output, T.audioReference).filter(({brick}) =>
  brick.g === outHw.link.grid);
assert.equal(purrReferences.length, 1, 'One editable purring Audio Reference constant');
const purrReference = purrReferences[0];
const purrAsset = output.r.externalAssets()[purrReference.comp.data.Asset];
assert.deepEqual(purrAsset, {type: 'BrickAudioDescriptor', name: 'BA_Thumpy_Machine'},
  'Purr constant uses the documented editable placeholder');
const purrValue = one(output.edges.filter(edge => edge.a === purrReference.brick.key
  && edge.at === T.audioReference && edge.p === 'Value'
  && edge.z === outputs.get('PurrAudio').brick.key && edge.zt === T.output
  && edge.q === 'RER_Input'), 'PurrAudio constant connection');
assert(purrValue, 'Purring Audio Reference feeds its output pin');

// Exact case-sensitive world tags requested by the user must be represented
// in the compiled zone queries. Legacy lower-case treat aliases are allowed.
const tags = new Set(all(output, T.zoneEntities).map(({comp: query}) => query.data.TagFilter));
for (const tag of ['Cat Food 1', 'Kitty Treat 1', 'Kitty Treat 2', 'Kitty Treat 3',
  'Cat Toy 1', 'Cat Toy 2', 'Cat Toy 3', 'Cat Bed 1']) {
  assert(tags.has(tag), `Missing exact detector tag ${tag}`);
}

// Preserve current-game metadata and schemas. This is the placement-preview
// regression that a raw brs-js rewrite used to break.
const outBundle = output.r.bundle();
const donorBundle = donor.r.bundle();
assert.equal(outBundle.gameVersion, donorBundle.gameVersion, 'Donor game version retained');
assert.match(outBundle.gameVersion, /^CL\d+$/, 'Current Brickadia CL metadata');
assert.deepEqual(outBundle.authors, donorBundle.authors, 'Donor authors retained');
assert.equal(outputBytes[4], donorBytes[4], 'Archive-index compression method retained');
assert.equal(outputBytes[4], 1, 'Current compressed archive index');
const schemaPaths = donor.r.fs.listPaths().filter(path => path.endsWith('.schema'));
assert(schemaPaths.length > 0, 'Donor has current schemas');
for (const schemaPath of schemaPaths) {
  // Component/entity schemas are regenerated to describe the expanded world
  // and therefore need not be byte-identical to the sparse donor's schemas.
  // Successful WorldReader parsing plus the complete schema path set is the
  // compatibility check; the current game CL itself comes from the donor.
  assert(output.r.fs.listPaths().includes(schemaPath), `Missing world schema ${schemaPath}`);
  assert(output.r.fs.readFile(schemaPath).length > 0, `Empty world schema ${schemaPath}`);
}

// Placement and a clean structural round trip finish the verification.
const placement = validatePlacement(outputBytes);
assert.equal(placement.strictOk, true, JSON.stringify(placement));
assert.equal(placement.invalidBricks.length, 0, 'No invalid bricks');
assert.equal(placement.confirmedPairs.length, 0, 'No confirmed brick overlaps');
assert.equal(placement.uncertainPairs.length, 0, 'No uncertain brick overlaps');

const embedded = output.r.prefabPaths().map(path => output.r.readPrefab(path));
const rebuiltBytes = write(output, {
  assets: output.r.externalAssets(),
  prefab: output.r.prefabJson(),
  embedded,
  name: outBundle.name,
  description: outBundle.description,
}).bytes;
const reopened = read(rebuiltBytes);
assert.equal(reopened.bricks.length, output.bricks.length, 'Round-trip brick count');
assert.equal(reopened.edges.length, output.edges.length, 'Round-trip wire count');
assert.equal(reopened.links.length, output.links.length, 'Round-trip link count');
assert.equal(reopened.joints.length, output.joints.length, 'Round-trip joint count');
assert.equal(nativeWheelSnapshot(reopened).length, 4, 'Round-trip native wheels');

console.log(JSON.stringify({
  output: outputPath,
  donor: donorPath,
  gameVersion: outBundle.gameVersion,
  archiveIndexCompression: outputBytes[4],
  strictPlacement: true,
  bricks: output.bricks.length,
  wires: output.edges.length,
  brainGates: output.bricks.filter(brick => brick.g === outHw.link.grid).length,
  joints: output.joints.length,
  nativeWheels: nativeWheelSnapshot(output).length,
  inputs: inputs.size,
  outputs: outputs.size,
  instantCycles: 0,
  roundTrip: true,
}, null, 2));
