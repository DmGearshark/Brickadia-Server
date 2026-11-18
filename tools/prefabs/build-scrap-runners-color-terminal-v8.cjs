'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');
const nativeBounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v8.brz'));

const clone = value => structuredClone(value);
const COLORS = Object.freeze({
  black: [0, 0, 0], interface: [70, 175, 220], selection: [235, 145, 55],
  hue: [235, 100, 65], saturation: [80, 190, 105], brightness: [230, 205, 70],
  material: [165, 105, 220], intensity: [75, 135, 230], conversion: [55, 180, 175],
  hex: [80, 135, 220], preview: [220, 90, 190], audio: [220, 175, 60],
  zone: [70, 185, 225], purchase: [235, 150, 55], restore: [205, 130, 50],
  session: [55, 180, 150], vehicle: [65, 125, 220], saved: [145, 95, 215],
  response: [225, 75, 75], config: [105, 190, 225], output: [215, 95, 105],
  display: [110, 190, 120],
});

const TERMINAL_CARDS = Object.freeze([
  { name: 'zone', title: 'ZONE\r\nVEHICLE', x: 0, y: 0, color: COLORS.zone, lineHeight: 3.2,
    rows: [[51], [18, 36], [17, 40, 34]] },
  { name: 'preview', title: 'LIVE\r\nPREVIEW', x: 50, y: 0, color: COLORS.preview, lineHeight: 4,
    rows: [[100, 37, 70, 19, 0]] },
  { name: 'purchase', title: 'PURCHASE\r\n+ SAVE', x: 120, y: 0, color: COLORS.purchase, lineHeight: 4.5,
    rows: [[20, 38, 71, 21, 118, 109], [5, 6, 22, 23, 3, 4], [78, 77, 48]] },
  { name: 'exit', title: 'EXIT\r\nRESTORE', x: 200, y: 0, color: COLORS.restore, lineHeight: 2.5,
    rows: [[1, 2]] },
  { name: 'rgb_score', title: 'RGB SCORE\r\nENCODER', x: 120, y: -80, color: COLORS.conversion, lineHeight: 4,
    rows: [[41, 49, 50, 67, 68]] },
  { name: 'session', title: 'USER\r\nSESSION', x: 0, y: -100, color: COLORS.session, lineHeight: 4.5,
    rows: [[54, 55, 56, 57, 58], [76, 103, 24, 80, 110], [81, 108, 82, 107, 83],
      [104, 7, 84, 85, 25], [86, 87, 88, 89, 90, 91]] },
  { name: 'vehicle', title: 'VEHICLE\r\nDATA', x: 70, y: -100, color: COLORS.vehicle, lineHeight: 4,
    rows: [[59, 60, 61], [105, 92, 93, 94, 39], [72, 26, 15, 16, 73], [27, 95, 96, 97, 28]] },
  { name: 'saved', title: 'SAVED COLOR\r\n+ DISPLAY', x: 0, y: -230, color: COLORS.saved, lineHeight: 3.8,
    rows: [[62], [106, 98, 8, 99, 29], [64, 63, 65, 66, 52], [53, 69, 79, 30, 33],
      [31, 42, 32, 35], [74, 75, 43, 44, 45], [46, 47]] },
  { name: 'response', title: 'SYSTEM\r\nRESPONSE', x: 70, y: -230, color: COLORS.response, lineHeight: 4.2,
    rows: [[112, 113, 114, 115, 116, 117], [119, 101, 102], [120, 121, 122, 123, 124],
      [125, 126, 127, 128, 129, 130], [131, 132, 133, 134, 135, 136], [137, 138]] },
]);

const CONFIG_CARDS = Object.freeze([
  { name: 'sounds', title: 'SOUNDS +\r\nVOLUME', x: 0, y: 0, color: COLORS.audio, lineHeight: 4,
    rows: [[13, 0, 14, 1, 15, 2]] },
  { name: 'settings', title: 'SETTINGS', x: 80, y: 0, color: COLORS.config, lineHeight: 2.5,
    rows: [[17, 16]] },
  { name: 'core', title: 'CORE', x: 120, y: 0, color: COLORS.interface, lineHeight: 2.5,
    rows: [[18]] },
  { name: 'outputs', title: 'OUTPUTS', x: 150, y: 0, color: COLORS.output, lineHeight: 4.2,
    rows: [[23, 22, 21, 20, 19]] },
  { name: 'row_text', title: 'ROW TEXT FORMATTERS', x: 0, y: -60, color: COLORS.display, lineHeight: 5,
    rows: [[3, 4, 5, 6, 7]] },
  { name: 'purchase_text', title: 'PURCHASE\r\nTEXT', x: 110, y: -60, color: COLORS.purchase, lineHeight: 3.5,
    rows: [[8, 11, 12]] },
  { name: 'screen_text', title: 'SCREEN\r\nTEXT', x: 180, y: -60, color: COLORS.display, lineHeight: 3,
    rows: [[9, 10]] },
]);

const CORE_CARDS = Object.freeze([
  { name: 'input', title: 'INPUT +\r\nSELECTION', x: 0, y: 200, color: COLORS.interface, lineHeight: 4,
    rows: [[126, 3, 127], [112, 186, 179, 146, 103, 210], [184, 180, 147, 104, 211],
      [185, 181, 213], [187, 182, 215], [89, 212, 118, 90, 4], [91, 214, 119, 92, 5],
      [128, 129, 251, 0]] },
  { name: 'hue', title: 'HUE', x: 80, y: 200, color: COLORS.hue, lineHeight: 5,
    rows: [[113, 188, 65, 83, 70], [6, 148, 105, 216], [10, 152, 106, 220],
      [14, 156, 107, 224], [18, 160, 108, 228]] },
  { name: 'saturation', title: 'SATURATION', x: 150, y: 200, color: COLORS.saturation, lineHeight: 3.7,
    rows: [[114, 189, 66, 84, 71], [7, 149, 134, 217], [11, 153, 137, 221],
      [15, 157, 140, 225], [19, 161, 143, 229]] },
  { name: 'brightness', title: 'BRIGHTNESS', x: 220, y: 200, color: COLORS.brightness, lineHeight: 3.5,
    rows: [[115, 190, 67, 85, 72], [8, 150, 135, 218], [12, 154, 138, 222],
      [16, 158, 141, 226], [20, 162, 144, 230]] },
  { name: 'material', title: 'MATERIAL', x: 290, y: 200, color: COLORS.material, lineHeight: 4,
    rows: [[116, 191, 68, 73, 124], [22, 164, 109, 232], [23, 165, 110, 233], [202],
      [203, 75, 204, 76, 205], [78, 206, 79, 207, 80]] },
  { name: 'intensity', title: 'INTENSITY', x: 360, y: 200, color: COLORS.intensity, lineHeight: 3.8,
    rows: [[117, 192, 69, 102, 74], [9, 151, 136, 219], [13, 155, 139, 223],
      [17, 159, 142, 227], [21, 163, 145, 231], [101, 82, 125]] },
  { name: 'conversion', title: 'HSB > RGB', x: 430, y: 200, color: COLORS.conversion, lineHeight: 4,
    rows: [[120, 121, 94], [122, 111, 86, 169, 87, 95], [88], [178, 193, 194, 195, 196, 197, 198],
      [48, 49, 50, 51, 52, 166, 96], [53, 54, 55, 56, 57, 167, 97],
      [58, 59, 60, 61, 62, 168, 98], [170, 123], [208, 28, 39, 36, 64, 37]] },
  { name: 'buy', title: 'BUY', x: 0, y: 0, color: COLORS.purchase, lineHeight: 3.5,
    rows: [[201, 77, 81]] },
  { name: 'preview', title: 'LIVE PREVIEW', x: 50, y: 0, color: COLORS.preview, lineHeight: 4.5,
    rows: [[237, 238, 239, 240, 241, 242, 243, 244], [245, 246, 247, 248, 249, 250, 93]] },
  { name: 'sounds', title: 'TAP + REPEAT SOUNDS', x: 150, y: 0, color: COLORS.audio, lineHeight: 4.5,
    rows: [[130, 131, 252, 253, 254, 255, 256, 257], [258, 259, 260, 1],
      [132, 133, 261, 262, 263, 264, 265, 266], [267, 2]] },
  { name: 'hex_input', title: 'HEX INPUT', x: 250, y: 0, color: COLORS.hex, lineHeight: 4,
    rows: [[183, 270, 268], [271, 199, 24], [26, 27, 38, 29, 63], [40, 200]] },
  { name: 'char_checks', title: 'CHAR\r\nCHECKS', x: 320, y: 0, color: COLORS.hex, lineHeight: 2.8,
    rows: [[30, 41], [31, 42], [32, 43], [33, 44], [34, 45], [35, 46]] },
  { name: 'hex_apply', title: 'HEX APPLY', x: 360, y: 0, color: COLORS.hex, lineHeight: 4,
    rows: [[172, 173, 174, 175, 176, 177], [25], [171, 209, 47], [234], [99, 235], [100, 236], [269]] },
]);

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Gearshark owner is present');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function component(brick, type) {
  const result = brick?.comps.find(item => item.type === type);
  assert(result, `Missing ${type} on ${brick?.key || 'unknown brick'}`);
  return result;
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  const result = nativeBounds.assets[brick.data.asset];
  assert(result, `Missing native bounds for ${brick.data.asset}`);
  assert.equal(brick.data.direction, 4, `${brick.data.asset} direction`);
  assert.equal(brick.data.rotation, 0, `${brick.data.asset} rotation`);
  return result;
}

function fitPlane(scene, grid, margin = 10) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity, `Missing grid entity ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const min = [0, 1].map(axis => Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis])));
  const max = [0, 1].map(axis => Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis])));
  const override = clone(entity);
  override.data = clone(entity.data);
  override.data.bCollapsed = true;
  override.data.PlaneCenter = {
    X: (min[0] + max[0]) / 2,
    Y: (min[1] + max[1]) / 2,
    Z: 0,
  };
  override.data.PlaneExtent = {
    X: (max[0] - min[0]) / 2 + margin,
    Y: (max[1] - min[1]) / 2 + margin,
    Z: 0,
  };
  scene.entityOverrides.set(grid, override);
  return {
    bounds: { min, max },
    center: clone(override.data.PlaneCenter),
    extent: clone(override.data.PlaneExtent),
  };
}

function build(input = INPUT, output = OUTPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  const owner = ownerFrom(scene);
  const originalBricks = new Map(scene.bricks.map(brick => [brick.key, clone(brick)]));
  const originalEdges = clone(scene.edges);
  const originalLinks = clone(scene.links);
  const originalJoints = clone(scene.joints || []);
  const originalAssets = clone(scene.r.externalAssets());
  const rows = () => scene.bricks.flatMap(brick =>
    brick.comps.map(savedComponent => ({ brick, savedComponent })));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(
    rows().filter(item => item.savedComponent.type === type
      && predicate(item.savedComponent.data, item.brick)), label,
  );

  const terminalGrid = row(C.EntityZoneEvent_Entered.NAME, () => true, 'vehicle zone entry').brick.g;
  const configFormatter = row(C.Expr_String_FormatText.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.FormatString), 'session formatter');
  const configGrid = configFormatter.brick.g;
  const coreChip = row(C.Microchip.NAME,
    (_data, brick) => brick.g === configGrid, 'hidden color core chip').brick;
  const coreGrid = one(scene.links.filter(link => link.key === coreChip.key), 'hidden color core link').grid;
  const grids = { terminal: terminalGrid, config: configGrid, core: coreGrid };
  assert.equal(new Set(Object.values(grids)).size, 3, 'Three distinct logic grids');

  const originalByGrid = new Map(Object.entries(grids).map(([_name, grid]) => [
    grid, scene.bricks.filter(brick => brick.g === grid),
  ]));
  assert.equal(originalByGrid.get(terminalGrid).length, 139, 'v6 terminal brick count');
  assert.equal(originalByGrid.get(configGrid).length, 24, 'v6 config brick count');
  assert.equal(originalByGrid.get(coreGrid).length, 273, 'v6 core brick count');

  const passiveLabels = [...originalByGrid.values()].flat().filter(brick =>
    brick.comps.some(item => item.type === C.TextDisplay.NAME));
  assert.equal(passiveLabels.length, 8, 'Expected seven terminal labels and one core label');
  for (const label of passiveLabels) {
    assert(!scene.edges.some(edge => edge.a === label.key || edge.z === label.key),
      `Passive label unexpectedly wired: ${label.key}`);
    assert(!scene.links.some(link => link.key === label.key),
      `Passive label unexpectedly linked: ${label.key}`);
  }
  const labelTemplate = clone(passiveLabels[0]);
  const removedLabelKeys = new Set(passiveLabels.map(label => label.key));
  scene.bricks = scene.bricks.filter(brick => !removedLabelKeys.has(brick.key));

  // v6 already colors both selection arrows and the selected content orange.
  const coreBricks = originalByGrid.get(coreGrid);
  for (const ordinal of [65, 66, 67, 68, 69, 77]) {
    assert.equal(component(coreBricks[ordinal], C.Expr_Select.NAME).data.InputB.value,
      '<color="ff8700">> ', `Orange prefix marker ${ordinal}`);
  }
  for (const ordinal of [70, 71, 72, 73, 74, 81]) {
    assert.equal(component(coreBricks[ordinal], C.Expr_Select.NAME).data.InputB.value,
      ' <</>', `Orange suffix marker ${ordinal}`);
  }

  const used = new Map(Object.values(grids).map(grid => [grid, new Set()]));
  const placements = new Map();
  const headers = [];
  const cards = [];

  function addHeader(grid, spec, width) {
    assert(Number.isInteger(width) && width > 0 && width % 2 === 0,
      `${spec.name} exact header width`);
    const brick = clone(labelTemplate);
    brick.key = `v8:${grid}:header:${spec.name}`;
    brick.g = grid;
    brick.data.asset = 'PB_DefaultMicroBrick';
    brick.data.size = [width / 2, 10, 2];
    brick.data.position = [spec.x + width / 2, spec.y + 10, 2];
    brick.data.direction = 4;
    brick.data.rotation = 0;
    brick.data.color = [...COLORS.black];
    brick.data.material = 'BMC_Glow';
    brick.data.material_intensity = 0;
    brick.comps = [clone(component(labelTemplate, C.TextDisplay.NAME))];
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = spec.title;
    display.data.Rotation = 90;
    display.data.Kerning = 0;
    display.data.LineHeight = spec.lineHeight ?? 5;
    display.data.WidthScale = 1;
    display.data.LineOffset = 0;
    display.data.Anchor = { X: 0.5, Y: 0.5 };
    display.data.Offset = { X: 0, Y: 0, Z: 0 };
    display.data.Color = {
      R: Math.min(255, spec.color[0] + 45),
      G: Math.min(255, spec.color[1] + 45),
      B: Math.min(255, spec.color[2] + 45),
      A: 255,
    };
    display.data.Face = 4;
    display.data.Material = 2;
    display.data.Outline = 2;
    display.data.bEnabled = true;
    display.data.bOverrideColor = true;
    display.data.bOverrideOutlineColor = true;
    display.data.bSharpCorners = true;
    display.data.bSharpOutlines = true;
    scene.bricks.push(brick);
    headers.push(brick);
    return brick;
  }

  function placeCard(grid, spec) {
    const source = originalByGrid.get(grid);
    const rowWidths = [];
    spec.rows.forEach((ordinals, rowIndex) => {
      let edge = spec.x;
      const y = spec.y - 5 - rowIndex * 20;
      for (const ordinal of ordinals) {
        assert(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < source.length,
          `${spec.name} ordinal ${ordinal}`);
        const brick = source[ordinal];
        assert(!removedLabelKeys.has(brick.key), `${spec.name} includes removed label ${ordinal}`);
        assert(!used.get(grid).has(ordinal), `${spec.name} duplicates ordinal ${ordinal}`);
        const half = halfSize(brick);
        assert.equal(half[1], 5, `${spec.name} ordinal ${ordinal} must be one row high`);
        brick.data.position = [edge + half[0], y, 2];
        brick.data.color = [...spec.color];
        placements.set(brick.key, clone(brick.data.position));
        used.get(grid).add(ordinal);
        edge += half[0] * 2;
      }
      rowWidths.push(edge - spec.x);
    });
    const width = Math.max(...rowWidths);
    const header = addHeader(grid, spec, width);
    const record = {
      grid, name: spec.name, title: spec.title, x: spec.x, headerBottom: spec.y,
      width, rows: spec.rows.map(rowOrdinals => [...rowOrdinals]), rowWidths, headerKey: header.key,
    };
    cards.push(record);
    return record;
  }

  for (const spec of TERMINAL_CARDS) placeCard(terminalGrid, spec);
  for (const spec of CONFIG_CARDS) placeCard(configGrid, spec);
  for (const spec of CORE_CARDS) placeCard(coreGrid, spec);

  for (const [name, grid] of Object.entries(grids)) {
    const source = originalByGrid.get(grid);
    const expected = source.map((_brick, ordinal) => ordinal)
      .filter(ordinal => !removedLabelKeys.has(source[ordinal].key));
    assert.deepEqual([...used.get(grid)].sort((a, b) => a - b), expected,
      `${name} every functional ordinal placed exactly once`);
  }

  assert.deepEqual(scene.edges, originalEdges, 'Relayout must not change any wire');
  assert.deepEqual(scene.links, originalLinks, 'Relayout must not change any microchip link');
  assert.deepEqual(scene.joints || [], originalJoints, 'Relayout must not change any joint');
  for (const [key, before] of originalBricks) {
    if (removedLabelKeys.has(key)) continue;
    const after = scene.bricks.find(brick => brick.key === key);
    assert(after, `Functional brick removed: ${key}`);
    const beforeData = clone(before.data);
    const afterData = clone(after.data);
    if (Object.values(grids).includes(before.g)) {
      delete beforeData.position;
      delete beforeData.color;
      delete afterData.position;
      delete afterData.color;
    }
    assert.deepEqual(afterData, beforeData, `Non-layout brick data changed: ${key}`);
    assert.deepEqual(after.comps, before.comps, `Component payload changed: ${key}`);
  }
  for (const header of headers) {
    assert(!originalBricks.has(header.key), `Header key collision: ${header.key}`);
    assert(!scene.edges.some(edge => edge.a === header.key || edge.z === header.key),
      `Header unexpectedly wired: ${header.key}`);
  }

  scene.entityOverrides = new Map();
  const planes = {
    terminal: fitPlane(scene, terminalGrid),
    config: fitPlane(scene, configGrid),
    core: fitPlane(scene, coreGrid),
  };
  const name = 'Scrap Runners - Color Terminal v8 Compact Labeled Logic';
  const description = 'Working v6 vehicle color customizer with identical functional wiring and orange selection arrows. Internal logic is repacked into compact touching rows with exact-fit labeled cards.';
  const generated = write(scene, { name, description, owner }).bytes;
  const bytes = repack(generated, inputBytes, { name, description });
  const outputScene = read(bytes);
  assert.deepEqual(outputScene.r.externalAssets(), originalAssets, 'External assets preserved');
  return {
    bytes, scene, input, output, grids, planes, cards, headers, removedLabelKeys,
    placements, originalBricks, originalEdges, originalLinks, originalJoints, originalAssets,
  };
}

module.exports = build;
module.exports.COLORS = COLORS;
module.exports.TERMINAL_CARDS = TERMINAL_CARDS;
module.exports.CONFIG_CARDS = CONFIG_CARDS;
module.exports.CORE_CARDS = CORE_CARDS;

if (require.main === module) {
  const context = build(INPUT, OUTPUT);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, context.bytes);
  require('./test-scrap-runners-color-terminal-v8.cjs')({ input: INPUT, output: OUTPUT });
  console.log(JSON.stringify({
    input: INPUT,
    output: OUTPUT,
    bytes: context.bytes.length,
    bricks: context.scene.bricks.length,
    wires: context.scene.edges.length,
    cards: context.cards.length,
    headers: context.headers.length,
    planes: context.planes,
  }, null, 2));
}
