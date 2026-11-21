'use strict';

const assert = require('node:assert/strict');
const build = require('./build-ground-distance-hover-frame.cjs');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
if (!input) throw new Error(
  'Usage: node test-ground-distance-hover-frame.cjs "Hover Frame.brz"');

const result = build(input);
const saved = read(result.bytes);
const all = type => saved.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({brick, component})));
const one = (items, label) => {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
};
const incoming = (target, port) => saved.edges.filter(edge =>
  edge.z === target.brick.key && edge.zt === target.component.type && edge.q === port);
const outgoing = (source, port) => saved.edges.filter(edge =>
  edge.a === source.brick.key && edge.at === source.component.type && edge.p === port);
const sourceRow = edge => one(saved.bricks.filter(brick => brick.key === edge.a)
  .flatMap(brick => brick.comps.filter(component => component.type === edge.at)
    .map(component => ({brick, component}))), `${edge.at}.${edge.p} source`);

assert(result.placement.strictOk, 'Output must pass strict placement validation');
assert.equal(saved.links.length, 1, 'Preserve one linked microchip');
assert.equal(saved.joints.length, 0, 'Hover controller adds no joints');
assert.equal([...saved.r.entities()].length, 2,
  'Preserve only the chassis and linked microchip entities');

const engine = one(all(C.WheelEngine.NAME), 'vehicle engine');
const seat = one(all(C.Seat.NAME), 'seat');
const thrusters = all(C.Thruster.NAME);
const liftThrusters = thrusters.filter(row => row.brick.data.asset === C.Thruster.BRICK);
const movementThrusters = thrusters.filter(row => row.brick.data.asset === 'PB_DefaultBrick');
const gyro = one(all(C.Gyroscope.NAME), 'gyro');
const hoverSwitch = one(all(C.AnimatedSwitch.NAME), 'hover switch');
assert.equal(thrusters.length, 8, 'Two lift thrusters plus six movement thrusters');
assert.equal(liftThrusters.length, 2, 'Two native lift thrusters');
assert.equal(movementThrusters.length, 6, 'Six procedural movement thrusters');
assert.equal(engine.component.data.bEnabled, false, 'Engine is not lift authority');
assert.equal(engine.component.data.bAutodiscoverThrusters, false);
assert.equal(engine.component.data.bAutodiscoverGyroscopes, false);
assert.equal(saved.edges.filter(edge => edge.a === engine.brick.key
  && edge.at === C.WheelEngine.NAME && edge.p === 'Control_DriveAndSteer'
  && [C.Thruster.NAME, C.Gyroscope.NAME].includes(edge.zt)).length, 0,
'No Vehicle Engine control bus may fight the direct hover controller');
assert.equal(saved.edges.filter(edge => edge.a === seat.brick.key
  && edge.at === C.Seat.NAME && edge.p === 'SittingCharacter'
  && edge.z === engine.brick.key && edge.zt === C.WheelEngine.NAME
  && edge.q === 'Character').length, 1,
'Retain the seat/engine route for later movement work');

for (const thruster of liftThrusters) {
  assert.equal(thruster.brick.data.direction, 5,
    'User-confirmed downward native-thruster direction');
  assert.equal(thruster.brick.data.rotation, 1,
    'User-confirmed downward native-thruster rotation');
  assert.equal(thruster.component.data.Force, 50000);
  assert.equal(thruster.component.data.ForceApplication, 0);
  assert.equal(thruster.component.data.bDiscoverable, false);
  assert.equal(incoming(thruster, 'Throttle').length, 1,
    'Each thruster receives the same direct throttle');
  assert.equal(incoming(thruster, 'Control_DriveAndSteer').length, 0,
    'No competing drive bus on lift thruster');
  assert.equal(incoming(thruster, 'bEnabled').length, 1,
    'Top switch controls lift enable');
}
for (const thruster of movementThrusters) {
  assert.equal(thruster.component.data.bDiscoverable, false);
  assert.equal(thruster.component.data.bSpawnLight, false);
  assert.equal(incoming(thruster, 'Throttle').length, 1,
    'Every movement thruster has one direct seat-input throttle driver');
  assert.equal(incoming(thruster, 'Force').length, 1,
    'Every movement thruster has one editable force driver');
  assert.equal(incoming(thruster, 'Control_DriveAndSteer').length, 0,
    'Vehicle Engine may not command movement thrusters');
  assert.equal(incoming(thruster, 'bEnabled').length, 1,
    'Top switch controls movement enable');
}
assert.equal(gyro.component.data.Strength, 50);
assert.equal(gyro.component.data.Damping, 1);
assert.deepEqual(gyro.component.data.TargetAxis, {X: 0, Y: 0, Z: 1});
assert.equal(incoming(gyro, 'Control_DriveAndSteer').length, 0,
  'Standalone gyro has no engine bus');
assert.equal(incoming(gyro, 'bEnabled').length, 1,
  'Top switch controls gyro enable');
assert.equal(outgoing(hoverSwitch, 'bEnabled').length, 9,
  'Switch enables eight thrusters and one gyro');

const clock = one(all(C.Clock.NAME), '100 Hz clock');
const sweep = one(all(C.Exec_Sweep.NAME), 'downward sweep');
const vars = all(C.Var.NAME);
const remaps = all(C.Expr_Remap.NAME);
const clamps = all(C.Expr_MathClamp.NAME);
const subtracts = all(C.Expr_MathSubtract.NAME);
const divide = one(all(C.Expr_MathDivide.NAME), 'velocity divide');
const add = one(all(C.Expr_MathAdd.NAME), 'P plus D');
const getter = one(all(C.Exec_Var_Get.NAME), 'previous distance getter');
const setter = one(all(C.Exec_Var_Set.NAME), 'previous distance setter');
const throttle = one(all(C.Rerouter.NAME), 'throttle rerouter');
const splitter = one(all(C.InputSplitter.NAME), 'seat input splitter');
const negates = all(C.Expr_MathNegate.NAME);
assert.equal(vars.length, 5,
  'Update rate, setpoint, previous distance, drive force, and turn force');
assert.equal(remaps.length, 2, 'Proportional and damping remaps');
assert.equal(clamps.length, 7, 'Three hover clamps plus four movement clamps');
assert.equal(subtracts.length, 2, 'Height error and distance delta');
assert.equal(negates.length, 2, 'Reverse and left input inversion');
assert.equal(clock.component.data.IntervalSeconds, 0.01);
assert.deepEqual(sweep.component.data.Direction, {X: 0, Y: 0, Z: -1});
assert.equal(sweep.component.data.Distance, 100);
assert.equal(sweep.component.data.Radius, 0);
assert.equal(sweep.component.data.bRelative, true);
assert.equal(sweep.component.data.bIgnoreOwningGrid, true);
assert.equal(sweep.component.data.bDetectBricks, true);
assert.equal(sweep.component.data.bDetectPhysics, true);
assert.equal(sweep.component.data.bDetectMap, true);
assert.equal(incoming(sweep, 'Exec').length, 1);
assert.equal(sourceRow(incoming(sweep, 'Exec')[0]).component.type, C.Clock.NAME,
  'Clock pulses the sweep');
assert.equal(incoming(getter, 'Exec').length, 1);
assert.equal(sourceRow(incoming(getter, 'Exec')[0]).component.type, C.Exec_Sweep.NAME,
  'Sweep completes before previous-distance get');
assert.equal(incoming(setter, 'Exec').length, 1);
assert.equal(sourceRow(incoming(setter, 'Exec')[0]).component.type, C.Exec_Var_Get.NAME,
  'Get completes before previous-distance set');
assert.equal(incoming(setter, 'Value').length, 1);
assert.equal(sourceRow(incoming(setter, 'Value')[0]).component.type, C.Exec_Sweep.NAME,
  'Current HitDistance replaces previous distance');
assert.equal(incoming(divide, 'InputB').length, 1,
  'Update rate divides distance delta');
assert.equal(incoming(add, 'InputA').length, 1);
assert.equal(incoming(add, 'InputB').length, 1);
assert.equal(outgoing(throttle, 'RER_Output').filter(edge =>
  edge.zt === C.Thruster.NAME && edge.q === 'Throttle').length, 2,
'Final throttle fans out to both thrusters');
assert.equal(incoming(splitter, 'Character').length, 1,
  'The pilot seat owns the movement input splitter');
assert.equal(sourceRow(incoming(splitter, 'Character')[0]).component.type, C.Seat.NAME);

const at = position => one(movementThrusters.filter(row =>
  row.brick.data.position.every((value, axis) => value === position[axis])),
`movement thruster at ${position.join(',')}`);
const movementLayout = [
  {position: [-57, 5, 0], direction: 0, rotation: 0, forceApplication: 0, force: 15000},
  {position: [37, 5, 0], direction: 1, rotation: 0, forceApplication: 0, force: 15000},
  {position: [40, -15, 0], direction: 2, rotation: 0, forceApplication: 1, force: 5000},
  {position: [-60, -15, 0], direction: 3, rotation: 0, forceApplication: 1, force: 5000},
  {position: [40, 25, 0], direction: 3, rotation: 0, forceApplication: 1, force: 5000},
  {position: [-60, 25, 0], direction: 2, rotation: 0, forceApplication: 1, force: 5000},
];
for (const expected of movementLayout) {
  const row = at(expected.position);
  assert.equal(row.brick.data.direction, expected.direction);
  assert.equal(row.brick.data.rotation, expected.rotation);
  assert.deepEqual(row.brick.data.size, [5, 5, 2]);
  assert.equal(row.component.data.ForceApplication, expected.forceApplication);
  assert.equal(row.component.data.Force, expected.force);
}
const variableValues = vars.map(row => row.component.data.Value?.value);
assert(variableValues.includes(15000), 'Editable DRIVE FORCE value');
assert(variableValues.includes(5000), 'Editable TURN FORCE value');
assert.equal(outgoing(splitter, 'InputForward').length, 2,
  'Forward input feeds forward and inverted reverse paths');
assert.equal(outgoing(splitter, 'InputRight').length, 2,
  'Right input feeds right and inverted left paths');

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
assert.equal(owners.BrickCounts[gearshark], saved.bricks.length,
  'Every output brick should be owned by Gearshark');
assert.equal(owners.EntityCounts[gearshark], [...saved.r.entities()].length,
  'Every output entity should be owned by Gearshark');
if (publicOwner >= 0) {
  assert.equal(owners.BrickCounts[publicOwner], 0);
  assert.equal(owners.EntityCounts[publicOwner], 0);
}

console.log(JSON.stringify({
  strictPlacement: result.placement.strictOk,
  bricks: saved.bricks.length,
  wires: saved.edges.length,
  controllerGates: result.summary.controllerGates,
  liftForcePerThruster: liftThrusters[0].component.data.Force,
  driveForce: 15000,
  turnForce: 5000,
  updateRate: clock.component.data.IntervalSeconds,
  setpoint: vars.map(row => row.component.data.Value?.value)
    .find(value => value === 40),
  owner: owners.UserNames[gearshark],
  sha256: result.summary.sha256,
}, null, 2));
