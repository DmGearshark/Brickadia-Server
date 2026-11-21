'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const build = require('./build-manual-tank-steering.cjs');
const {read} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
if (!input) throw new Error(
  'Usage: node test-manual-tank-steering.cjs "Wip stank steering.brz"');

const result = build(input);
const saved = read(result.bytes);
const donor = read(fs.readFileSync(input));
const placement = validatePlacement(result.bytes);

function all(type) {
  return saved.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({brick, component})));
}
function one(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}
function incoming(target, port) {
  return saved.edges.filter(edge => edge.z === target.brick.key
    && edge.zt === target.component.type && edge.q === port);
}
function outgoing(source, port) {
  return saved.edges.filter(edge => edge.a === source.brick.key
    && edge.at === source.component.type && edge.p === port);
}
function sourceOf(edge) {
  return one(saved.bricks.filter(brick => brick.key === edge.a)
    .flatMap(brick => brick.comps
      .filter(component => component.type === edge.at)
      .map(component => ({brick, component}))),
  `${edge.at}.${edge.p} source`);
}
function sameNode(a, b) {
  return a.brick.key === b.brick.key && a.component.type === b.component.type;
}
function assertSource(target, targetPort, source, sourcePort, label) {
  const edge = one(incoming(target, targetPort), label);
  assert.equal(edge.a, source.brick.key, `${label}: source brick`);
  assert.equal(edge.at, source.component.type, `${label}: source component`);
  assert.equal(edge.p, sourcePort, `${label}: source port`);
  return edge;
}
function numeric(value) {
  if (typeof value === 'number') return value;
  return value?.value;
}
function geometry(scene, grid) {
  return scene.bricks.filter(brick => brick.g === grid).map(brick => ({
    asset: brick.data.asset,
    size: brick.data.size,
    position: brick.data.position,
    direction: brick.data.direction,
    rotation: brick.data.rotation,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

assert(placement.strictOk, JSON.stringify(placement, null, 2));
assert.equal(saved.links.length, 2, 'Preserve both nested microchip links');
assert.equal(saved.joints.length, 8, 'Preserve eight wheel joints');
assert.equal([...saved.r.entities()].length, 11,
  'Preserve chassis, two microchips, and eight wheel entities');
const entityTypes = [...saved.r.entities()].map(entity => entity.typeName);
assert.equal(entityTypes.filter(type => type === 'Entity_DynamicBrickGrid').length, 1);
assert.equal(entityTypes.filter(type => type === 'Entity_MicrochipDynamicBrickGrid').length, 2);
assert.equal(entityTypes.filter(type => type === 'Entity_Wheel_Offroad1').length, 8);

const seat = one(all(C.Seat.NAME), 'driver seat');
const splitter = one(all(C.InputSplitter.NAME), 'WASD Input Splitter');
const engines = all(C.WheelEngine.NAME);
const wheels = all(C.Joint_Wheel_Suspension.NAME);
assert.equal(engines.length, 2, 'Two independent track engines');
assert.equal(wheels.length, 8, 'Eight track wheels');

const leftEngine = one(engines.filter(row => row.brick.data.position[0] === 40),
  'left-track engine at X +40');
const rightEngine = one(engines.filter(row => row.brick.data.position[0] === -40),
  'right-track engine at X -40');
const leftWheels = wheels.filter(row => row.brick.data.position[0] === 51);
const rightWheels = wheels.filter(row => row.brick.data.position[0] === -51);
assert.equal(leftWheels.length, 4, 'Four left-track wheels at X +51');
assert.equal(rightWheels.length, 4, 'Four right-track wheels at X -51');

for (const [label, engine] of [['left', leftEngine], ['right', rightEngine]]) {
  assert.equal(engine.component.data.bEnabled, true, `${label} engine enabled`);
  assert.equal(engine.component.data.bEnableManualControl, true,
    `${label} engine uses manual input`);
  assert.equal(engine.component.data.ManualControlMode, 1,
    `${label} engine uses explicit ground manual-control mode`);
  assert.equal(engine.component.data.bTankSteering, false,
    `${label} engine built-in tank steering stays disabled`);
  assert.equal(engine.component.data.bAutodiscoverWheels, false,
    `${label} engine cannot discover the opposite track`);
  assert.equal(engine.component.data.bAutodiscoverThrusters, false);
  assert.equal(engine.component.data.bAutodiscoverGyroscopes, false);
  assert.equal(engine.component.data.bAutodiscoverAerodynamicSurfaces, false);
  assert.equal(numeric(engine.component.data.ManualInput_Steer), 0,
    `${label} engine has no native steering command`);
  assert.equal(numeric(engine.component.data.DriveBrakingPowerMultiplier), 1.5,
    `${label} engine no longer has the violent 10x braking spike`);
  assert.equal(incoming(engine, 'ManualInput_Drive').length, 1,
    `${label} engine has one exclusive drive source`);
  assert.equal(incoming(engine, 'DriveAcceleratingPowerMultiplier').length, 1,
    `${label} engine receives pivot-aware acceleration power`);
  assert.equal(incoming(engine, 'WheelFrictionMultiplier').length, 1,
    `${label} engine receives pivot-aware wheel friction`);
  assert.equal(incoming(engine, 'ManualInput_Steer').length, 0,
    `${label} engine has no wired native steer source`);
}

for (const wheel of wheels) {
  assert.equal(wheel.component.data.bDiscoverable, false,
    'Every wheel is isolated from autodiscovery');
  assert.equal(wheel.component.data.bSteerEnabled, false,
    'Tank wheels do not use pivot steering');
  assert.equal(wheel.component.data.Steer, 0);
  assert.equal(wheel.component.data.bAllowEngineSteerCorrect, false);
}

const engineBus = saved.edges.filter(edge => edge.at === C.WheelEngine.NAME
  && edge.p === 'Control_DriveAndSteer'
  && edge.zt === C.Joint_Wheel_Suspension.NAME
  && edge.q === 'Control_DriveAndSteer');
assert.equal(engineBus.length, 8, 'Exactly eight explicit engine-to-wheel bus wires');
function assertTrackBus(engine, expectedWheels, forbiddenWheels, label) {
  const edges = engineBus.filter(edge => edge.a === engine.brick.key);
  assert.equal(edges.length, 4, `${label} engine drives four wheels`);
  assert.deepEqual(new Set(edges.map(edge => edge.z)),
    new Set(expectedWheels.map(row => row.brick.key)),
    `${label} engine targets only its own bank`);
  assert.equal(edges.filter(edge => forbiddenWheels.some(row => row.brick.key === edge.z)).length,
    0, `${label} engine never crosses to the opposite bank`);
}
assertTrackBus(leftEngine, leftWheels, rightWheels, 'left');
assertTrackBus(rightEngine, rightWheels, leftWheels, 'right');

// The controller keeps the requested track values and adds physics assistance
// only while genuinely stopped:
//   inputPivot  = |R| - |R|*|F|
//   moving      = clamp(max(|leftSpeed|, |rightSpeed|) / 10, 0, 1)
//   pivotWeight = clamp(inputPivot - inputPivot*moving, 0, 1)
//   turn        = R*0.5 + R*0.5*pivotWeight
//   left/right  = clamp(F +/- turn, -1, 1)
//   accel       = 0.5 + 1.5*pivotWeight
//   friction    = 0.8 - 0.45*pivotWeight
const absRows = all(C.Expr_MathAbs.NAME);
const multiplyRows = all(C.Expr_MathMultiply.NAME);
const subtractRows = all(C.Expr_MathSubtract.NAME);
const addRows = all(C.Expr_MathAdd.NAME);
const clampRows = all(C.Expr_MathClamp.NAME);
assert.equal(absRows.length, 4, 'Forward, steer, and two speed absolute gates');
assert.equal(multiplyRows.length, 6, 'Exact steer, pivot, power, and grip multiplies');
assert.equal(subtractRows.length, 4, 'Exact pivot, right-track, and grip subtracts');
assert.equal(addRows.length, 3, 'Turn, left-track, and acceleration adds');
assert.equal(clampRows.length, 4, 'Speed, pivot, and two track clamps');
assert.equal(all(C.Expr_MathDivide.NAME).length, 1, 'One speed normalization divide');
assert.equal(all(C.Expr_MathMax.NAME).length, 1, 'One two-engine speed maximum');
assert.equal(all(C.Expr_CompareEqual.NAME).length, 0,
  'Obsolete direction decoder comparisons were removed');
assert.equal(all(C.Expr_LogicalAND.NAME).length, 0,
  'Obsolete direction decoder AND gates were removed');
assert.equal(all(C.Expr_LogicalNOT.NAME).length, 0,
  'Obsolete direction decoder NOT gates were removed');

const leftOutput = sourceOf(one(incoming(leftEngine, 'ManualInput_Drive'),
  'left engine drive edge'));
const rightOutput = sourceOf(one(incoming(rightEngine, 'ManualInput_Drive'),
  'right engine drive edge'));
const leftAccelerationOutput = sourceOf(one(
  incoming(leftEngine, 'DriveAcceleratingPowerMultiplier'),
  'left acceleration-power edge'));
const rightAccelerationOutput = sourceOf(one(
  incoming(rightEngine, 'DriveAcceleratingPowerMultiplier'),
  'right acceleration-power edge'));
const leftFrictionOutput = sourceOf(one(incoming(leftEngine, 'WheelFrictionMultiplier'),
  'left wheel-friction edge'));
const rightFrictionOutput = sourceOf(one(incoming(rightEngine, 'WheelFrictionMultiplier'),
  'right wheel-friction edge'));
assert.equal(all(C.MicrochipInput.NAME).length, 3,
  'Driver plus two engine-speed microchip inputs');
assert.equal(all(C.MicrochipOutput.NAME).length, 4,
  'Two track, acceleration, and friction outputs');
assert.equal(leftOutput.component.type, C.MicrochipOutput.NAME);
assert.equal(leftOutput.component.data.PortLabel, 'Left Track Drive');
assert.equal(leftOutput.component.data.PortOrder, 1);
assert.equal(rightOutput.component.type, C.MicrochipOutput.NAME);
assert.equal(rightOutput.component.data.PortLabel, 'Right Track Drive');
assert.equal(rightOutput.component.data.PortOrder, 2);
assert(sameNode(leftAccelerationOutput, rightAccelerationOutput),
  'Both engines share one acceleration-power output');
assert.equal(leftAccelerationOutput.component.data.PortLabel,
  'Track Acceleration Power');
assert.equal(leftAccelerationOutput.component.data.PortOrder, 3);
assert(sameNode(leftFrictionOutput, rightFrictionOutput),
  'Both engines share one wheel-friction output');
assert.equal(leftFrictionOutput.component.data.PortLabel, 'Track Wheel Friction');
assert.equal(leftFrictionOutput.component.data.PortOrder, 4);
const leftClamp = sourceOf(one(incoming(leftOutput, 'RER_Input'),
  'left output source'));
const rightClamp = sourceOf(one(incoming(rightOutput, 'RER_Input'),
  'right output source'));
assert.equal(leftClamp.component.type, C.Expr_MathClamp.NAME);
assert.equal(rightClamp.component.type, C.Expr_MathClamp.NAME);
assert(!sameNode(leftClamp, rightClamp), 'Each track has a separate clamp');
for (const [label, clamp] of [['left', leftClamp], ['right', rightClamp]]) {
  assert.equal(numeric(clamp.component.data.Min), -1, `${label} clamp minimum`);
  assert.equal(numeric(clamp.component.data.Max), 1, `${label} clamp maximum`);
}

const leftAdd = sourceOf(one(incoming(leftClamp, 'Input'), 'left clamp input'));
const rightSubtract = sourceOf(one(incoming(rightClamp, 'Input'), 'right clamp input'));
assert.equal(leftAdd.component.type, C.Expr_MathAdd.NAME);
assert.equal(rightSubtract.component.type, C.Expr_MathSubtract.NAME);
assertSource(leftAdd, 'InputA', splitter, 'InputForward', 'F enters left add');
assertSource(rightSubtract, 'InputA', splitter, 'InputForward', 'F enters right subtract');
const leftTurn = sourceOf(one(incoming(leftAdd, 'InputB'), 'left turn input'));
const rightTurn = sourceOf(one(incoming(rightSubtract, 'InputB'), 'right turn input'));
assert(sameNode(leftTurn, rightTurn), 'Both tracks use one shared turn value');
assert.equal(leftTurn.component.type, C.Expr_MathAdd.NAME);
const halfSteer = sourceOf(one(incoming(leftTurn, 'InputA'), 'base half-steer input'));
const pivotExtra = sourceOf(one(incoming(leftTurn, 'InputB'), 'pivot-extra input'));
assert.equal(halfSteer.component.type, C.Expr_MathMultiply.NAME);
assertSource(halfSteer, 'InputA', splitter, 'InputRight', 'R enters half-steer');
assert.equal(numeric(halfSteer.component.data.InputB), 0.5,
  'Moving turns use one-half steer authority');
assert.equal(pivotExtra.component.type, C.Expr_MathMultiply.NAME);
assertSource(pivotExtra, 'InputA', halfSteer, 'Output',
  'Pivot extra begins with the other half of steer');
const pivotWeight = sourceOf(one(incoming(pivotExtra, 'InputB'),
  'pivot-weight input'));
assert.equal(pivotWeight.component.type, C.Expr_MathClamp.NAME);
assert.equal(numeric(pivotWeight.component.data.Min), 0);
assert.equal(numeric(pivotWeight.component.data.Max), 1);

const stoppedPivot = sourceOf(one(incoming(pivotWeight, 'Input'),
  'stopped-pivot source'));
assert.equal(stoppedPivot.component.type, C.Expr_MathSubtract.NAME);
const inputPivot = sourceOf(one(incoming(stoppedPivot, 'InputA'),
  'input-pivot source'));
const movingPivot = sourceOf(one(incoming(stoppedPivot, 'InputB'),
  'moving-pivot suppression'));
assert.equal(inputPivot.component.type, C.Expr_MathSubtract.NAME);
assert.equal(movingPivot.component.type, C.Expr_MathMultiply.NAME);
assertSource(movingPivot, 'InputA', inputPivot, 'Output',
  'Moving suppression receives pivot demand');
const speedFactor = sourceOf(one(incoming(movingPivot, 'InputB'),
  'moving speed factor'));
assert.equal(speedFactor.component.type, C.Expr_MathClamp.NAME);
assert.equal(numeric(speedFactor.component.data.Min), 0);
assert.equal(numeric(speedFactor.component.data.Max), 1);

const steerAbs = sourceOf(one(incoming(inputPivot, 'InputA'),
  'absolute steer source'));
const movingSteer = sourceOf(one(incoming(inputPivot, 'InputB'),
  'moving steer source'));
assert.equal(steerAbs.component.type, C.Expr_MathAbs.NAME);
assertSource(steerAbs, 'Input', splitter, 'InputRight', 'R enters steer abs');
assert.equal(movingSteer.component.type, C.Expr_MathMultiply.NAME);
const forwardAbs = sourceOf(one(incoming(movingSteer, 'InputA'),
  'absolute forward source'));
assert.equal(forwardAbs.component.type, C.Expr_MathAbs.NAME);
assertSource(forwardAbs, 'Input', splitter, 'InputForward', 'F enters forward abs');
assertSource(movingSteer, 'InputB', steerAbs, 'Output',
  'Input pivot is suppressed while W/S is held');

const speedScale = sourceOf(one(incoming(speedFactor, 'Input'),
  'speed normalization source'));
assert.equal(speedScale.component.type, C.Expr_MathDivide.NAME);
assert.equal(numeric(speedScale.component.data.InputB), 10,
  'Pivot assistance fades out by speed ten');
const maxSpeed = sourceOf(one(incoming(speedScale, 'InputA'),
  'maximum engine speed source'));
assert.equal(maxSpeed.component.type, C.Expr_MathMax.NAME);
const leftSpeedAbs = sourceOf(one(incoming(maxSpeed, 'InputA'),
  'left absolute speed source'));
const rightSpeedAbs = sourceOf(one(incoming(maxSpeed, 'InputB'),
  'right absolute speed source'));
for (const speedAbs of [leftSpeedAbs, rightSpeedAbs]) {
  assert.equal(speedAbs.component.type, C.Expr_MathAbs.NAME);
}
const leftSpeedInput = sourceOf(one(incoming(leftSpeedAbs, 'Input'),
  'left speed microchip input'));
const rightSpeedInput = sourceOf(one(incoming(rightSpeedAbs, 'Input'),
  'right speed microchip input'));
assert.equal(leftSpeedInput.component.data.PortLabel, 'Left Engine Speed');
assert.equal(rightSpeedInput.component.data.PortLabel, 'Right Engine Speed');
assertSource(leftSpeedInput, 'RER_Input', leftEngine, 'Speed',
  'Left engine supplies left speed feedback');
assertSource(rightSpeedInput, 'RER_Input', rightEngine, 'Speed',
  'Right engine supplies right speed feedback');

const acceleration = sourceOf(one(incoming(leftAccelerationOutput, 'RER_Input'),
  'acceleration-power source'));
assert.equal(acceleration.component.type, C.Expr_MathAdd.NAME);
assert.equal(numeric(acceleration.component.data.InputA), 0.5);
const pivotBoost = sourceOf(one(incoming(acceleration, 'InputB'),
  'pivot acceleration boost'));
assert.equal(pivotBoost.component.type, C.Expr_MathMultiply.NAME);
assertSource(pivotBoost, 'InputA', pivotWeight, 'Output',
  'Pivot weight controls acceleration boost');
assert.equal(numeric(pivotBoost.component.data.InputB), 1.5,
  'Stopped pivot acceleration rises from 0.5 to 2.0');

const friction = sourceOf(one(incoming(leftFrictionOutput, 'RER_Input'),
  'wheel-friction source'));
assert.equal(friction.component.type, C.Expr_MathSubtract.NAME);
assert.equal(numeric(friction.component.data.InputA), 0.8);
const frictionDrop = sourceOf(one(incoming(friction, 'InputB'),
  'pivot friction reduction'));
assert.equal(frictionDrop.component.type, C.Expr_MathMultiply.NAME);
assertSource(frictionDrop, 'InputA', pivotWeight, 'Output',
  'Pivot weight controls friction reduction');
assert.equal(numeric(frictionDrop.component.data.InputB), 0.45,
  'Stopped pivot friction falls from 0.8 to 0.35');

const characterEdge = one(incoming(splitter, 'Character'), 'seat character input');
const characterSource = sourceOf(characterEdge);
if (characterSource.component.type === C.MicrochipInput.NAME) {
  const parentEdge = one(incoming(characterSource, 'RER_Input'),
    'character microchip input source');
  assert.equal(parentEdge.a, seat.brick.key);
  assert.equal(parentEdge.at, C.Seat.NAME);
  assert.equal(parentEdge.p, 'SittingCharacter');
} else {
  assert(sameNode(characterSource, seat),
    'Input Splitter Character comes from the driver seat');
  assert.equal(characterEdge.p, 'SittingCharacter');
}

function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}
function mix(forward, right, speed = 0) {
  const inputPivot = Math.abs(right) - Math.abs(right) * Math.abs(forward);
  const moving = Math.max(0, Math.min(1, Math.abs(speed) / 10));
  const pivot = Math.max(0, Math.min(1, inputPivot - inputPivot * moving));
  const halfSteer = right * 0.5;
  const turn = halfSteer + halfSteer * pivot;
  return {
    left: clamp(forward + turn),
    right: clamp(forward - turn),
    pivot,
    acceleration: 0.5 + 1.5 * pivot,
    friction: 0.8 - 0.45 * pivot,
  };
}
const truthTable = [
  ['NONE', 0, 0, 0, 0, 0],
  ['W', 1, 0, 0, 1, 1],
  ['S', -1, 0, 0, -1, -1],
  ['A stopped', 0, -1, 0, -1, 1],
  ['D stopped', 0, 1, 0, 1, -1],
  ['W+A', 1, -1, 0, 0.5, 1],
  ['W+D', 1, 1, 0, 1, 0.5],
  ['S+A', -1, -1, 0, -1, -0.5],
  ['S+D', -1, 1, 0, -0.5, -1],
  ['W+S / A+D', 0, 0, 0, 0, 0],
  ['A while coasting', 0, -1, 10, -0.5, 0.5],
  ['D while coasting', 0, 1, 10, 0.5, -0.5],
];
for (const [label, forward, right, speed, expectedLeft, expectedRight] of truthTable) {
  const result = mix(forward, right, speed);
  assert(Math.abs(result.left - expectedLeft) < 1e-12,
    `${label}: left expected ${expectedLeft}, got ${result.left}`);
  assert(Math.abs(result.right - expectedRight) < 1e-12,
    `${label}: right expected ${expectedRight}, got ${result.right}`);
}
const stoppedAssist = mix(0, -1, 0);
assert.equal(stoppedAssist.pivot, 1);
assert.equal(stoppedAssist.acceleration, 2);
assert(Math.abs(stoppedAssist.friction - 0.35) < 1e-12);
const movingAssist = mix(0, -1, 10);
assert.equal(movingAssist.pivot, 0);
assert.equal(movingAssist.acceleration, 0.5);
assert.equal(movingAssist.friction, 0.8);

const donorSeat = one(donor.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === C.Seat.NAME)
  .map(component => ({brick, component}))), 'donor seat');
assert.deepEqual(geometry(saved, seat.brick.g), geometry(donor, donorSeat.brick.g),
  'Root vehicle brick geometry must remain unchanged');

const targets = new Set();
for (const edge of saved.edges) {
  const target = `${edge.z}|${edge.zt}|${edge.q}`;
  assert(!targets.has(target), `Duplicate wire destination ${target}`);
  targets.add(target);
}

const owners = saved.r.owners();
const gearshark = owners.UserNames.indexOf('Gearshark');
const publicOwner = owners.UserNames.indexOf('PUBLIC');
assert(gearshark >= 0, 'Gearshark owner record');
assert.equal(owners.BrickCounts[gearshark], saved.bricks.length);
assert.equal(owners.ComponentCounts[gearshark],
  saved.bricks.reduce((sum, brick) => sum + brick.comps.length, 0));
assert.equal(owners.EntityCounts[gearshark], [...saved.r.entities()].length);
// Current BRZ serialization leaves per-owner WireCounts at zero even for
// valid saved wires. Unique endpoints plus complete Gearshark brick/component
// ownership prove that every retained wire belongs to the same owner without
// asserting that non-authoritative aggregate.
if (publicOwner >= 0) {
  assert.equal(owners.BrickCounts[publicOwner], 0);
  assert.equal(owners.ComponentCounts[publicOwner], 0);
  assert.equal(owners.WireCounts[publicOwner], 0);
  assert.equal(owners.EntityCounts[publicOwner], 0);
}

console.log(JSON.stringify({
  strictPlacement: placement.strictOk,
  bricks: saved.bricks.length,
  wires: saved.edges.length,
  entities: [...saved.r.entities()].length,
  joints: saved.joints.length,
  links: saved.links.length,
  controlMathGates: 23,
  leftTrackWheels: leftWheels.length,
  rightTrackWheels: rightWheels.length,
  truthTableCases: truthTable.length,
  owner: owners.UserNames[gearshark],
}, null, 2));
