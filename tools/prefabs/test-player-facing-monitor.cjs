'use strict';

const fs = require('fs');
const path = require('path');
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
  bearing: 'Component_Internal_RigidBearing',
  variable: 'BrickComponentType_Var',
  sweep: 'BrickComponentType_Exec_Sweep',
  text: 'Component_TextDisplay',
};

const [outputPath = '/workspace/outputs/Monitor - Closest Player Tracker.brz',
  sourcePath = '/workspace/attachments/3f9989cf-7e81-46a9-b4aa-e2d5df5a2342/Monitor that faces cloest player.brz'] =
  process.argv.slice(2);
const outputBytes = fs.readFileSync(outputPath);
const output = read(outputBytes);
const source = read(fs.readFileSync(sourcePath));
const all = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(comp => comp.type === type)
  .map(comp => ({brick, comp})));
const one = (items, label) => {
  assert.equal(items.length, 1, `Expected one ${label}, found ${items.length}`);
  return items[0];
};

const byKey = new Map(output.bricks.map(brick => [brick.key, brick]));
const driven = new Set();
for (const edge of output.edges) {
  const sourceBrick = byKey.get(edge.a);
  const targetBrick = byKey.get(edge.z);
  assert(sourceBrick && targetBrick, `Dangling wire ${JSON.stringify(edge)}`);
  assert(sourceBrick.comps.some(comp => comp.type === edge.at));
  assert(targetBrick.comps.some(comp => comp.type === edge.zt));
  assert(b.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
    `Invalid output ${edge.at}.${edge.p}`);
  assert(b.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
    `Invalid input ${edge.zt}.${edge.q}`);
  const destination = `${edge.z}|${edge.zt}|${edge.q}`;
  assert(!driven.has(destination), `Duplicate driver ${destination}`);
  driven.add(destination);
}
assertNoInstantCycles(output);

assert.equal(output.links.length, 1);
const link = output.links[0];
const shell = one(output.bricks.filter(brick => brick.key === link.key), 'microchip shell');
assert(shell.comps.some(comp => comp.type === T.microchip));
const sourceBearing = one(all(source, T.bearing), 'source bearing');
const bearing = one(all(output, T.bearing), 'output bearing');
assert.deepEqual(bearing.brick.data, sourceBearing.brick.data, 'Bearing brick changed');
assert.deepEqual(bearing.comp.data, sourceBearing.comp.data, 'Bearing settings changed');
const sourceEntities = [...source.r.entities()];
const outputEntities = [...output.r.entities()];
assert.equal(outputEntities.length, sourceEntities.length);
const gridMap = new Map([[1, 1]]);
for (const entity of sourceEntities) {
  const match = one(outputEntities.filter(candidate => candidate.typeName === entity.typeName
    && JSON.stringify(candidate.location) === JSON.stringify(entity.location)
    && JSON.stringify(candidate.rotation) === JSON.stringify(entity.rotation)),
  `mapped ${entity.typeName}`);
  gridMap.set(entity.persistentIndex, match.persistentIndex);
  if (entity.typeName !== 'Entity_MicrochipDynamicBrickGrid') {
    assert.deepEqual(match.data, entity.data, `${entity.typeName} data changed`);
  }
}
assert.equal(output.joints.length, source.joints.length);
for (const joint of source.joints) {
  const actual = one(output.joints.filter(candidate => candidate.key === joint.key),
    `joint ${joint.key}`);
  assert.deepEqual(actual, {...joint, entity: gridMap.get(joint.entity)},
    'Rigid-bearing joint changed');
}
const bearingJoint = one(output.joints.filter(joint => joint.key === bearing.brick.key),
  'bearing joint');
const monitorGrid = bearingJoint.entity;

// Every supplied physical brick is exact; additions are the hidden grid reader
// and the populated microchip plane.
for (const brick of source.bricks) {
  const match = output.bricks.find(candidate => candidate.g === gridMap.get(brick.g)
    && candidate.data.asset === brick.data.asset
    && candidate.data.position.join(',') === brick.data.position.join(',')
    && candidate.comps.map(comp => comp.type).join('|')
      === brick.comps.map(comp => comp.type).join('|'));
  assert(match, `Missing supplied brick ${brick.key}`);
  assert.deepEqual(match.data, brick.data, `Supplied brick changed ${brick.key}`);
  assert.deepEqual(match.comps, brick.comps, `Supplied component changed ${brick.key}`);
}

const inputs = new Map(all(output, T.input).map(item => [item.comp.data.PortLabel, item]));
const outputs = new Map(all(output, T.output).map(item => [item.comp.data.PortLabel, item]));
assert.deepEqual([...inputs.keys()].sort(), ['CurrentAngle', 'Monitor']);
assert.deepEqual([...outputs.keys()], ['Bearing Angle']);

const monitorReader = one(all(output, T.readGrid)
  .filter(({brick}) => brick.g === monitorGrid), 'monitor-grid reader');
assert.equal(monitorReader.brick.data.visibility, false);
assert.equal(monitorReader.brick.data.collision.physics, false);
const monitorPin = inputs.get('Monitor');
assert.deepEqual(output.edges.filter(edge => edge.z === monitorPin.brick.key
  && edge.zt === T.input && edge.q === 'RER_Input'), [{
  a: monitorReader.brick.key, at: T.readGrid, p: 'BrickGrid',
  z: monitorPin.brick.key, zt: T.input, q: 'RER_Input',
}]);

const anglePin = inputs.get('CurrentAngle');
assert.deepEqual(output.edges.filter(edge => edge.z === anglePin.brick.key
  && edge.zt === T.input && edge.q === 'RER_Input'), [{
  a: bearing.brick.key, at: T.bearing, p: 'CurrentAngle',
  z: anglePin.brick.key, zt: T.input, q: 'RER_Input',
}]);
const bearingOutput = outputs.get('Bearing Angle');
assert.deepEqual(output.edges.filter(edge => edge.z === bearing.brick.key
  && edge.zt === T.bearing && edge.q === 'TargetAngle'), [{
  a: bearingOutput.brick.key, at: T.output, p: 'RER_Output',
  z: bearing.brick.key, zt: T.bearing, q: 'TargetAngle',
}]);

const sweep = one(all(output, T.sweep), 'closest-player sweep');
assert.equal(sweep.comp.data.Distance, 1);
assert.equal(sweep.comp.data.bIgnoreOwningGrid, true);
assert.equal(sweep.comp.data.bDetectBricks, false);
assert.equal(sweep.comp.data.bDetectPhysics, false);
assert.equal(sweep.comp.data.bDetectMap, false);
for (const team of [1, 2, 3, 4]) assert.equal(sweep.comp.data[`bDetectPlayers${team}`], true);
assert.equal(output.edges.filter(edge => edge.z === sweep.brick.key
  && edge.zt === T.sweep && edge.q === 'Radius').length, 1,
'Sweep radius is not driven by editable range math');
assert.equal(output.edges.filter(edge => edge.z === sweep.brick.key
  && edge.zt === T.sweep && edge.q === 'IgnoreEntity'
  && edge.a === monitorPin.brick.key && edge.at === T.input
  && edge.p === 'RER_Output').length, 1, 'Sweep does not ignore monitor grid');

const rangeVar = one(all(output, T.variable).filter(({comp}) =>
  comp.data.Value?.$variant === 'f64' && comp.data.Value.value === 15),
'15-block range variable');
assert.deepEqual(rangeVar.brick.data.color, [65, 220, 110]);
const note = one(all(output, T.text).filter(({comp}) =>
  comp.data.Text === 'TRACKING RANGE (BLOCKS)\nEDIT GREEN VARIABLE\nDEFAULT: 15'),
'range instruction note');
assert.equal(note.brick.g, link.grid);

const sourceCode = fs.readFileSync(path.join(__dirname, 'player-facing-monitor-brain.ws'), 'utf8');
assert.match(sourceCode, /var trackingRangeBlocks: float = 15\.0/);
assert.match(sourceCode, /radius = trackingRangeBlocks \* 10\.0/);
assert.match(sourceCode, /CurrentAngle - signedRadians \* 57\.2958/);
assert.match(sourceCode, /fmod\(rawAngle \+ 180\.0, 360\.0\) - 180\.0/);

const placement = validatePlacement(outputBytes);
assert.equal(placement.strictOk, true, JSON.stringify(placement));
assert.equal(placement.invalidBricks.length, 0);
assert.equal(placement.confirmedPairs.length, 0);
assert.equal(placement.uncertainPairs.length, 0);
assert.equal(placement.warnings.length, 0);

console.log(JSON.stringify({
  monitor: 'passed',
  output: outputPath,
  bricks: output.bricks.length,
  wires: output.edges.length,
  rangeBlocks: 15,
  bearingOutput: 'Bearing Angle',
  placementWarnings: placement.warnings.length,
}, null, 2));
