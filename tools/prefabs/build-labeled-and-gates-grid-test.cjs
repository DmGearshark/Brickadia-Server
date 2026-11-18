'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { WorldReader, brdb } = require('brs-js');
const { Build, C } = require('./loadboard-lib.cjs');

const OUTPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/labeled-and-gates-grid-test.brz'));
const OWNER_SOURCE = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v7.brz');
const X_POSITIONS = Object.freeze([-35, -25, -15, -5, 5]);
const ROW_Y = -5;
const HEADER_POSITION = Object.freeze([-15, 10, 2]);
const HEADER_SIZE = Object.freeze([25, 10, 2]);
const HEADER_TEXT = 'AND GATE ROW\r\nTOUCHING + ON GRID';

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
  const context = new Build('Labeled AND Gate Grid Test');
  const owner = gearsharkOwner();
  const ownerIndex = context.w.addOwner(owner);
  const chip = context.w.addMicrochip({
    position: [0, 0, 2],
    color: [235, 230, 245],
    owner_index: ownerIndex,
    planeExtent: { X: 30, Y: 20, Z: 0 },
    collapsed: false,
  });

  // The module spans X -40..10 and Y -10..20. The plane leaves a five-unit
  // margin around it while keeping every edge on the microchip grid.
  const chipEntity = context.w.entityInputs[chip.grid.entityOrder];
  chipEntity.owner_index = ownerIndex;
  chipEntity.original_owner_index = ownerIndex;
  chipEntity.data.PlaneCenter = { X: -15, Y: 5, Z: 0 };

  const headerData = {
    Text: HEADER_TEXT,
    Font: 0,
    Rotation: 90,
    Skew: 0,
    Kerning: 0,
    LineHeight: 5,
    WidthScale: 1,
    LineOffset: 0,
    Anchor: { X: 0.5, Y: 0.5 },
    Offset: { X: 0, Y: 0, Z: 0 },
    Color: { B: 255, G: 255, R: 255, A: 255 },
    MaterialSlider: 10,
    ShadingWidth: 2,
    OutlineColor: { B: 0, G: 0, R: 0, A: 255 },
    OutlineWidth: 2,
    ScuffWidth: 0,
    GraffitiDepthLimit: 5,
    GraffitiAngleLimit: 45,
    GraffitiLayer: 0,
    bEnabled: true,
    Face: 4,
    bAlignToWedge: false,
    bOverrideColor: true,
    Typeface: 0,
    Billboard: 0,
    Material: 2,
    Shading: 0,
    bFlipShading: false,
    Outline: 2,
    bSharpCorners: true,
    bSharpOutlines: true,
    bOverrideOutlineColor: true,
    bForeground: false,
  };
  const header = {
    id: 'and_row_header',
    type: C.TextDisplay.NAME,
    data: headerData,
    pos: [...HEADER_POSITION],
    grid: chip.grid,
  };
  context.add(header, {
    asset: 'PB_DefaultMicroBrick',
    size: [...HEADER_SIZE],
    position: [...HEADER_POSITION],
    direction: 4,
    rotation: 0,
    color: [0, 0, 0],
    material: 'BMC_Glow',
    material_intensity: 0,
    owner_index: ownerIndex,
    components: [{ type: header.type, data: header.data }],
  }, chip.grid);

  const definition = C.Expr_LogicalAND;
  const gates = X_POSITIONS.map((x, index) => {
    const position = [x, ROW_Y, 2];
    const node = {
      id: `and_gate_${index + 1}`,
      type: definition.NAME,
      data: { bInputA: false, bInputB: false },
      pos: position,
      grid: chip.grid,
    };
    context.add(node, {
      asset: definition.BRICK,
      position,
      direction: 4,
      rotation: 0,
      color: [255, 255, 255],
      material: 'BMC_Plastic',
      material_intensity: 5,
      owner_index: ownerIndex,
      components: [{ type: node.type, data: node.data }],
    }, chip.grid);
    return node;
  });

  const bytes = context.finish(
    { x: 12, y: 12, z: 12 },
    'Five touching, grid-aligned AND gates beneath an exact-width attached header.',
  );
  return { bytes, context, chip, header, gates, owner };
}

module.exports = build;
module.exports.X_POSITIONS = X_POSITIONS;
module.exports.ROW_Y = ROW_Y;
module.exports.HEADER_POSITION = HEADER_POSITION;
module.exports.HEADER_SIZE = HEADER_SIZE;
module.exports.HEADER_TEXT = HEADER_TEXT;

if (require.main === module) {
  const result = build();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  require('./test-labeled-and-gates-grid-test.cjs')({ output: OUTPUT });
  console.log(JSON.stringify({
    output: OUTPUT,
    header: { position: result.header.pos, size: HEADER_SIZE, text: HEADER_TEXT },
    gates: result.gates.map(gate => gate.pos),
    wires: result.context.edges.length,
  }, null, 2));
}
