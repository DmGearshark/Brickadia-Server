'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const build = require('./build-native-auto-hover-frame.cjs');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
if (!input) throw new Error(
  'Usage: node test-native-auto-hover-frame.cjs "Hover Frame.brz"');

const result = build(input);
const saved = read(result.bytes);
const all = type => saved.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({brick, component})));
const one = (items, label) => {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
};
const drivers = (target, port) => saved.edges.filter(edge =>
  edge.z === target.brick.key && edge.zt === target.component.type && edge.q === port);

assert(result.placement.strictOk, 'Output must pass strict placement validation');
assert.equal(all(C.Clock.NAME).length, 0, 'Native hover must not add a running clock');
assert.equal(all(C.Exec_Sweep.NAME).length, 0, 'Native hover must not need a sweep loop');
assert.equal(all(C.Gyroscope.NAME).length, 1, 'Exactly one stabilizing gyro');
assert.equal(all(C.Thruster.NAME).length, 2, 'Preserve the paired lift thrusters');
assert.equal(all(C.WheelEngine.NAME).length, 1, 'Exactly one Vehicle Engine');
assert.equal(all(C.Seat.NAME).length, 1, 'Exactly one pilot seat');
assert.equal(all(C.Var.NAME).length, 8, 'Eight editable orange tuning values');
assert.equal(all(C.MicrochipOutput.NAME).length, 8, 'Eight labeled tuning outputs');

const engine = one(all(C.WheelEngine.NAME), 'engine');
const gyro = one(all(C.Gyroscope.NAME), 'gyro');
const seat = one(all(C.Seat.NAME), 'seat');
const thrusters = all(C.Thruster.NAME);
assert.equal(engine.component.data.bEnabled, true);
assert.equal(engine.component.data.bEnableManualControl, false);
assert.equal(engine.component.data.bAutodiscoverWheels, false);
assert.equal(engine.component.data.bAutodiscoverThrusters, true);
assert.equal(engine.component.data.bAutodiscoverGyroscopes, true);
assert.equal(engine.component.data.KeyboardSteeringRollMix, 0);
assert.equal(engine.component.data.KeyboardSteeringYawMix, 1);
assert.equal(engine.component.data.bEnableGlideTrim, false);
assert.equal(seat.component.data.SeatMode, 0);
assert.equal(seat.component.data.bFlyingGroundControls, true);
assert.equal(seat.component.data.PromptCustomLabel, 'Drive Hover Frame');
assert.equal(gyro.component.data.bEnabled, true);
assert.equal(gyro.component.data.bDiscoverable, true);
assert.deepEqual(gyro.component.data.TargetAxis, {X: 0, Y: 0, Z: 1});
assert.deepEqual(gyro.brick.data.position, [-10, 5, -8]);
assert(thrusters.every(row => row.component.data.bEnabled
  && row.component.data.bDiscoverable
  && row.component.data.ForceApplication === 0));

const controlBus = saved.edges.filter(edge => edge.a === engine.brick.key
  && edge.at === C.WheelEngine.NAME && edge.p === 'Control_DriveAndSteer');
assert.equal(controlBus.filter(edge => edge.zt === C.Thruster.NAME
  && edge.q === 'Control_DriveAndSteer').length, 2,
'Engine must control both lift thrusters');
assert.equal(controlBus.filter(edge => edge.zt === C.Gyroscope.NAME
  && edge.q === 'Control_DriveAndSteer').length, 1,
'Engine must control the gyro');
assert.equal(saved.edges.filter(edge => edge.a === seat.brick.key
  && edge.at === C.Seat.NAME && edge.p === 'SittingCharacter'
  && edge.z === engine.brick.key && edge.zt === C.WheelEngine.NAME
  && edge.q === 'Character').length, 1,
'Seat character must control the engine');

for (const [port, count] of [
  ['CustomMass', 1],
  ['LiftMultiplier', 1],
  ['ThrustMultiplier', 1],
  ['FlightTopSpeed', 1],
  ['ArcadeYawRate', 1],
]) assert.equal(drivers(engine, port).length, count, `${port} tuning driver`);
for (const port of ['Strength', 'Damping']) {
  assert.equal(drivers(gyro, port).length, 1, `Gyro ${port} tuning driver`);
}
for (const thruster of thrusters) {
  assert.equal(drivers(thruster, 'Force').length, 1, 'Thruster force tuning driver');
}

const targets = new Set();
for (const edge of saved.edges) {
  const target = `${edge.z}|${edge.zt}|${edge.q}`;
  assert(!targets.has(target), `Duplicate wire destination ${target}`);
  targets.add(target);
}

const owners = saved.r.owners();
const gearsharkOwner = owners.UserNames.indexOf('Gearshark');
const publicOwner = owners.UserNames.indexOf('PUBLIC');
assert(gearsharkOwner >= 0, 'Gearshark owner record');
assert.equal(owners.BrickCounts[gearsharkOwner], saved.bricks.length,
  'Every output brick should be owned by Gearshark');
assert.equal(owners.EntityCounts[gearsharkOwner], [...saved.r.entities()].length,
  'Every output entity should be owned by Gearshark');
if (publicOwner >= 0) {
  assert.equal(owners.BrickCounts[publicOwner], 0, 'PUBLIC owns no bricks');
  assert.equal(owners.EntityCounts[publicOwner], 0, 'PUBLIC owns no entities');
}

console.log(JSON.stringify({
  strictPlacement: result.placement.strictOk,
  bricks: saved.bricks.length,
  wires: saved.edges.length,
  nativeControlBusTargets: controlBus.length,
  tuningValues: all(C.Var.NAME).length,
  clocks: all(C.Clock.NAME).length,
  owner: owners.UserNames[gearsharkOwner],
  sha256: result.summary.sha256,
}, null, 2));
