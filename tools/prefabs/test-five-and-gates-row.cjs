'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');
const { X_POSITIONS } = require('./build-five-and-gates-row.cjs');

const DEFAULT_OUTPUT = path.join(__dirname, '../../outputs/five-and-gates-row.brz');

function test({ output = DEFAULT_OUTPUT } = {}) {
  const bytes = fs.readFileSync(output);
  const scene = read(bytes);
  const gates = scene.bricks.filter(brick => brick.comps.some(component =>
    component.type === C.Expr_LogicalAND.NAME));
  assert.equal(gates.length, 5, 'Exactly five AND gates');
  assert.deepEqual(gates.map(gate => gate.data.position[0]).sort((a, b) => a - b),
    [...X_POSITIONS], 'Equal X positions');
  assert(gates.every(gate => gate.data.position[1] === 0), 'Every gate has the same Y coordinate');
  assert(gates.every(gate => gate.data.position[2] === 2), 'Every gate has the same Z coordinate');
  assert.equal(new Set(gates.map(gate => gate.g)).size, 1, 'Every gate is in the same microchip');
  assert(gates.every(gate => gate.data.direction === gates[0].data.direction
    && gate.data.rotation === gates[0].data.rotation), 'Every gate has identical orientation');
  assert.equal(scene.edges.length, 0, 'No wires');
  assert.equal(scene.links.length, 1, 'One physical microchip links to the gate plane');
  const nonGateInnerBricks = scene.bricks.filter(brick => brick.g === gates[0].g
    && !brick.comps.some(component => component.type === C.Expr_LogicalAND.NAME));
  assert.equal(nonGateInnerBricks.length, 0, 'Nothing else is inside the microchip');
  const owners = scene.r.owners();
  const ownerIndex = owners.UserNames.indexOf('Gearshark');
  assert(ownerIndex >= 0, 'Gearshark owner is present');
  assert.notEqual(brdb.guidToUuid(owners.UserIds[ownerIndex]),
    'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Owner is not PUBLIC');
  for (const grid of scene.r.gridIds()) for (const chunk of scene.r.brickChunkIndex(grid)) {
    const soa = scene.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === ownerIndex), `Grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === ownerIndex), `Grid ${grid} original owner`);
  }
  const placement = validate(bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  console.log(JSON.stringify({
    output,
    andGates: gates.length,
    row: gates.map(gate => gate.data.position).sort((a, b) => a[0] - b[0]),
    wires: scene.edges.length,
    strictPlacement: placement.strictOk,
    checks: 'passed',
  }, null, 2));
  return { scene, gates, placement };
}

if (require.main === module) test({ output: process.argv[2] || DEFAULT_OUTPUT });

module.exports = test;
