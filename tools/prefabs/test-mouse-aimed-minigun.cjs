'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {brdb} = require('brs-js');
const build = require('./build-mouse-aimed-minigun.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {C} = require('./loadboard-lib.cjs');

if (!process.argv[2]) {
  throw new Error('Usage: node test-mouse-aimed-minigun.cjs input-wasd-minigun.brz');
}
const INPUT = path.resolve(process.argv[2]);

function one(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}

function value(saved) {
  return saved && typeof saved === 'object' && '$variant' in saved ? saved.value : saved;
}

function componentRows(scene, type, grid) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(saved => saved.type === type && (grid == null || brick.g === grid))
    .map(saved => ({brick, saved, node: {key: brick.key, type, brick}})));
}

function incoming(scene, node, port) {
  return scene.edges.filter(edge => edge.z === node.key && edge.zt === node.type
    && (!port || edge.q === port));
}

function outgoing(scene, node, port) {
  return scene.edges.filter(edge => edge.a === node.key && edge.at === node.type
    && (!port || edge.p === port));
}

function sourceNode(scene, edge) {
  const brick = one(scene.bricks.filter(candidate => candidate.key === edge.a),
    `source brick ${edge.a}`);
  assert(brick.comps.some(saved => saved.type === edge.at), `source component ${edge.at}`);
  return {key: brick.key, type: edge.at, brick};
}

function targetNode(scene, edge) {
  const brick = one(scene.bricks.filter(candidate => candidate.key === edge.z),
    `target brick ${edge.z}`);
  assert(brick.comps.some(saved => saved.type === edge.zt), `target component ${edge.zt}`);
  return {key: brick.key, type: edge.zt, brick};
}

function inputSource(scene, node, port, label = `${node.type}.${port}`) {
  return sourceNode(scene, one(incoming(scene, node, port), label));
}

function savedComponent(node) {
  return one(node.brick.comps.filter(saved => saved.type === node.type), node.type);
}

function normalizedComponents(scene, type) {
  return componentRows(scene, type).map(row => JSON.stringify(row.saved.data)).sort();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function checkPortAndDriverIntegrity(scene) {
  const targets = new Set();
  for (const edge of scene.edges) {
    const source = Object.values(C).find(definition => definition.NAME === edge.at);
    const target = Object.values(C).find(definition => definition.NAME === edge.zt);
    assert(source?.PORTS[edge.p], `Unknown source port ${edge.at}.${edge.p}`);
    assert(target?.PORTS[edge.q], `Unknown target port ${edge.zt}.${edge.q}`);
    const key = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(key), `Duplicate driver ${key}`);
    targets.add(key);
  }
}

function run() {
  const first = build(INPUT);
  const second = build(INPUT);
  assert.equal(sha256(first.bytes), sha256(second.bytes), 'Build must be deterministic');
  assert.equal(first.bytes.length, second.bytes.length);

  const donor = read(fs.readFileSync(INPUT));
  const scene = read(first.bytes);
  const placement = validatePlacement(first.bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  checkPortAndDriverIntegrity(scene);

  assert.equal(scene.bricks.length, donor.bricks.length + 1,
    '21 obsolete gates replaced by 21 aim gates plus one physical grid reader');
  assert.equal(scene.links.length, donor.links.length, 'Microchip links preserved');
  assert.equal(scene.joints.length, donor.joints.length, 'All physical joints preserved');
  assert.equal(scene.joints.length, 3, 'Yaw, pitch and barrel-spin joints retained');

  // At the pre-serialization graph level, every donor brick and wire outside
  // the removed WASD controller must be exactly untouched. This is stricter
  // than component counts and protects the complete firing/barrel subsystem.
  const originalSplitter = one(componentRows(first.original, C.InputSplitter.NAME),
    'original input splitter');
  const originalAimKeys = new Set(first.original.bricks
    .filter(brick => brick.g === originalSplitter.brick.g).map(brick => brick.key));
  const generatedKeys = new Set(first.scene.bricks.map(brick => brick.key));
  const removedKeys = new Set([...originalAimKeys].filter(key => !generatedKeys.has(key)));
  assert.equal(removedKeys.size, 21, 'Only the known WASD controller is removed');
  const generatedByKey = new Map(first.scene.bricks.map(brick => [brick.key, brick]));
  for (const brick of first.original.bricks) {
    if (removedKeys.has(brick.key)) continue;
    assert.deepEqual(generatedByKey.get(brick.key), brick,
      `Existing brick/component changed unexpectedly: ${brick.key}`);
  }
  const generatedEdgeKeys = new Set(first.scene.edges.map(edge => JSON.stringify(edge)));
  for (const edge of first.original.edges) {
    if (removedKeys.has(edge.a) || removedKeys.has(edge.z)) continue;
    assert(generatedEdgeKeys.has(JSON.stringify(edge)),
      `Existing wire changed unexpectedly: ${JSON.stringify(edge)}`);
  }

  const aim = one(componentRows(scene, C.Exec_Character_GetAim.NAME), 'Get Character Aim');
  const grid = aim.brick.g;
  const splitter = one(componentRows(scene, C.InputSplitter.NAME, grid), 'seat input splitter');
  const seat = one(componentRows(scene, C.Seat.NAME), 'gunner seat');
  const clock = one(componentRows(scene, C.Clock.NAME, grid), 'seat-gated aim clock');
  const pose = one(componentRows(scene, C.Exec_Entity_GetLocationRotation.NAME, grid),
    'gun-grid pose query');
  const buffer = one(componentRows(scene, C.BufferTicks.NAME, grid), 'settling buffer');
  const occupiedBranch = one(componentRows(scene, C.Exec_Branch.NAME, grid),
    'post-buffer occupied branch');
  const convert = one(componentRows(scene, C.Expr_Convert.NAME, grid), 'Rotator to Quat conversion');
  const inverse = one(componentRows(scene, C.Expr_InvertRotation.NAME, grid), 'inverse gun rotation');
  const rotate = one(componentRows(scene, C.Expr_RotateVector.NAME, grid), 'world aim to local aim');
  const splitVector = one(componentRows(scene, C.Expr_SplitVector.NAME, grid), 'local aim split');
  const makeVector = one(componentRows(scene, C.Expr_MakeVector.NAME, grid), 'axis remap');
  const direction = one(componentRows(scene, C.Expr_DirectionToRotation.NAME, grid),
    'local aim direction rotation');
  const splitRotation = one(componentRows(scene, C.Expr_SplitRotation.NAME, grid),
    'local aim angles');
  const gridReader = one(componentRows(scene, C.ReadBrickGrid.NAME), 'moving gun-grid reader');

  assert.notEqual(gridReader.brick.g, grid, 'Grid reader is physically on the moving gun grid');
  assert.equal(gridReader.brick.g, seat.brick.g, 'Grid reader follows the seated gun assembly');
  assert.equal(inputSource(scene, clock.node, 'bEnabled').key, seat.brick.key,
    'Aim loop only runs while the seat is occupied');
  assert.equal(one(incoming(scene, clock.node, 'bEnabled')).p, 'bIsOccupied');
  assert.equal(inputSource(scene, aim.node, 'Character').key, seat.brick.key,
    'Aim query uses the character sitting in this seat');
  assert.equal(one(incoming(scene, aim.node, 'Character')).p, 'SittingCharacter');
  assert.equal(inputSource(scene, pose.node, 'Exec').key, clock.brick.key);
  assert.equal(inputSource(scene, pose.node, 'Entity').key, gridReader.brick.key);
  assert.equal(inputSource(scene, aim.node, 'Exec').key, pose.brick.key);
  assert.equal(inputSource(scene, buffer.node, 'Input').key, aim.brick.key);
  assert.equal(inputSource(scene, occupiedBranch.node, 'Exec').key, buffer.brick.key);
  assert.equal(inputSource(scene, occupiedBranch.node, 'bCond').key, seat.brick.key,
    'Buffered writes are cancelled if the player leaves the seat');
  assert.equal(one(incoming(scene, occupiedBranch.node, 'bCond')).p, 'bIsOccupied');
  assert.equal(value(savedComponent(clock.node).data.IntervalSeconds), 0.025);
  assert.equal(value(savedComponent(buffer.node).data.TicksToWait), 1);
  assert.equal(savedComponent(aim.node).data.bLocalAim, false,
    'Get Aim must report a world-space camera direction');

  assert.equal(inputSource(scene, convert.node, 'Input').key, pose.brick.key);
  assert.equal(savedComponent(convert.node).data.TargetType.$variant, 'Quat');
  assert.equal(inputSource(scene, inverse.node, 'Input').key, convert.brick.key);
  assert.equal(inputSource(scene, rotate.node, 'Rotation').key, inverse.brick.key);
  assert.equal(inputSource(scene, rotate.node, 'Vector').key, aim.brick.key);
  assert.equal(inputSource(scene, splitVector.node, 'Input').key, rotate.brick.key);
  const remapX = one(incoming(scene, makeVector.node, 'X'), 'remapped forward axis');
  const remapY = one(incoming(scene, makeVector.node, 'Y'), 'remapped right axis');
  const remapZ = one(incoming(scene, makeVector.node, 'Z'), 'remapped up axis');
  assert.equal(remapX.a, splitVector.brick.key); assert.equal(remapX.p, 'Y');
  assert.equal(remapY.a, splitVector.brick.key); assert.equal(remapY.p, 'Z');
  assert.equal(remapZ.a, splitVector.brick.key); assert.equal(remapZ.p, 'X');
  assert.equal(inputSource(scene, direction.node, 'Direction').key, makeVector.brick.key);
  assert.equal(inputSource(scene, splitRotation.node, 'Input').key, direction.brick.key);

  const clamps = componentRows(scene, C.Expr_MathClamp.NAME, grid);
  const yawClamp = one(clamps.filter(row => value(row.saved.data.Min) === -90
    && value(row.saved.data.Max) === 90), 'yaw clamp');
  const pitchClamp = one(clamps.filter(row => value(row.saved.data.Min) === -25
    && value(row.saved.data.Max) === 45), 'pitch clamp');
  const yawTarget = inputSource(scene, yawClamp.node, 'Input');
  const pitchTarget = inputSource(scene, pitchClamp.node, 'Input');
  assert.equal(yawTarget.type, C.Expr_MathSubtract.NAME, 'Yaw bearing orientation is inverted');
  assert.equal(pitchTarget.type, C.Expr_MathAdd.NAME, 'Positive pitch raises the barrels');

  const yawCurrent = one(incoming(scene, yawTarget, 'InputA'), 'yaw current angle');
  const pitchCurrent = one(incoming(scene, pitchTarget, 'InputA'), 'pitch current angle');
  assert.equal(yawCurrent.at, C.RigidBearing.NAME); assert.equal(yawCurrent.p, 'CurrentAngle');
  assert.equal(pitchCurrent.at, C.RigidBearing.NAME); assert.equal(pitchCurrent.p, 'CurrentAngle');
  const yawError = inputSource(scene, yawTarget, 'InputB');
  assert.equal(yawError.type, C.Expr_MathSubtract.NAME);
  assert.equal(value(savedComponent(yawError).data.InputB), 180);
  const modulo = inputSource(scene, yawError, 'InputA');
  assert.equal(modulo.type, C.Expr_MathModuloFloored.NAME);
  assert.equal(value(savedComponent(modulo).data.InputB), 360);
  const shifted = inputSource(scene, modulo, 'InputA');
  assert.equal(shifted.type, C.Expr_MathAdd.NAME);
  assert.equal(value(savedComponent(shifted).data.InputB), 180);
  const localYaw = one(incoming(scene, shifted, 'InputA'), 'local yaw angle');
  assert.equal(localYaw.a, splitRotation.brick.key); assert.equal(localYaw.p, 'Yaw');
  const localPitch = one(incoming(scene, pitchTarget, 'InputB'), 'local pitch angle');
  assert.equal(localPitch.a, splitRotation.brick.key); assert.equal(localPitch.p, 'Pitch');

  const setters = componentRows(scene, C.Exec_Var_Set.NAME, grid);
  assert.equal(setters.length, 2, 'One latched target per bearing');
  const yawSetter = one(setters.filter(row => inputSource(scene, row.node, 'Value').key
    === yawClamp.brick.key), 'yaw target setter');
  const pitchSetter = one(setters.filter(row => inputSource(scene, row.node, 'Value').key
    === pitchClamp.brick.key), 'pitch target setter');
  assert.equal(inputSource(scene, yawSetter.node, 'Exec').key, occupiedBranch.brick.key);
  assert.equal(one(incoming(scene, yawSetter.node, 'Exec')).p, 'ExecOutA');
  assert.equal(inputSource(scene, pitchSetter.node, 'Exec').key, yawSetter.brick.key);
  const yawVar = inputSource(scene, yawSetter.node, 'VarRef');
  const pitchVar = inputSource(scene, pitchSetter.node, 'VarRef');
  assert.equal(yawVar.type, C.Var.NAME); assert.equal(pitchVar.type, C.Var.NAME);
  const yawDriver = one(outgoing(scene, yawVar, 'Value')
    .filter(edge => edge.zt === C.RigidBearing.NAME && edge.q === 'TargetAngle'),
  'yaw bearing target driver');
  const pitchDriver = one(outgoing(scene, pitchVar, 'Value')
    .filter(edge => edge.zt === C.RigidBearing.NAME && edge.q === 'TargetAngle'),
  'pitch bearing target driver');
  assert.equal(yawDriver.z, yawCurrent.a);
  assert.equal(pitchDriver.z, pitchCurrent.a);

  assert.equal(componentRows(scene, C.Exec_Var_Increment.NAME, grid).length, 0,
    'No WASD increment writers remain');
  assert.equal(componentRows(scene, C.Exec_GetInputs.NAME, grid).length, 0,
    'Unused player-input poller removed');
  assert.equal(outgoing(scene, splitter.node, 'InputForward').length, 0,
    'W/S no longer aims the gun');
  assert.equal(outgoing(scene, splitter.node, 'InputRight').length, 0,
    'A/D no longer aims the gun');
  const fire = outgoing(scene, splitter.node, 'bPressedLeftMouse');
  assert.equal(fire.length, 2, 'Existing reticle and firing routes remain');
  assert.deepEqual(fire.map(edge => [edge.zt, edge.q]).sort(), [
    [C.Expr_Select.NAME, 'bSelectB'],
    [C.MicrochipInput.NAME, 'RER_Input'],
  ].sort());

  for (const type of [C.Motor.NAME, C.ProjectileSpawner.NAME, C.OneShotAudioEmitter.NAME,
    C.RigidBearing.NAME]) {
    assert.deepEqual(normalizedComponents(scene, type), normalizedComponents(donor, type),
      `${type} settings must be byte-semantically preserved`);
  }
  assert.equal(componentRows(scene, C.Motor.NAME).length, 1, 'Barrel motor retained');
  assert.equal(componentRows(scene, C.ProjectileSpawner.NAME).length, 9,
    'All eight barrels plus the original muzzle spawner retained');
  assert.equal(componentRows(scene, C.OneShotAudioEmitter.NAME).length, 8,
    'All firing sounds retained');

  // Independent model checks for the serialized controller formulas.
  const clamp = (number, low, high) => Math.max(low, Math.min(high, number));
  const wrap180 = number => ((number + 180) % 360 + 360) % 360 - 180;
  const yawModel = (current, localYawDegrees) =>
    clamp(current - wrap180(localYawDegrees), -90, 90);
  const pitchModel = (current, localPitchDegrees) =>
    clamp(current + localPitchDegrees, -25, 45);
  assert.equal(yawModel(-6, 0), -6, 'Aligned aim holds yaw');
  assert.equal(yawModel(-6, 10), -16, 'Aim right moves the reversed yaw bearing right');
  assert.equal(yawModel(-6, -10), 4, 'Aim left moves the reversed yaw bearing left');
  assert.equal(yawModel(80, -30), 90, 'Yaw respects upper travel limit');
  assert.equal(yawModel(-80, 30), -90, 'Yaw respects lower travel limit');
  assert.equal(pitchModel(7, 0), 7, 'Aligned aim holds pitch');
  assert.equal(pitchModel(7, 20), 27, 'Aim up raises pitch');
  assert.equal(pitchModel(40, 20), 45, 'Pitch respects upper travel limit');
  assert.equal(pitchModel(-20, -20), -25, 'Pitch respects lower travel limit');

  const reader = scene.r;
  const owners = reader.owners();
  const gearsharkIndex = owners.UserNames.indexOf('Gearshark');
  assert(gearsharkIndex >= 0, 'Gearshark ownership retained');
  assert.equal(brdb.guidToUuid(owners.UserIds[gearsharkIndex]),
    'afee2120-d5ad-44d5-97ef-b3a20552e7cf');
  const bundle = JSON.parse(Buffer.from(reader.fs.readFile('Meta/Bundle.json')).toString());
  assert.equal(bundle.name, 'Mouse Aimed Minigun');
  assert(bundle.authors.some(author =>
    (author.iD || author.id) === 'afee2120-d5ad-44d5-97ef-b3a20552e7cf'));
  assert.equal(reader.fs.listPaths().includes('Meta/Thumbnail.png'),
    donor.r.fs.listPaths().includes('Meta/Thumbnail.png'), 'Thumbnail preservation');

  console.log(JSON.stringify({
    result: 'Mouse-aimed minigun validation passed',
    bricks: scene.bricks.length,
    wires: scene.edges.length,
    strictPlacement: placement.strictOk,
    aimRateHz: 40,
    yawRange: [-90, 90],
    pitchRange: [-25, 45],
    firingRoutes: fire.length,
    projectiles: componentRows(scene, C.ProjectileSpawner.NAME).length,
    audioEmitters: componentRows(scene, C.OneShotAudioEmitter.NAME).length,
    sha256: sha256(first.bytes),
  }, null, 2));
}

run();
