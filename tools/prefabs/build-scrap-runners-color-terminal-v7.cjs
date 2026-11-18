'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, S } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v7.brz'));

const clone = value => structuredClone(value);
const COLORS = Object.freeze({
  black: [18, 18, 22], interface: [70, 175, 220], selection: [235, 145, 55],
  hue: [235, 100, 65], saturation: [80, 190, 105], brightness: [230, 205, 70],
  material: [165, 105, 220], intensity: [75, 135, 230], conversion: [55, 180, 175],
  hex: [80, 135, 220], preview: [220, 90, 190], audio: [220, 175, 60],
  zone: [70, 185, 225], purchase: [235, 150, 55], restore: [205, 130, 50],
  session: [55, 180, 150], vehicle: [65, 125, 220], saved: [145, 95, 215],
  response: [225, 75, 75], config: [105, 190, 225], output: [215, 95, 105],
  display: [110, 190, 120],
});

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  if (index < 0) return undefined;
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
  return [5, 5, 2];
}

function fitPlane(scene, grid, margin = 40) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity, `Missing grid entity ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  assert(bricks.length, `Empty grid ${grid}`);
  const min = [0, 1].map(axis => Math.min(...bricks.map(brick => brick.data.position[axis] - halfSize(brick)[axis])));
  const max = [0, 1].map(axis => Math.max(...bricks.map(brick => brick.data.position[axis] + halfSize(brick)[axis])));
  const override = clone(entity);
  override.data = clone(entity.data);
  override.data.bCollapsed = true;
  override.data.PlaneCenter = {
    X: Math.round((min[0] + max[0]) / 2), Y: Math.round((min[1] + max[1]) / 2), Z: 2,
  };
  override.data.PlaneExtent = {
    X: Math.ceil((max[0] - min[0]) / 2 + margin),
    Y: Math.ceil((max[1] - min[1]) / 2 + margin), Z: 8,
  };
  scene.entityOverrides.set(grid, override);
  return { center: clone(override.data.PlaneCenter), extent: clone(override.data.PlaneExtent) };
}

function build(input = INPUT, output = OUTPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  const owner = ownerFrom(scene);
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(savedComponent => ({ brick, savedComponent })));
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

  const originalBricks = new Map(scene.bricks.map(brick => [brick.key, clone(brick)]));
  const originalEdges = clone(scene.edges);
  const originalLinks = clone(scene.links);
  const originalJoints = clone(scene.joints || []);
  const originalKeys = new Set(originalBricks.keys());
  const originalByGrid = new Map(Object.values(grids).map(grid => [
    grid, scene.bricks.filter(brick => brick.g === grid),
  ]));
  const plannedPositions = new Map();
  const sectionByKey = new Map();
  const markerKeys = new Set();
  const annotationKeys = new Set();
  const labels = [];
  let sequence = 0;
  const labelTemplate = row(C.TextDisplay.NAME,
    (data, brick) => brick.g === terminalGrid && /^1\. ZONE VEHICLE TRACKING/.test(data.Text),
    'internal text label').brick;

  function addLabel(grid, position, text, options = {}) {
    const brick = clone(labelTemplate);
    brick.key = `v7:${grid}:label:${sequence++}`;
    brick.g = grid;
    brick.data.position = clone(position);
    brick.data.size = clone(options.size || [100, 28, 2]);
    brick.data.color = clone(options.brickColor || COLORS.black);
    brick.data.material_intensity = 0;
    brick.comps = [clone(component(labelTemplate, C.TextDisplay.NAME))];
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = text;
    display.data.LineHeight = options.lineHeight ?? 1.1;
    display.data.WidthScale = options.widthScale ?? 0.82;
    display.data.Color = options.textColor || { B: 255, G: 255, R: 255, A: 255 };
    display.data.Anchor = { X: 0, Y: 0.5 };
    display.data.Offset = { X: 1, Y: 0, Z: 0 };
    scene.bricks.push(brick);
    labels.push({ key: brick.key, grid, text, position: clone(position) });
    return brick;
  }

  function planner(grid, expectedCount) {
    const bricks = originalByGrid.get(grid);
    assert.equal(bricks.length, expectedCount, `Grid ${grid} source brick count`);
    const used = new Set();
    const positions = new Set();
    function put(index, position, section, color) {
      assert(Number.isInteger(index) && index >= 0 && index < bricks.length,
        `Grid ${grid} invalid ordinal ${index}`);
      assert(!used.has(index), `Grid ${grid} duplicate ordinal ${index}`);
      const positionKey = position.join(',');
      assert(!positions.has(positionKey), `Grid ${grid} duplicate planned position ${positionKey}`);
      used.add(index);
      positions.add(positionKey);
      const brick = bricks[index];
      brick.data.position = clone(position);
      brick.data.color = clone(color);
      plannedPositions.set(brick.key, clone(position));
      sectionByKey.set(brick.key, section);
    }
    function line(indices, y, startX, step, section, color) {
      indices.forEach((index, offset) => put(index, [startX + offset * step, y, 2], section, color));
    }
    function finish() {
      const missing = bricks.map((_brick, index) => index).filter(index => !used.has(index));
      assert.deepEqual(missing, [], `Grid ${grid} unplaced ordinals`);
    }
    return { put, line, finish };
  }

  // Terminal/session plane: every functional path becomes a horizontal lane.
  {
    const p = planner(terminalGrid, 139);
    const { put, line } = p;
    put(10, [420, 0, 2], 'zone', COLORS.black);
    line([51], 80, 180, 90, 'zone', COLORS.zone);
    line([18, 36], 160, 180, 90, 'zone', COLORS.zone);
    line([17, 40, 34], 240, 180, 90, 'zone', COLORS.zone);
    addLabel(terminalGrid, [0, 160, 2], 'ZONE\r\nTRACKING', { size: [100, 80, 2], textColor: { B: 255, G: 220, R: 100, A: 255 } });

    put(11, [420, 360, 2], 'preview', COLORS.black);
    line([100, 37, 70, 19, 0], 440, 180, 90, 'preview', COLORS.preview);
    addLabel(terminalGrid, [0, 440, 2], 'LIVE\r\nPREVIEW', { size: [100, 42, 2], textColor: { B: 225, G: 125, R: 255, A: 255 } });

    put(12, [420, 600, 2], 'purchase', COLORS.black);
    line([20, 38, 71, 21, 118, 109, 5, 6, 22, 23, 3, 4], 680, 180, 90, 'purchase', COLORS.purchase);
    put(78, [900, 760, 2], 'purchase', COLORS.purchase);
    put(77, [990, 760, 2], 'purchase', COLORS.purchase);
    put(48, [1170, 760, 2], 'purchase', COLORS.purchase);
    put(9, [420, 840, 2], 'purchase', COLORS.black);
    line([41, 49, 50, 67, 68], 920, 180, 90, 'purchase', COLORS.purchase);
    addLabel(terminalGrid, [0, 760, 2], 'PURCHASE\r\n+ SAVE', { size: [100, 135, 2], textColor: { B: 90, G: 190, R: 255, A: 255 } });

    put(13, [420, 1060, 2], 'restore', COLORS.black);
    line([1, 2], 1140, 180, 90, 'restore', COLORS.restore);
    addLabel(terminalGrid, [0, 1140, 2], 'EXIT\r\nRESTORE', { size: [100, 42, 2], textColor: { B: 90, G: 180, R: 255, A: 255 } });

    put(14, [720, 1300, 2], 'session', COLORS.black);
    line([54, 55, 56, 57, 58], 1380, 180, 90, 'session', COLORS.session);
    line([76, 103, 24, 80, 110, 81, 108, 82, 107, 83, 104, 7, 84, 85, 25], 1460, 180, 90, 'session', COLORS.session);
    line([86, 87, 88, 89, 90, 91], 1540, 180, 90, 'session', COLORS.session);
    addLabel(terminalGrid, [0, 1460, 2], 'USER\r\nSESSION', { size: [100, 105, 2], textColor: { B: 190, G: 255, R: 100, A: 255 } });

    line([59, 60, 61], 1740, 180, 90, 'vehicle', COLORS.vehicle);
    line([105, 92, 93, 94, 39, 72, 26, 15, 16, 73, 27, 95, 96, 97, 28], 1820, 180, 90, 'vehicle', COLORS.vehicle);
    addLabel(terminalGrid, [0, 1780, 2], 'VEHICLE\r\nMETADATA', { size: [100, 70, 2], textColor: { B: 255, G: 180, R: 110, A: 255 } });

    line([62], 1940, 180, 90, 'saved', COLORS.saved);
    line([106, 98, 8, 99, 29], 2020, 180, 90, 'saved', COLORS.saved);
    line([64, 63, 65, 66, 52, 53, 69, 79, 30, 33], 2100, 180, 90, 'saved', COLORS.saved);
    line([31, 42, 32, 35], 2180, 180, 90, 'saved', COLORS.saved);
    line([74, 75, 43, 44, 45, 46, 47], 2260, 180, 90, 'saved', COLORS.saved);
    addLabel(terminalGrid, [0, 2100, 2], 'SAVED COLOR\r\n+ DISPLAY', { size: [100, 170, 2], textColor: { B: 255, G: 155, R: 205, A: 255 } });

    put(111, [720, 2440, 2], 'response', COLORS.black);
    line([112, 113, 114, 115, 116, 117], 2520, 180, 90, 'response', COLORS.response);
    line([119, 101, 102], 2600, 180, 90, 'response', COLORS.response);
    line([120, 121, 122, 123, 124], 2680, 180, 90, 'response', COLORS.response);
    line([125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136], 2760, 180, 90, 'response', COLORS.response);
    line([137, 138], 2840, 180, 90, 'response', COLORS.response);
    addLabel(terminalGrid, [0, 2680, 2], 'SYSTEM RESPONSE\r\n+ 3x BLINK', { size: [100, 180, 2], textColor: { B: 105, G: 105, R: 255, A: 255 } });
    p.finish();
  }

  // Editable/config plane: text, settings, core, and outputs stay visibly separate.
  {
    const p = planner(configGrid, 24);
    const { put } = p;
    put(0, [260, 0, 2], 'config', COLORS.audio);
    put(13, [350, 0, 2], 'config', COLORS.audio);
    put(1, [260, 90, 2], 'config', COLORS.audio);
    put(14, [350, 90, 2], 'config', COLORS.audio);
    put(2, [260, 180, 2], 'config', COLORS.audio);
    put(15, [350, 180, 2], 'config', COLORS.audio);
    put(17, [260, 290, 2], 'config', COLORS.config);
    put(16, [350, 290, 2], 'config', COLORS.purchase);
    put(18, [650, 145, 2], 'core', COLORS.interface);
    put(23, [1040, 0, 2], 'outputs', COLORS.output);
    put(22, [1040, 75, 2], 'outputs', COLORS.output);
    put(21, [1040, 150, 2], 'outputs', COLORS.output);
    put(20, [1040, 260, 2], 'outputs', COLORS.display);
    put(19, [1040, 335, 2], 'outputs', COLORS.response);
    put(3, [220, 560, 2], 'display', COLORS.hue);
    put(4, [220, 640, 2], 'display', COLORS.saturation);
    put(5, [220, 720, 2], 'display', COLORS.brightness);
    put(6, [220, 800, 2], 'display', COLORS.material);
    put(7, [220, 880, 2], 'display', COLORS.intensity);
    put(8, [220, 990, 2], 'display', COLORS.purchase);
    put(10, [500, 720, 2], 'display', COLORS.display);
    put(11, [500, 990, 2], 'display', COLORS.purchase);
    put(9, [760, 620, 2], 'display', COLORS.display);
    put(12, [760, 720, 2], 'display', COLORS.display);
    addLabel(configGrid, [0, 145, 2], 'EDITABLE\r\nSETTINGS', { size: [105, 185, 2], textColor: { B: 255, G: 220, R: 110, A: 255 } });
    addLabel(configGrid, [175, 0, 2], 'SELECT', { size: [55, 22, 2] });
    addLabel(configGrid, [175, 90, 2], 'TAP', { size: [55, 22, 2] });
    addLabel(configGrid, [175, 180, 2], 'REPEAT', { size: [55, 22, 2] });
    addLabel(configGrid, [650, 40, 2], 'HIDDEN COLOR CORE', { size: [105, 24, 2], textColor: { B: 255, G: 220, R: 100, A: 255 } });
    addLabel(configGrid, [900, 165, 2], 'PUBLIC\r\nOUTPUTS', { size: [90, 205, 2], textColor: { B: 120, G: 175, R: 255, A: 255 } });
    addLabel(configGrid, [0, 780, 2], 'DISPLAY\r\nTEXT', { size: [105, 260, 2], textColor: { B: 150, G: 255, R: 155, A: 255 } });
    addLabel(configGrid, [500, 520, 2], 'ASSEMBLY', { size: [70, 22, 2] });
    addLabel(configGrid, [760, 520, 2], 'SESSION', { size: [70, 22, 2] });
    p.finish();

    const configBricks = originalByGrid.get(configGrid);
    component(configBricks[9], C.Interact.NAME).data.Message = 'Controls the complete left/session screen. Inputs: A ID, B user, C Scrap, D vehicle, E saved/current color hex, F preview color hex, and G System Response.';
    component(configBricks[10], C.Interact.NAME).data.Message = 'Controls the complete right/color-settings screen. Inputs A-E are Hue, Saturation, Brightness, Material, and Intensity rows; F is Price plus BUY.';
    annotationKeys.add(configBricks[9].key);
    annotationKeys.add(configBricks[10].key);
  }

  // Hidden core: repeated control matrix plus conversion, hex, preview, and audio bands.
  {
    const p = planner(coreGrid, 273);
    const { put, line } = p;
    put(126, [180, 0, 2], 'interface', COLORS.interface);
    put(3, [270, 0, 2], 'interface', COLORS.interface);
    put(127, [180, 90, 2], 'interface', COLORS.interface);
    put(112, [360, 0, 2], 'selection', COLORS.selection);
    line([186, 179, 146, 103, 210], 0, 500, 90, 'selection', COLORS.selection);
    line([184, 180, 147, 104, 211], 90, 500, 90, 'selection', COLORS.selection);
    line([185, 181], 210, 180, 90, 'selection', COLORS.selection);
    put(213, [360, 210, 2], 'selection', COLORS.selection);
    line([187, 182], 290, 180, 90, 'selection', COLORS.selection);
    put(215, [360, 290, 2], 'selection', COLORS.selection);
    line([89, 212, 118, 90, 4], 380, 270, 90, 'selection', COLORS.selection);
    line([91, 214, 119, 92, 5], 470, 270, 90, 'selection', COLORS.selection);
    line([128, 129, 251, 0], 560, 180, 90, 'audio', COLORS.audio);
    addLabel(coreGrid, [0, 250, 2], 'INPUT +\r\nSELECTION', { size: [105, 300, 2], textColor: { B: 100, G: 220, R: 255, A: 255 } });
    addLabel(coreGrid, [180, 650, 2], 'DISPLAY', { size: [95, 22, 2] });
    addLabel(coreGrid, [800, 650, 2], 'TAP A  (-)', { size: [125, 22, 2] });
    addLabel(coreGrid, [1180, 650, 2], 'TAP D  (+)', { size: [125, 22, 2] });
    addLabel(coreGrid, [1560, 650, 2], 'HOLD A  (-)', { size: [125, 22, 2] });
    addLabel(coreGrid, [1940, 650, 2], 'HOLD D  (+)', { size: [125, 22, 2] });

    const matrixRows = [
      { y: 760, name: 'HUE', color: COLORS.hue, display: [113, 188, 65, 83, 70], a: [6, 148, 105, 216], d: [10, 152, 106, 220], ha: [14, 156, 107, 224], hd: [18, 160, 108, 228] },
      { y: 960, name: 'SATURATION', color: COLORS.saturation, display: [114, 189, 66, 84, 71], a: [7, 149, 134, 217], d: [11, 153, 137, 221], ha: [15, 157, 140, 225], hd: [19, 161, 143, 229] },
      { y: 1160, name: 'BRIGHTNESS', color: COLORS.brightness, display: [115, 190, 67, 85, 72], a: [8, 150, 135, 218], d: [12, 154, 138, 222], ha: [16, 158, 141, 226], hd: [20, 162, 144, 230] },
      { y: 1360, name: 'MATERIAL', color: COLORS.material, display: [116, 191, 68, 73, 124], a: [22, 164, 109, 232], d: [23, 165, 110, 233], ha: [], hd: [] },
      { y: 1680, name: 'INTENSITY', color: COLORS.intensity, display: [117, 192, 69, 102, 74], a: [9, 151, 136, 219], d: [13, 155, 139, 223], ha: [17, 159, 142, 227], hd: [21, 163, 145, 231] },
    ];
    for (const item of matrixRows) {
      addLabel(coreGrid, [0, item.y, 2], item.name, { size: [105, 46, 2], textColor: { B: item.color[2], G: item.color[1], R: item.color[0], A: 255 } });
      line(item.display, item.y, 180, 80, item.name.toLowerCase(), item.color);
      line(item.a, item.y, 680, 80, item.name.toLowerCase(), item.color);
      line(item.d, item.y, 1060, 80, item.name.toLowerCase(), item.color);
      line(item.ha, item.y, 1440, 80, item.name.toLowerCase(), item.color);
      line(item.hd, item.y, 1820, 80, item.name.toLowerCase(), item.color);
    }
    line([202], 1460, 180, 80, 'material', COLORS.material);
    line([203, 75, 204, 76, 205, 78, 206, 79, 207, 80], 1540, 180, 80, 'material', COLORS.material);
    addLabel(coreGrid, [0, 1500, 2], 'MATERIAL NAMES\r\n+ RESERVED', { size: [105, 74, 2], textColor: { B: 255, G: 150, R: 215, A: 255 } });
    line([101, 82, 125], 1760, 580, 80, 'intensity', COLORS.intensity);
    line([201, 77, 81], 1880, 260, 80, 'buy', COLORS.purchase);
    addLabel(coreGrid, [0, 1880, 2], 'BUY MARKER', { size: [105, 35, 2], textColor: { B: 80, G: 190, R: 255, A: 255 } });

    // Keep the high-fanout preview/audio buses immediately below the control
    // matrix so their pulse wires do not form a curtain across later sections.
    put(272, [720, 1980, 2], 'preview', COLORS.black);
    line([237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 93], 2060, 180, 100, 'preview', COLORS.preview);
    addLabel(coreGrid, [0, 2060, 2], 'PREVIEW\r\nPULSE', { size: [105, 48, 2], textColor: { B: 220, G: 110, R: 255, A: 255 } });
    line([130, 131, 252, 253, 254, 255, 256, 257, 258, 259, 260, 1], 2260, 180, 90, 'audio', COLORS.audio);
    line([132, 133, 261, 262, 263, 264, 265, 266, 267, 2], 2360, 180, 90, 'audio', COLORS.audio);
    addLabel(coreGrid, [0, 2310, 2], 'TAP + REPEAT\r\nSOUNDS', { size: [105, 82, 2], textColor: { B: 80, G: 220, R: 255, A: 255 } });

    addLabel(coreGrid, [0, 2860, 2], 'HSB -> RGB\r\nCOLOR MATH', { size: [105, 300, 2], textColor: { B: 220, G: 255, R: 100, A: 255 } });
    line([120, 121, 94], 2580, 180, 90, 'conversion', COLORS.conversion);
    line([122, 111, 86, 169, 87, 95], 2660, 180, 90, 'conversion', COLORS.conversion);
    line([88], 2740, 360, 90, 'conversion', COLORS.conversion);
    line([178, 193, 194, 195, 196, 197, 198], 2820, 180, 90, 'conversion', COLORS.conversion);
    addLabel(coreGrid, [900, 2820, 2], 'SECTOR 0 DEFAULT / LEGACY', { size: [145, 22, 2], textColor: { B: 220, G: 255, R: 100, A: 255 } });
    line([48, 49, 50, 51, 52, 166, 96], 2920, 180, 90, 'conversion', COLORS.hue);
    line([53, 54, 55, 56, 57, 167, 97], 3010, 180, 90, 'conversion', COLORS.saturation);
    line([58, 59, 60, 61, 62, 168, 98], 3100, 180, 90, 'conversion', COLORS.intensity);
    line([170, 123], 3200, 180, 90, 'conversion', COLORS.conversion);
    line([208, 28, 39, 36, 64, 37], 3290, 360, 90, 'conversion', COLORS.conversion);

    addLabel(coreGrid, [0, 4050, 2], 'HEX INPUT\r\nVALIDATE + PARSE', { size: [105, 600, 2], textColor: { B: 255, G: 180, R: 100, A: 255 } });
    line([183, 270, 268], 3500, 180, 90, 'hex', COLORS.hex);
    line([271, 199, 24], 3590, 270, 90, 'hex', COLORS.hex);
    line([26, 27, 38, 29, 63], 3680, 180, 90, 'hex', COLORS.hex);
    line([40, 200], 3770, 360, 90, 'hex', COLORS.hex);
    const characterChecks = [[30, 41], [31, 42], [32, 43], [33, 44], [34, 45], [35, 46]];
    characterChecks.forEach((indices, rowIndex) => line(indices, 3860 + rowIndex * 80, 360, 90, 'hex', COLORS.hex));
    line([172, 173, 174, 175, 176, 177], 4360, 180, 90, 'hex', COLORS.hex);
    put(25, [810, 4360, 2], 'hex', COLORS.hex);
    line([171, 209, 47], 4460, 180, 90, 'hex', COLORS.hex);
    line([234], 4560, 360, 90, 'hex', COLORS.hex);
    line([99, 235], 4640, 360, 90, 'hex', COLORS.hex);
    line([100, 236], 4720, 360, 90, 'hex', COLORS.hex);
    put(269, [720, 4720, 2], 'hex', COLORS.response);
    p.finish();
  }

  // The arrows remain green; only the selected text/value between them is orange.
  const coreBricks = originalByGrid.get(coreGrid);
  for (const ordinal of [65, 66, 67, 68, 69, 77]) {
    const brick = coreBricks[ordinal];
    const select = component(brick, C.Expr_Select.NAME);
    assert.equal(select.data.InputB.value, '<color="ff8700">> ');
    select.data.InputB = S('> <color="ff8700">');
    markerKeys.add(brick.key);
  }
  for (const ordinal of [70, 71, 72, 73, 74, 81]) {
    const brick = coreBricks[ordinal];
    const select = component(brick, C.Expr_Select.NAME);
    assert.equal(select.data.InputB.value, ' <</>');
    select.data.InputB = S('</> <');
    markerKeys.add(brick.key);
  }

  assert.deepEqual(scene.edges, originalEdges, 'Relayout must not change any wire');
  assert.deepEqual(scene.links, originalLinks, 'Relayout must not change any microchip link');
  assert.deepEqual(scene.joints || [], originalJoints, 'Relayout must not change any joint');
  assert.equal(markerKeys.size, 12, 'Exactly six prefix and six suffix markers patched');
  for (const [key, before] of originalBricks) {
    const after = scene.bricks.find(brick => brick.key === key);
    assert(after, `Original brick removed: ${key}`);
    const beforeData = clone(before.data);
    const afterData = clone(after.data);
    if (Object.values(grids).includes(before.g)) {
      delete beforeData.position;
      delete beforeData.color;
      delete afterData.position;
      delete afterData.color;
    }
    assert.deepEqual(afterData, beforeData, `Non-layout brick data changed: ${key}`);
    const expectedComponents = clone(before.comps);
    if (markerKeys.has(key)) {
      const expectedSelect = expectedComponents.find(item => item.type === C.Expr_Select.NAME);
      const actualSelect = after.comps.find(item => item.type === C.Expr_Select.NAME);
      expectedSelect.data.InputB = clone(actualSelect.data.InputB);
    }
    if (annotationKeys.has(key)) {
      const expectedInteract = expectedComponents.find(item => item.type === C.Interact.NAME);
      const actualInteract = after.comps.find(item => item.type === C.Interact.NAME);
      expectedInteract.data.Message = actualInteract.data.Message;
    }
    assert.deepEqual(after.comps, expectedComponents, `Component payload changed: ${key}`);
  }
  for (const label of labels) {
    assert(!originalKeys.has(label.key));
    assert(!scene.edges.some(edge => edge.a === label.key || edge.z === label.key), `Label wired: ${label.text}`);
    assert(!scene.links.some(link => link.key === label.key), `Label linked: ${label.text}`);
  }

  scene.entityOverrides = new Map();
  const planes = {
    terminal: fitPlane(scene, terminalGrid), config: fitPlane(scene, configGrid), core: fitPlane(scene, coreGrid),
  };
  const name = 'Scrap Runners - Color Terminal v7 Organized Logic';
  const description = 'Working v6 color terminal with identical logic topology, reorganized into labeled left-to-right terminal, configuration, and color-core lanes. Selected content remains orange while both arrows remain green.';
  const generated = write(scene, { name, description, owner }).bytes;
  const bytes = repack(generated, inputBytes, { name, description });
  return {
    bytes, scene, input, output, grids, planes, labels, markerKeys, annotationKeys, plannedPositions,
    sectionByKey, originalBricks, originalEdges, originalLinks, originalJoints,
  };
}

module.exports = build;
module.exports.COLORS = COLORS;

if (require.main === module) {
  const context = build(INPUT, OUTPUT);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, context.bytes);
  require('./test-scrap-runners-color-terminal-v7.cjs')({ input: INPUT, output: OUTPUT });
  console.log(JSON.stringify({
    input: INPUT, output: OUTPUT, bytes: context.bytes.length, bricks: context.scene.bricks.length,
    wires: context.scene.edges.length, labels: context.labels.length, planes: context.planes,
  }, null, 2));
}
