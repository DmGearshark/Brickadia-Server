'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { WorldReader, brdb } = require('brs-js');
const { Build, C, B } = require('./loadboard-lib.cjs');

const OUTPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/five-and-gates-row.brz'));
const OWNER_SOURCE = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v7.brz');
const X_POSITIONS = Object.freeze([-96, -48, 0, 48, 96]);

function gearsharkOwner() {
  const reader = WorldReader.from(fs.readFileSync(OWNER_SOURCE));
  const owners = reader.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Gearshark owner source');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function build() {
  const buildContext = new Build('Five AND Gates - Straight Row');
  const owner = gearsharkOwner();
  const ownerIndex = buildContext.w.addOwner(owner);
  const chip = buildContext.w.addMicrochip({
    position: [0, 0, 2],
    color: [55, 115, 190],
    owner_index: ownerIndex,
    planeExtent: { X: 125, Y: 30, Z: 8 },
    collapsed: false,
  });
  const definition = C.Expr_LogicalAND;
  const gates = X_POSITIONS.map((x, index) => {
    const position = [x, 0, 2];
    const node = {
      id: `and_row_${index}`,
      type: definition.NAME,
      data: { bInputA: B(false), bInputB: B(false) },
      pos: position,
      grid: chip.grid,
    };
    buildContext.add(node, {
      asset: definition.BRICK,
      position,
      color: [50, 110, 170],
      owner_index: ownerIndex,
      components: [{ type: node.type, data: node.data }],
    }, chip.grid);
    return node;
  });
  const bytes = buildContext.finish(
    { x: 12, y: 12, z: 12 },
    'Layout calibration prefab containing exactly five unwired AND gates at equal spacing on one horizontal row.',
  );
  return { bytes, buildContext, chip, gates, positions: X_POSITIONS, owner };
}

module.exports = build;
module.exports.X_POSITIONS = X_POSITIONS;

if (require.main === module) {
  const context = build();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, context.bytes);
  require('./test-five-and-gates-row.cjs')({ output: OUTPUT });
  console.log(JSON.stringify({
    output: OUTPUT,
    gates: context.gates.length,
    positions: context.gates.map(gate => gate.pos),
    wires: context.buildContext.edges.length,
  }, null, 2));
}
