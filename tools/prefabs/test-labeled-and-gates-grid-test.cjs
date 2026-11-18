'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');
const {
  X_POSITIONS, ROW_Y, HEADER_POSITION, HEADER_SIZE, HEADER_TEXT,
  FONT_ASSETS,
} = require('./build-labeled-and-gates-grid-test.cjs');

const DEFAULT_OUTPUT = path.join(__dirname, '../../outputs/labeled-and-gates-grid-test.brz');
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function component(brick, type) {
  return brick.comps.find(saved => saved.type === type);
}

function test({ output = DEFAULT_OUTPUT } = {}) {
  const bytes = fs.readFileSync(output);
  const scene = read(bytes);
  assert.deepEqual(scene.r.externalAssets(), [...FONT_ASSETS],
    'Text display font asset is embedded in the prefab asset table');
  const gates = scene.bricks.filter(brick => component(brick, C.Expr_LogicalAND.NAME))
    .sort((a, b) => a.data.position[0] - b.data.position[0]);
  const headers = scene.bricks.filter(brick => component(brick, C.TextDisplay.NAME));

  assert.equal(gates.length, 5, 'Exactly five AND gates');
  assert.equal(headers.length, 1, 'Exactly one header');
  assert.deepEqual(gates.map(gate => gate.data.position[0]), [...X_POSITIONS], 'Exact gate X positions');
  assert(gates.every(gate => gate.data.position[1] === ROW_Y && gate.data.position[2] === 2),
    'Every gate shares the exact row Y/Z');
  assert(gates.every(gate => {
    const data = component(gate, C.Expr_LogicalAND.NAME).data;
    return data.bInputA === false && data.bInputB === false;
  }), 'Every AND gate starts with both Boolean inputs false');
  assert(gates.every(gate => mod(gate.data.position[0], 10) === 5
    && mod(gate.data.position[1], 10) === 5), 'Every gate center is on the microchip cell center');

  const distances = gates.slice(1).map((gate, index) =>
    gate.data.position[0] - gates[index].data.position[0]);
  assert.deepEqual(distances, [10, 10, 10, 10], 'Neighboring gates touch with no gap');

  const header = headers[0];
  const headerComponent = component(header, C.TextDisplay.NAME);
  assert.deepEqual(header.data.position, [...HEADER_POSITION], 'Header position');
  assert.deepEqual(header.data.size, [...HEADER_SIZE], 'Header half-extents');
  assert.equal(headerComponent.data.Text, HEADER_TEXT, 'Header text');
  assert.equal(headerComponent.data.Font, 0, 'Header uses the embedded font at asset index zero');
  assert(headerComponent.data.Font >= 0
    && headerComponent.data.Font < scene.r.externalAssets().length,
    'Header font index resolves inside the external asset table');
  assert.equal(headerComponent.data.LineHeight, 5, 'Large readable header text');
  assert.deepEqual(headerComponent.data.Anchor, { X: 0.5, Y: 0.5 }, 'Centered header text');

  const gateLeft = gates[0].data.position[0] - 5;
  const gateRight = gates.at(-1).data.position[0] + 5;
  const headerLeft = header.data.position[0] - header.data.size[0];
  const headerRight = header.data.position[0] + header.data.size[0];
  assert.equal(headerLeft, gateLeft, 'Header left edge exactly matches gate row');
  assert.equal(headerRight, gateRight, 'Header right edge exactly matches gate row');
  assert.equal(header.data.position[1] - header.data.size[1], ROW_Y + 5,
    'Header directly touches the top edge of the gates');

  assert.equal(new Set([...gates, header].map(brick => brick.g)).size, 1,
    'Header and gates share one microchip');
  assert.equal(scene.bricks.filter(brick => brick.g === gates[0].g).length, 6,
    'Only the header and five gates are inside the microchip');
  assert.equal(scene.edges.length, 0, 'No wires');
  assert.equal(scene.links.length, 1, 'One physical microchip link');

  const owners = scene.r.owners();
  const ownerIndex = owners.UserNames.indexOf('Gearshark');
  assert(ownerIndex >= 0, 'Gearshark owner is present');
  assert.notEqual(brdb.guidToUuid(owners.UserIds[ownerIndex]),
    'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Owner is not PUBLIC');
  const entities = [...scene.r.entities()];
  assert.equal(entities.length, 1, 'Exactly one microchip dynamic-grid entity');
  assert.equal(entities[0].ownerIndex, ownerIndex, 'Microchip plane current owner is Gearshark');
  assert.equal(entities[0].originalOwnerIndex, ownerIndex, 'Microchip plane original owner is Gearshark');
  for (const grid of scene.r.gridIds()) for (const chunk of scene.r.brickChunkIndex(grid)) {
    const soa = scene.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === ownerIndex), `Grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === ownerIndex), `Grid ${grid} original owner`);
  }

  const placement = validate(bytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  console.log(JSON.stringify({
    output,
    gateCenters: gates.map(gate => gate.data.position),
    centerDistances: distances,
    headerBounds: { x: [headerLeft, headerRight], y: [0, 20] },
    gridAligned: true,
    strictPlacement: placement.strictOk,
    checks: 'passed',
  }, null, 2));
  return { scene, gates, header, placement };
}

if (require.main === module) test({ output: process.argv[2] || DEFAULT_OUTPUT });

module.exports = test;
