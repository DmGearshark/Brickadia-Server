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
  assert.equal(incoming(engine, 'ManualInput_Drive').length, 1,
    `${label} engine has one exclusive drive source`);
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

// The finished controller is deliberately the exact eight-gate analog mixer:
//   scale = 1 - 0.5 * abs(F)
//   turn  = R * scale
//   left  = clamp(F + turn, -1, 1)
//   right = clamp(F - turn, -1, 1)
const absRows = all(C.Expr_MathAbs.NAME);
const multiplyRows = all(C.Expr_MathMultiply.NAME);
const subtractRows = all(C.Expr_MathSubtract.NAME);
const addRows = all(C.Expr_MathAdd.NAME);
const clampRows = all(C.Expr_MathClamp.NAME);
assert.equal(absRows.length, 1, 'One abs gate');
assert.equal(multiplyRows.length, 2, 'Half-scale and turn multiply gates');
assert.equal(subtractRows.length, 2, 'Turn-scale and right-output subtract gates');
assert.equal(addRows.length, 1, 'One left-output add gate');
assert.equal(clampRows.length, 2, 'Two track-output clamps');
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
assert.equal(all(C.MicrochipInput.NAME).length, 1,
  'One driver-character microchip input');
assert.equal(all(C.MicrochipOutput.NAME).length, 2,
  'Only left and right track outputs remain');
assert.equal(leftOutput.component.type, C.MicrochipOutput.NAME);
assert.equal(leftOutput.component.data.PortLabel, 'Left Track Drive');
assert.equal(leftOutput.component.data.PortOrder, 1);
assert.equal(rightOutput.component.type, C.MicrochipOutput.NAME);
assert.equal(rightOutput.component.data.PortLabel, 'Right Track Drive');
assert.equal(rightOutput.component.data.PortOrder, 2);
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
assert.equal(leftTurn.component.type, C.Expr_MathMultiply.NAME);
assertSource(leftTurn, 'InputA', splitter, 'InputRight', 'R enters turn multiply');

const turnScale = sourceOf(one(incoming(leftTurn, 'InputB'), 'turn scale input'));
assert.equal(turnScale.component.type, C.Expr_MathSubtract.NAME);
assert.equal(numeric(turnScale.component.data.InputA), 1, 'Turn scale begins at one');
const halfAbs = sourceOf(one(incoming(turnScale, 'InputB'), 'half abs input'));
assert.equal(halfAbs.component.type, C.Expr_MathMultiply.NAME);
const abs = one(absRows, 'forward absolute value');
const halfAbsSources = [
  ...incoming(halfAbs, 'InputA').map(edge => ({port: 'InputA', row: sourceOf(edge)})),
  ...incoming(halfAbs, 'InputB').map(edge => ({port: 'InputB', row: sourceOf(edge)})),
];
assert.equal(halfAbsSources.length, 1, 'Half-abs multiply has one wired input');
assert(sameNode(halfAbsSources[0].row, abs), 'Half-abs multiply receives abs(F)');
const constantPort = halfAbsSources[0].port === 'InputA' ? 'InputB' : 'InputA';
assert.equal(numeric(halfAbs.component.data[constantPort]), 0.5,
  'Forward input reduces turn authority by one half');
assertSource(abs, 'Input', splitter, 'InputForward', 'F enters abs gate');

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
function mix(forward, right) {
  const scale = 1 - 0.5 * Math.abs(forward);
  const turn = right * scale;
  return [clamp(forward + turn), clamp(forward - turn)];
}
const truthTable = [
  ['NONE', 0, 0, 0, 0],
  ['W', 1, 0, 1, 1],
  ['S', -1, 0, -1, -1],
  ['A', 0, -1, -1, 1],
  ['D', 0, 1, 1, -1],
  ['W+A', 1, -1, 0.5, 1],
  ['W+D', 1, 1, 1, 0.5],
  ['S+A', -1, -1, -1, -0.5],
  ['S+D', -1, 1, -0.5, -1],
  ['W+S / A+D', 0, 0, 0, 0],
];
for (const [label, forward, right, expectedLeft, expectedRight] of truthTable) {
  const [left, rightOutput] = mix(forward, right);
  assert(Math.abs(left - expectedLeft) < 1e-12,
    `${label}: left expected ${expectedLeft}, got ${left}`);
  assert(Math.abs(rightOutput - expectedRight) < 1e-12,
    `${label}: right expected ${expectedRight}, got ${rightOutput}`);
}

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
  mixerGates: 8,
  leftTrackWheels: leftWheels.length,
  rightTrackWheels: rightWheels.length,
  truthTableCases: truthTable.length,
  owner: owners.UserNames[gearshark],
}, null, 2));
