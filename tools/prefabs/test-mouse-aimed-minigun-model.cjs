'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {brdb} = require('brs-js');
const build = require('./build-mouse-aimed-minigun-model.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {transform: normalizeOwner} = require('./assign-prefab-owner.cjs');
const {C} = require('./loadboard-lib.cjs');

if (!process.argv[2]) {
  throw new Error('Usage: node test-mouse-aimed-minigun-model.cjs input-minigun-model.brz');
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

function overlapSignatures(result) {
  return result.uncertainPairs.map(pair => [
    `${pair.aAsset}@${pair.aPosition.join(',')}`,
    `${pair.zAsset}@${pair.zPosition.join(',')}`,
  ].sort().join('|')).sort();
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

  const donor = read(fs.readFileSync(INPUT));
  const scene = read(first.bytes);
  const donorPlacement = validatePlacement(fs.readFileSync(INPUT));
  const placement = validatePlacement(first.bytes);
  assert(placement.ok, JSON.stringify(placement, null, 2));
  assert.equal(placement.confirmedPairs.length, 0, 'No confirmed overlaps');
  assert.equal(placement.invalidBricks.length, 0, 'No invalid bricks');
  assert.deepEqual(overlapSignatures(placement), overlapSignatures(donorPlacement),
    'Only the model donor\'s four pre-existing conservative shape warnings remain');
  checkPortAndDriverIntegrity(scene);

  assert.equal(first.scene.bricks.length, first.original.bricks.length + 27,
    'Exactly 27 controller gates added');
  assert.equal(scene.bricks.length, donor.bricks.length + 27);
  assert.equal(scene.links.length, donor.links.length, 'Microchip links preserved');
  assert.equal(scene.joints.length, donor.joints.length, 'All joints preserved');
  assert.equal(scene.joints.length, 4, 'Yaw, pitch, seat-fold and barrel joints retained');

  // Every supplied brick, component and wire is untouched in the build graph;
  // this conversion is purely additive.
  const generatedByKey = new Map(first.scene.bricks.map(brick => [brick.key, brick]));
  for (const brick of first.original.bricks) {
    assert.deepEqual(generatedByKey.get(brick.key), brick,
      `Existing brick/component changed unexpectedly: ${brick.key}`);
  }
  const generatedEdgeKeys = new Set(first.scene.edges.map(edge => JSON.stringify(edge)));
  for (const edge of first.original.edges) {
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
  const negate = one(componentRows(scene, C.Expr_MathNegate.NAME, grid), 'negative-Y forward remap');
  const makeVector = one(componentRows(scene, C.Expr_MakeVector.NAME, grid), 'axis remap');
  const direction = one(componentRows(scene, C.Expr_DirectionToRotation.NAME, grid),
    'local aim direction rotation');
  const splitRotation = one(componentRows(scene, C.Expr_SplitRotation.NAME, grid),
    'local aim angles');
  const gridReader = one(componentRows(scene, C.ReadBrickGrid.NAME), 'moving gun-grid reader');

  assert.notEqual(gridReader.brick.g, grid, 'Reader is physically on the yaw carrier');
  assert.notEqual(gridReader.brick.g, seat.brick.g,
    'Aim frame is sampled before the gun-body pitch hinge');
  assert.equal(inputSource(scene, clock.node, 'bEnabled').key, seat.brick.key);
  assert.equal(one(incoming(scene, clock.node, 'bEnabled')).p, 'bIsOccupied');
  assert.equal(inputSource(scene, aim.node, 'Character').key, seat.brick.key);
  assert.equal(one(incoming(scene, aim.node, 'Character')).p, 'SittingCharacter');
  assert.equal(inputSource(scene, pose.node, 'Exec').key, clock.brick.key);
  assert.equal(inputSource(scene, pose.node, 'Entity').key, gridReader.brick.key);
  assert.equal(inputSource(scene, aim.node, 'Exec').key, pose.brick.key);
  assert.equal(inputSource(scene, buffer.node, 'Input').key, aim.brick.key);
  assert.equal(inputSource(scene, occupiedBranch.node, 'Exec').key, buffer.brick.key);
  assert.equal(inputSource(scene, occupiedBranch.node, 'bCond').key, seat.brick.key);
  assert.equal(one(incoming(scene, occupiedBranch.node, 'bCond')).p, 'bIsOccupied');
  assert.equal(value(clock.saved.data.IntervalSeconds), 0.025);
  assert.equal(value(buffer.saved.data.TicksToWait), 1);
  assert.equal(aim.saved.data.bLocalAim, false);

  assert.equal(inputSource(scene, convert.node, 'Input').key, pose.brick.key);
  assert.equal(convert.saved.data.TargetType.$variant, 'Quat');
  assert.equal(inputSource(scene, inverse.node, 'Input').key, convert.brick.key);
  assert.equal(inputSource(scene, rotate.node, 'Rotation').key, inverse.brick.key);
  assert.equal(inputSource(scene, rotate.node, 'Vector').key, aim.brick.key);
  assert.equal(inputSource(scene, splitVector.node, 'Input').key, rotate.brick.key);
  const forwardIn = one(incoming(scene, negate.node, 'Input'), 'negative local-Y forward');
  assert.equal(forwardIn.a, splitVector.brick.key); assert.equal(forwardIn.p, 'Y');
  const remapX = one(incoming(scene, makeVector.node, 'X'), 'remapped forward axis');
  const remapY = one(incoming(scene, makeVector.node, 'Y'), 'remapped right axis');
  const remapZ = one(incoming(scene, makeVector.node, 'Z'), 'remapped up axis');
  assert.equal(remapX.a, negate.brick.key); assert.equal(remapX.p, 'Output');
  assert.equal(remapY.a, splitVector.brick.key); assert.equal(remapY.p, 'X');
  assert.equal(remapZ.a, splitVector.brick.key); assert.equal(remapZ.p, 'Z');
  assert.equal(inputSource(scene, direction.node, 'Direction').key, makeVector.brick.key);
  assert.equal(inputSource(scene, splitRotation.node, 'Input').key, direction.brick.key);

  const clamps = componentRows(scene, C.Expr_MathClamp.NAME, grid);
  const yawClamp = one(clamps.filter(row => value(row.saved.data.Min) === -90
    && value(row.saved.data.Max) === 90), 'yaw clamp');
  const pitchClamp = one(clamps.filter(row => value(row.saved.data.Min) === -25
    && value(row.saved.data.Max) === 45), 'pitch clamp');
  const yawTarget = inputSource(scene, yawClamp.node, 'Input');
  const pitchAngle = inputSource(scene, pitchClamp.node, 'Input');
  assert.equal(yawTarget.type, C.Expr_MathSubtract.NAME);
  assert.equal(pitchAngle.key, splitRotation.brick.key,
    'Carrier-local pitch is an absolute hinge target');
  assert.equal(one(incoming(scene, pitchClamp.node, 'Input')).p, 'Pitch');
  const yawCurrent = one(incoming(scene, yawTarget, 'InputA'), 'yaw current angle');
  assert.equal(yawCurrent.at, C.RigidBearing.NAME); assert.equal(yawCurrent.p, 'CurrentAngle');
  const yawBearing = sourceNode(scene, yawCurrent);
  assert.equal(yawBearing.brick.g, 1, 'Root bearing is yaw');
  const yawError = inputSource(scene, yawTarget, 'InputB');
  assert.equal(yawError.type, C.Expr_MathSubtract.NAME);
  assert.equal(value(savedComponent(yawError).data.InputB), 180);
  const modulo = inputSource(scene, yawError, 'InputA');
  assert.equal(modulo.type, C.Expr_MathModuloFloored.NAME);
  assert.equal(value(savedComponent(modulo).data.InputB), 360);
  const shifted = inputSource(scene, modulo, 'InputA');
  assert.equal(shifted.type, C.Expr_MathAdd.NAME);
  assert.equal(value(savedComponent(shifted).data.InputB), 180);
  assert.equal(one(incoming(scene, shifted, 'InputA')).a, splitRotation.brick.key);
  assert.equal(one(incoming(scene, shifted, 'InputA')).p, 'Yaw');

  const setters = componentRows(scene, C.Exec_Var_Set.NAME, grid);
  assert.equal(setters.length, 2);
  const yawSetter = one(setters.filter(row => inputSource(scene, row.node, 'Value').key
    === yawClamp.brick.key), 'yaw target setter');
  const pitchSetter = one(setters.filter(row => inputSource(scene, row.node, 'Value').key
    === pitchClamp.brick.key), 'pitch target setter');
  assert.equal(inputSource(scene, yawSetter.node, 'Exec').key, occupiedBranch.brick.key);
  assert.equal(one(incoming(scene, yawSetter.node, 'Exec')).p, 'ExecOutA');
  assert.equal(inputSource(scene, pitchSetter.node, 'Exec').key, yawSetter.brick.key);
  const yawVar = inputSource(scene, yawSetter.node, 'VarRef');
  const pitchVar = inputSource(scene, pitchSetter.node, 'VarRef');
  const yawDriver = one(outgoing(scene, yawVar, 'Value')
    .filter(edge => edge.zt === C.RigidBearing.NAME && edge.q === 'TargetAngle'),
  'yaw bearing target driver');
  const pitchDriver = one(outgoing(scene, pitchVar, 'Value')
    .filter(edge => edge.zt === C.RigidBearing.NAME && edge.q === 'TargetAngle'),
  'pitch bearing target driver');
  const pitchBearing = targetNode(scene, pitchDriver);
  assert.equal(yawDriver.z, yawBearing.key);
  assert.notEqual(pitchBearing.brick.g, 1, 'Child bearing is pitch');
  assert.equal(gridReader.brick.g, pitchBearing.brick.g,
    'Reader is mounted on the pitch bearing parent/yaw carrier');
  const pitchJoint = one(scene.joints.filter(joint => joint.key === pitchBearing.key),
    'pitch joint');
  assert.equal(pitchJoint.entity, seat.brick.g, 'Pitch bearing moves the seated gun body');

  // SPACEBAR FIRE: held InputUp > 0.5 drives the donor's existing fire input.
  const space = one(componentRows(scene, C.Expr_CompareGreater.NAME, grid),
    'Spacebar positive threshold');
  assert.equal(value(space.saved.data.InputB), 0.5);
  const spaceAxis = one(incoming(scene, space.node, 'InputA'), 'Spacebar InputUp');
  assert.equal(spaceAxis.a, splitter.brick.key); assert.equal(spaceAxis.p, 'InputUp');
  assert.equal(inputSource(scene, splitter.node, 'Character').key, seat.brick.key);
  const occupiedAndSpace = targetNode(scene,
    one(outgoing(scene, space.node, 'bOutput'), 'Spacebar occupied gate route'));
  assert.equal(occupiedAndSpace.type, C.Expr_LogicalAND.NAME);
  assert.equal(one(incoming(scene, occupiedAndSpace, 'bInputA')).a, space.brick.key);
  const occupiedFire = one(incoming(scene, occupiedAndSpace, 'bInputB'),
    'Space fire occupancy guard');
  assert.equal(occupiedFire.a, seat.brick.key); assert.equal(occupiedFire.p, 'bIsOccupied');
  const fireInputEdge = one(outgoing(scene, occupiedAndSpace, 'bOutput'),
    'seat-authorized Spacebar fire-level route');
  assert.equal(fireInputEdge.zt, C.MicrochipInput.NAME);
  assert.equal(fireInputEdge.q, 'RER_Input');
  const fireInput = targetNode(scene, fireInputEdge);
  const fireFanout = outgoing(scene, fireInput, 'RER_Output');
  assert.equal(fireFanout.length, 3, 'Original fire signal fans out to motor, flash and sequencer');
  assert(fireFanout.some(edge => edge.zt === C.Motor.NAME && edge.q === 'bEnabled'));
  assert(fireFanout.some(edge => edge.zt === C.Expr_LogicalAND.NAME && edge.q === 'bInputA'));
  assert(fireFanout.some(edge => edge.zt === C.MicrochipInput.NAME && edge.q === 'RER_Input'));
  assert.equal(outgoing(scene, splitter.node, 'bPressedLeftMouse').length, 0,
    'This model intentionally fires with Space, not mouse click');

  for (const type of [C.Motor.NAME, C.ProjectileSpawner.NAME, C.OneShotAudioEmitter.NAME,
    C.RigidBearing.NAME, C.Seat.NAME]) {
    assert.deepEqual(normalizedComponents(scene, type), normalizedComponents(donor, type),
      `${type} settings preserved`);
  }
  assert.equal(componentRows(scene, C.Motor.NAME).length, 1);
  assert.equal(componentRows(scene, C.ProjectileSpawner.NAME).length, 9);
  assert.equal(componentRows(scene, C.OneShotAudioEmitter.NAME).length, 8);
  assert.equal(componentRows(scene, C.RigidBearing.NAME).length, 3);

  // Formula model: aligned aim holds, right/up move in the calibrated signs,
  // and both axes retain the same conservative limits as the first conversion.
  const clamp = (number, low, high) => Math.max(low, Math.min(high, number));
  const wrap180 = number => ((number + 180) % 360 + 360) % 360 - 180;
  const yawModel = (current, localYawDegrees) =>
    clamp(current - wrap180(localYawDegrees), -90, 90);
  const pitchModel = absolutePitchDegrees =>
    clamp(absolutePitchDegrees, -25, 45);
  assert.equal(yawModel(0, 0), 0);
  assert.equal(yawModel(0, 15), -15);
  assert.equal(yawModel(0, -15), 15);
  assert.equal(yawModel(80, -20), 90);
  assert.equal(yawModel(-80, 20), -90);
  assert.equal(pitchModel(15), 15);
  assert.equal(pitchModel(60), 45);
  assert.equal(pitchModel(-40), -25);

  const ownership = normalizeOwner(first.bytes);
  assert.equal(ownership.owner.id, 'afee2120-d5ad-44d5-97ef-b3a20552e7cf');
  assert.equal(ownership.reassignedBricks, 0, 'Every brick owned by Gearshark');
  assert.equal(ownership.reassignedEntities, 0, 'Every entity owned by Gearshark');
  assert.deepEqual(ownership.changedPaths, []);
  const bundle = JSON.parse(Buffer.from(scene.r.fs.readFile('Meta/Bundle.json')).toString());
  assert.equal(bundle.name, 'Mouse Aimed Minigun Model - Spacebar Fire');
  assert(bundle.authors.some(author =>
    (author.iD || author.id) === 'afee2120-d5ad-44d5-97ef-b3a20552e7cf'));
  assert.equal(scene.r.fs.listPaths().includes('Meta/Thumbnail.png'),
    donor.r.fs.listPaths().includes('Meta/Thumbnail.png'));

  console.log(JSON.stringify({
    result: 'Mouse-aimed Minigun Model validation passed',
    bricks: scene.bricks.length,
    wires: scene.edges.length,
    placementOk: placement.ok,
    inheritedConservativeOverlapWarnings: placement.uncertainPairs.length,
    aimRateHz: 40,
    fireControl: 'Hold Space',
    yawRange: [-90, 90],
    pitchRange: [-25, 45],
    projectiles: componentRows(scene, C.ProjectileSpawner.NAME).length,
    audioEmitters: componentRows(scene, C.OneShotAudioEmitter.NAME).length,
    sha256: sha256(first.bytes),
  }, null, 2));
}

run();
