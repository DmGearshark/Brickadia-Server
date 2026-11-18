'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, S } = require('./loadboard-lib.cjs');
const nativeBounds = require('./native-brick-half-extents.json');

const TERMINAL_INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v8.brz'));
const TRUCK_INPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v4.brz'));
const TERMINAL_OUTPUT = path.resolve(process.argv[4]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v9.brz'));
const TRUCK_OUTPUT = path.resolve(process.argv[5]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v5.brz'));

const clone = value => structuredClone(value);
const I = value => ({ $variant: 'i64', value });
const X = () => ({ $variant: 'WireGraphExec', value: {} });
const materialEnum = value => ({
  $variant: 'dynamic_enum', value: { $enum: 'EBrickMaterial', value },
});

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Gearshark owner is present');
  return { id: brdb.guidToUuid(owners.UserIds[index]), name: owners.UserNames[index],
    display_name: owners.DisplayNames[index] };
}

function graph(scene, prefix) {
  let sequence = 0;
  const rows = () => scene.bricks.flatMap(brick => brick.comps
    .map(savedComponent => ({ brick, savedComponent })));
  const component = (brick, type) => {
    const result = brick?.comps.find(saved => saved.type === type);
    assert(result, `Missing ${type} on ${brick?.key || 'unknown brick'}`);
    return result;
  };
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(rows().filter(item =>
    item.savedComponent.type === type && predicate(item.savedComponent.data, item.brick)), label);
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const brickFor = key => {
    const result = scene.bricks.find(brick => brick.key === key);
    assert(result, `Missing brick ${key}`);
    return result;
  };
  const base = clone(scene.bricks.find(brick => brick.data.asset.startsWith('B_1x1_Gate_')).data);
  function gate(kind, grid, position, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate ${kind}`);
    const brickData = clone(base);
    Object.assign(brickData, { asset: definition.BRICK, position, direction: 4, rotation: 0,
      size: [0, 0, 0], color: options.color || [70, 145, 205], material_intensity: 5 });
    const brick = { key: `${prefix}:${grid}:${options.name || kind}:${sequence++}`, g: grid,
      data: brickData, comps: [{ type: definition.NAME, data: clone(data) }] };
    scene.bricks.push(brick);
    return brick;
  }
  function add(source, sourceType, sourcePort, target, targetType, targetPort) {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({ a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort });
  }
  function removeInput(target, targetType, port) {
    const removed = incoming(target, targetType, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === targetType && edge.q === port));
    return removed;
  }
  function removeBrick(brick) {
    scene.edges = scene.edges.filter(edge => edge.a !== brick.key && edge.z !== brick.key);
    scene.links = scene.links.filter(link => link.key !== brick.key);
    scene.bricks = scene.bricks.filter(candidate => candidate !== brick);
  }
  return { rows, component, one, row, incoming, outgoing, brickFor, gate, add,
    removeInput, removeBrick };
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  const result = nativeBounds.assets[brick.data.asset];
  assert(result, `Missing bounds for ${brick.data.asset}`);
  return result;
}

function fitPlane(scene, grid, margin = 10) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity, `Missing microchip ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const min = [0, 1].map(axis => Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis])));
  const max = [0, 1].map(axis => Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis])));
  const override = clone(entity);
  override.data = clone(entity.data);
  override.data.bCollapsed = true;
  override.data.PlaneCenter = { X: (min[0] + max[0]) / 2, Y: (min[1] + max[1]) / 2, Z: 0 };
  override.data.PlaneExtent = { X: (max[0] - min[0]) / 2 + margin,
    Y: (max[1] - min[1]) / 2 + margin, Z: 0 };
  scene.entityOverrides.set(grid, override);
}

function placeRows(rows, x, headerBottom) {
  rows.forEach((row, rowIndex) => {
    let edge = x;
    for (const brick of row) {
      const half = halfSize(brick);
      brick.data.position = [edge + half[0], headerBottom - 5 - rowIndex * 20, 2];
      edge += half[0] * 2;
    }
  });
}

function addHeader(scene, g, template, grid, x, y, width, text, color, name) {
  const brick = clone(template);
  brick.key = `v9:${grid}:header:${name}`;
  brick.g = grid;
  Object.assign(brick.data, { asset: 'PB_DefaultMicroBrick', size: [width / 2, 10, 2],
    position: [x + width / 2, y + 10, 2], direction: 4, rotation: 0,
    color: [0, 0, 0], material: 'BMC_Glow', material_intensity: 0 });
  brick.comps = [clone(g.component(template, C.TextDisplay.NAME))];
  Object.assign(g.component(brick, C.TextDisplay.NAME).data, {
    Text: text, Rotation: 90, Kerning: 0, LineHeight: 3.5, WidthScale: 1,
    LineOffset: 0, Anchor: { X: 0.5, Y: 0.5 }, Offset: { X: 0, Y: 0, Z: 0 },
    Color: { R: Math.min(255, color[0] + 45), G: Math.min(255, color[1] + 45),
      B: Math.min(255, color[2] + 45), A: 255 }, Face: 4, Material: 2, Outline: 2,
    bEnabled: true, bOverrideColor: true, bOverrideOutlineColor: true,
    bSharpCorners: true, bSharpOutlines: true,
  });
  scene.bricks.push(brick);
  return brick;
}

function buildTerminal(input = TERMINAL_INPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  scene.entityOverrides = new Map();
  const owner = ownerFrom(scene);
  const g = graph(scene, 'v9t');
  const headerTemplate = clone(g.row(C.TextDisplay.NAME,
    data => data.Text === 'INPUT +\r\nSELECTION', 'v8 header').brick);
  const entered = g.row(C.EntityZoneEvent_Entered.NAME, () => true, 'zone entered').brick;
  const terminalGrid = entered.g;
  const session = g.row(C.Expr_String_FormatText.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.FormatString), 'session formatter').brick;
  const configGrid = session.g;
  const coreChip = g.row(C.Microchip.NAME,
    (_data, brick) => brick.g === configGrid, 'hidden core chip').brick;
  const coreGrid = g.one(scene.links.filter(link => link.key === coreChip.key), 'core link').grid;
  const core = scene.bricks.filter(brick => brick.g === coreGrid);
  const previewSend = g.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'preview sender').brick;
  const insert = g.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === terminalGrid, 'zone insert').brick;

  // Stop entry from applying the old picker default before synchronization.
  const entryPreview = g.one(g.outgoing(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut')
    .filter(edge => edge.zt === C.Exec_Union.NAME && g.outgoing(g.brickFor(edge.z),
      C.Exec_Union.NAME, 'ExecOut').some(next => next.zt === C.Exec_ArrayVar_Get.NAME
        && g.outgoing(g.brickFor(next.z), C.Exec_ArrayVar_Get.NAME, 'ExecOut')
          .some(branch => branch.zt === C.Exec_Branch.NAME
            && g.outgoing(g.brickFor(branch.z), C.Exec_Branch.NAME, 'ExecOutA')
              .some(send => send.z === previewSend.key)))), 'entry preview edge');
  scene.edges = scene.edges.filter(edge => edge !== entryPreview);

  // Read appearance values published on the entering vehicle root.
  const colorGet = g.gate('Exec_Entity_GetCustomProperty', terminalGrid, [0, 0, 2], {
    Key: 'CurrentColorScore', Value: I(0), bFound: false,
  }, { name: 'current_color_score', color: [145, 95, 215] });
  const materialGet = g.gate('Exec_Entity_GetCustomProperty', terminalGrid, [0, 0, 2], {
    Key: 'CurrentMaterialEnum', Value: N(0), bFound: false,
  }, { name: 'current_material_enum', color: [165, 105, 220] });
  const found = g.gate('Expr_LogicalAND', terminalGrid, [0, 0, 2], {},
    { name: 'appearance_found', color: [70, 185, 225] });
  const guard = g.gate('Exec_Branch', terminalGrid, [0, 0, 2], {},
    { name: 'appearance_sync_guard', color: [70, 185, 225] });
  const terminalOutputs = [
    g.gate('MicrochipOutput', terminalGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Color Score', PortOrder: 1, CallableDefault: I(0), CallableResult: I(0),
    }, { name: 'color_score_out', color: [145, 95, 215] }),
    g.gate('MicrochipOutput', terminalGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Material', PortOrder: 2, CallableDefault: N(0), CallableResult: N(0),
    }, { name: 'material_out', color: [165, 105, 220] }),
    g.gate('MicrochipOutput', terminalGrid, [0, 0, 2], {
      PortLabel: 'Appearance Sync', PortOrder: 3, CallableDefault: X(), CallableResult: X(),
    }, { name: 'sync_out', color: [70, 185, 225] }),
  ];
  g.add(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut', colorGet, C.Exec_Entity_GetCustomProperty.NAME, 'Exec');
  g.add(entered, C.EntityZoneEvent_Entered.NAME, 'Entity', colorGet, C.Exec_Entity_GetCustomProperty.NAME, 'Entity');
  g.add(colorGet, C.Exec_Entity_GetCustomProperty.NAME, 'ExecOut', materialGet, C.Exec_Entity_GetCustomProperty.NAME, 'Exec');
  g.add(entered, C.EntityZoneEvent_Entered.NAME, 'Entity', materialGet, C.Exec_Entity_GetCustomProperty.NAME, 'Entity');
  g.add(colorGet, C.Exec_Entity_GetCustomProperty.NAME, 'bFound', found, C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(materialGet, C.Exec_Entity_GetCustomProperty.NAME, 'bFound', found, C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(materialGet, C.Exec_Entity_GetCustomProperty.NAME, 'ExecOut', guard, C.Exec_Branch.NAME, 'Exec');
  g.add(found, C.Expr_LogicalAND.NAME, 'bOutput', guard, C.Exec_Branch.NAME, 'bCond');
  g.add(colorGet, C.Exec_Entity_GetCustomProperty.NAME, 'Value', terminalOutputs[0], C.MicrochipOutput.NAME, 'RER_Input');
  g.add(materialGet, C.Exec_Entity_GetCustomProperty.NAME, 'Value', terminalOutputs[1], C.MicrochipOutput.NAME, 'RER_Input');
  g.add(guard, C.Exec_Branch.NAME, 'ExecOutA', terminalOutputs[2], C.MicrochipOutput.NAME, 'RER_Input');
  addHeader(scene, g, headerTemplate, terminalGrid, 140, -230, 80,
    'VEHICLE\r\nAPPEARANCE SYNC', [70, 185, 225], 'appearance_sync');
  placeRows([[colorGet, materialGet], [found, guard], terminalOutputs], 140, -230);

  // Pass the sibling terminal chip values through config and into its nested core.
  const configInputs = [
    g.gate('MicrochipInput', configGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Color Score', PortOrder: 1, CallableDefault: I(0), CallableMirror: I(0),
    }, { name: 'config_color_score', color: [145, 95, 215] }),
    g.gate('MicrochipInput', configGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Material', PortOrder: 2, CallableDefault: N(0), CallableMirror: N(0),
    }, { name: 'config_material', color: [165, 105, 220] }),
    g.gate('MicrochipInput', configGrid, [0, 0, 2], {
      PortLabel: 'Appearance Sync', PortOrder: 3, CallableDefault: X(), CallableMirror: X(),
    }, { name: 'config_sync', color: [70, 185, 225] }),
  ];
  const coreInputs = [
    g.gate('MicrochipInput', coreGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Color Score', PortOrder: 9, CallableDefault: I(0), CallableMirror: I(0),
    }, { name: 'core_color_score', color: [145, 95, 215] }),
    g.gate('MicrochipInput', coreGrid, [0, 0, 2], {
      PortLabel: 'Vehicle Material', PortOrder: 10, CallableDefault: N(0), CallableMirror: N(0),
    }, { name: 'core_material', color: [165, 105, 220] }),
    g.gate('MicrochipInput', coreGrid, [0, 0, 2], {
      PortLabel: 'Appearance Sync', PortOrder: 11, CallableDefault: X(), CallableMirror: X(),
    }, { name: 'core_sync', color: [70, 185, 225] }),
  ];
  terminalOutputs.forEach((source, index) => g.add(source, C.MicrochipOutput.NAME, 'RER_Output',
    configInputs[index], C.MicrochipInput.NAME, 'RER_Input'));
  configInputs.forEach((source, index) => g.add(source, C.MicrochipInput.NAME, 'RER_Output',
    coreInputs[index], C.MicrochipInput.NAME, 'RER_Input'));
  const coreHeader = g.row(C.TextDisplay.NAME,
    (data, brick) => brick.g === configGrid && data.Text === 'CORE', 'CORE header').brick;
  coreHeader.data.size = [15, 10, 2];
  coreHeader.data.position = [135, 10, 2];
  g.component(coreHeader, C.TextDisplay.NAME).data.Text = 'CORE + SYNC';
  placeRows([[coreChip], configInputs], 120, 0);

  // Decode the packed score, convert RGB to HSV, then atomically initialize
  // material, hue, saturation, and brightness. Sync setters never request a preview.
  const [hue, saturation, brightness, material] = [113, 114, 115, 116].map(index => core[index]);
  const floorScore = g.gate('Expr_MathMax', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(0) },
    { name: 'sync_floor', color: [145, 95, 215] });
  const ceilScore = g.gate('Expr_MathMin', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(16777215) },
    { name: 'sync_ceiling', color: [145, 95, 215] });
  const red = g.gate('Expr_MathDivide', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(65536) },
    { name: 'sync_red', color: [235, 100, 65] });
  const redFloor = g.gate('Expr_Floor', coreGrid, [0, 0, 2], { Input: N(0) },
    { name: 'sync_red_floor', color: [235, 100, 65] });
  const greenBase = g.gate('Expr_MathDivide', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(256) },
    { name: 'sync_green_base', color: [80, 190, 105] });
  const greenFloor = g.gate('Expr_Floor', coreGrid, [0, 0, 2], { Input: N(0) },
    { name: 'sync_green_floor', color: [80, 190, 105] });
  const green = g.gate('Expr_MathModulo', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(256) },
    { name: 'sync_green', color: [80, 190, 105] });
  const blue = g.gate('Expr_MathModulo', coreGrid, [0, 0, 2], { InputA: I(0), InputB: I(256) },
    { name: 'sync_blue', color: [75, 135, 230] });
  const makeColor = g.gate('Expr_MakeColorSRGB', coreGrid, [0, 0, 2], { R: 0, G: 0, B: 0, A: 255 },
    { name: 'sync_rgb', color: [145, 95, 215] });
  const convert = g.gate('Expr_ColorConvert', coreGrid, [0, 0, 2], { FromSpace: 0, ToSpace: 3 },
    { name: 'sync_to_hsv', color: [55, 180, 175] });
  const split = g.gate('Expr_SplitColor', coreGrid, [0, 0, 2], {},
    { name: 'sync_hsv', color: [55, 180, 175] });
  const sat100 = g.gate('Expr_MathMultiply', coreGrid, [0, 0, 2], { InputA: N(0), InputB: N(100) },
    { name: 'sync_sat_percent', color: [80, 190, 105] });
  const val100 = g.gate('Expr_MathMultiply', coreGrid, [0, 0, 2], { InputA: N(0), InputB: N(100) },
    { name: 'sync_val_percent', color: [230, 205, 70] });
  const isMetal = g.gate('Expr_CompareEqual', coreGrid, [0, 0, 2], { InputA: N(0), InputB: N(4) },
    { name: 'sync_is_metal', color: [165, 105, 220] });
  const normalizeMaterial = g.gate('Expr_Select', coreGrid, [0, 0, 2], {
    bSelectB: false, InputA: N(0), InputB: N(4),
  }, { name: 'sync_material_normalize', color: [165, 105, 220] });
  const setters = [
    g.gate('Exec_Var_Set', coreGrid, [0, 0, 2], { bChangeType: false, Value: N(0) },
      { name: 'sync_material_set', color: [165, 105, 220] }),
    g.gate('Exec_Var_Set', coreGrid, [0, 0, 2], { bChangeType: false, Value: N(0) },
      { name: 'sync_hue_set', color: [235, 100, 65] }),
    g.gate('Exec_Var_Set', coreGrid, [0, 0, 2], { bChangeType: false, Value: N(0) },
      { name: 'sync_saturation_set', color: [80, 190, 105] }),
    g.gate('Exec_Var_Set', coreGrid, [0, 0, 2], { bChangeType: false, Value: N(0) },
      { name: 'sync_brightness_set', color: [230, 205, 70] }),
  ];
  g.add(coreInputs[0], C.MicrochipInput.NAME, 'RER_Output', floorScore, C.Expr_MathMax.NAME, 'InputA');
  g.add(floorScore, C.Expr_MathMax.NAME, 'Output', ceilScore, C.Expr_MathMin.NAME, 'InputA');
  g.add(ceilScore, C.Expr_MathMin.NAME, 'Output', red, C.Expr_MathDivide.NAME, 'InputA');
  g.add(ceilScore, C.Expr_MathMin.NAME, 'Output', greenBase, C.Expr_MathDivide.NAME, 'InputA');
  g.add(ceilScore, C.Expr_MathMin.NAME, 'Output', blue, C.Expr_MathModulo.NAME, 'InputA');
  g.add(red, C.Expr_MathDivide.NAME, 'Output', redFloor, C.Expr_Floor.NAME, 'Input');
  g.add(greenBase, C.Expr_MathDivide.NAME, 'Output', greenFloor, C.Expr_Floor.NAME, 'Input');
  g.add(greenFloor, C.Expr_Floor.NAME, 'Output', green, C.Expr_MathModulo.NAME, 'InputA');
  g.add(redFloor, C.Expr_Floor.NAME, 'Output', makeColor, C.Expr_MakeColorSRGB.NAME, 'R');
  g.add(green, C.Expr_MathModulo.NAME, 'Output', makeColor, C.Expr_MakeColorSRGB.NAME, 'G');
  g.add(blue, C.Expr_MathModulo.NAME, 'Output', makeColor, C.Expr_MakeColorSRGB.NAME, 'B');
  g.add(makeColor, C.Expr_MakeColorSRGB.NAME, 'Output', convert, C.Expr_ColorConvert.NAME, 'Input');
  g.add(convert, C.Expr_ColorConvert.NAME, 'Output', split, C.Expr_SplitColor.NAME, 'Input');
  g.add(split, C.Expr_SplitColor.NAME, 'G', sat100, C.Expr_MathMultiply.NAME, 'InputA');
  g.add(split, C.Expr_SplitColor.NAME, 'B', val100, C.Expr_MathMultiply.NAME, 'InputA');
  g.add(coreInputs[1], C.MicrochipInput.NAME, 'RER_Output', isMetal, C.Expr_CompareEqual.NAME, 'InputA');
  g.add(isMetal, C.Expr_CompareEqual.NAME, 'bOutput', normalizeMaterial, C.Expr_Select.NAME, 'bSelectB');
  g.add(coreInputs[2], C.MicrochipInput.NAME, 'RER_Output', setters[0], C.Exec_Var_Set.NAME, 'Exec');
  const variables = [material, hue, saturation, brightness];
  const values = [[normalizeMaterial, C.Expr_Select.NAME, 'Output'], [split, C.Expr_SplitColor.NAME, 'R'],
    [sat100, C.Expr_MathMultiply.NAME, 'Output'], [val100, C.Expr_MathMultiply.NAME, 'Output']];
  setters.forEach((setter, index) => {
    g.add(variables[index], C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    g.add(values[index][0], values[index][1], values[index][2], setter, C.Exec_Var_Set.NAME, 'Value');
    if (index + 1 < setters.length)
      g.add(setter, C.Exec_Var_Set.NAME, 'ExecOut', setters[index + 1], C.Exec_Var_Set.NAME, 'Exec');
  });

  // Keep the public outputs driven by the normal live H/S/B + material state,
  // while making the just-read vehicle values visibly traceable to those
  // authoritative outputs in the editor.  The B inputs document the sync
  // source; false is intentional because the setter transaction above owns
  // the state update and must not bypass the editable Vars afterward.
  const coreColorOutput = g.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Color',
    'core Color output').brick;
  const coreMaterialOutput = g.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Material',
    'core Material output').brick;
  const liveColor = g.one(g.removeInput(coreColorOutput, C.MicrochipOutput.NAME, 'RER_Input'),
    'live core color');
  const liveMaterial = g.one(g.removeInput(coreMaterialOutput, C.MicrochipOutput.NAME, 'RER_Input'),
    'live core material');
  const colorStateBridge = g.gate('Expr_Select', coreGrid, [0, 0, 2], {
    bSelectB: false,
    InputA: { $variant: 'LinearColor', value: { R: 1, G: 1, B: 1, A: 1 } },
    InputB: { $variant: 'LinearColor', value: { R: 1, G: 1, B: 1, A: 1 } },
  }, { name: 'synced_color_state', color: [145, 95, 215] });
  const materialStateBridge = g.gate('Expr_Select', coreGrid, [0, 0, 2], {
    bSelectB: false, InputA: N(0), InputB: N(0),
  }, { name: 'synced_material_state', color: [165, 105, 220] });
  g.add(g.brickFor(liveColor.a), liveColor.at, liveColor.p, colorStateBridge,
    C.Expr_Select.NAME, 'InputA');
  g.add(makeColor, C.Expr_MakeColorSRGB.NAME, 'Output', colorStateBridge,
    C.Expr_Select.NAME, 'InputB');
  g.add(colorStateBridge, C.Expr_Select.NAME, 'Output', coreColorOutput,
    C.MicrochipOutput.NAME, 'RER_Input');
  g.add(g.brickFor(liveMaterial.a), liveMaterial.at, liveMaterial.p, materialStateBridge,
    C.Expr_Select.NAME, 'InputA');
  g.add(normalizeMaterial, C.Expr_Select.NAME, 'Output', materialStateBridge,
    C.Expr_Select.NAME, 'InputB');
  g.add(materialStateBridge, C.Expr_Select.NAME, 'Output', coreMaterialOutput,
    C.MicrochipOutput.NAME, 'RER_Input');
  addHeader(scene, g, headerTemplate, coreGrid, 0, -160, 100,
    'VEHICLE APPEARANCE SYNC', [70, 185, 225], 'vehicle_sync');
  placeRows([coreInputs, [floorScore, ceilScore, red, redFloor, greenBase, greenFloor, green, blue, makeColor],
    [convert, split, sat100, val100, isMetal, normalizeMaterial], setters,
    [colorStateBridge, materialStateBridge]], 0, -160);

  // Fast repeat clocks are active only while A/D is held. They have therefore
  // been running for the full 0.75s before the repeat-ready latch opens.
  const holdClocks = core.filter(brick => brick.comps.some(saved =>
    saved.type === C.Clock.NAME && saved.data.IntervalSeconds === 0.75));
  const fastClocks = core.filter(brick => brick.comps.some(saved =>
    saved.type === C.Clock.NAME && saved.data.IntervalSeconds === 0.025));
  assert.equal(holdClocks.length, 2);
  assert.equal(fastClocks.length, 2);
  for (const fast of fastClocks) {
    g.component(fast, C.Clock.NAME).data.bEnabled = false;
    const hold = g.one(holdClocks.filter(candidate =>
      candidate.data.position[1] === fast.data.position[1]), 'paired hold clock');
    const held = g.one(g.incoming(hold, C.Clock.NAME, 'bEnabled'), 'held direction signal');
    g.add(g.brickFor(held.a), held.at, held.p, fast, C.Clock.NAME, 'bEnabled');
  }

  // Keep the actual Brickadia enum in state: (0 + 4) mod 8 = 4 and
  // (4 + 4) mod 8 = 0, so either direction toggles Plastic <-> Metal.
  const previousAdd = core[164];
  const nextAdd = core[165];
  const previousModulo = core[109];
  const nextModulo = core[110];
  g.component(previousAdd, C.Expr_MathAdd.NAME).data.InputB = N(4);
  g.component(nextAdd, C.Expr_MathAdd.NAME).data.InputB = N(4);
  g.component(previousModulo, C.Expr_MathModuloFloored.NAME).data.InputB = N(8);
  g.component(nextModulo, C.Expr_MathModuloFloored.NAME).data.InputB = N(8);
  const metalCompare = core[206];
  const materialText = core[79];
  const materialFormatter = g.row(C.Expr_String_FormatText.NAME,
    (data, brick) => brick.g === configGrid && /^\{A\}MATERIAL/.test(data.FormatString),
    'material row formatter').brick;
  const materialFormatterLabel = materialFormatter.comps.find(saved => saved.type === C.Interact.NAME);
  if (materialFormatterLabel) materialFormatterLabel.data.Message =
    'Controls the Material row text. A and C are selection markers; B displays Plastic or Metal.';
  for (const ordinal of [75, 76, 78, 80, 202, 203, 204, 205, 207])
    g.removeBrick(core[ordinal]);
  g.removeInput(materialFormatter, C.Expr_String_FormatText.NAME, 'InputB');
  g.add(materialText, C.Expr_Select.NAME, 'Output', materialFormatter,
    C.Expr_String_FormatText.NAME, 'InputB');
  const materialHeader = g.row(C.TextDisplay.NAME,
    (data, brick) => brick.g === coreGrid && data.Text === 'MATERIAL', 'material header').brick;
  materialHeader.data.size = [25, 10, 2];
  materialHeader.data.position = [315, 210, 2];
  g.component(materialHeader, C.TextDisplay.NAME).data.Text = 'MATERIAL\r\nPLASTIC / METAL';
  placeRows([[material, core[191], core[68], core[73], core[124]],
    [core[22], previousAdd, previousModulo, core[232]],
    [core[23], nextAdd, nextModulo, core[233]],
    [metalCompare, materialText]], 290, 200);

  // A material tap requests the same delayed/coalesced preview as H/S/B edits.
  const previewDelay = g.one(scene.bricks.filter(brick => brick.g === coreGrid
    && brick.comps.some(saved => saved.type === C.BufferTicks.NAME)
    && g.outgoing(brick, C.BufferTicks.NAME, 'Output')
      .some(edge => g.brickFor(edge.z).g === terminalGrid)), 'preview delay');
  const priorPreview = g.one(g.removeInput(previewDelay, C.BufferTicks.NAME, 'Input'),
    'prior preview pulse');
  const unionA = g.gate('Exec_Union', coreGrid, [125, -245, 2], {},
    { name: 'color_or_material_a', color: [220, 90, 190] });
  const unionB = g.gate('Exec_Union', coreGrid, [135, -245, 2], {},
    { name: 'color_or_material_b', color: [220, 90, 190] });
  g.add(g.brickFor(priorPreview.a), priorPreview.at, priorPreview.p, unionA, C.Exec_Union.NAME, 'ExecA');
  g.add(core[232], C.Exec_Var_Set.NAME, 'ExecOut', unionA, C.Exec_Union.NAME, 'ExecB');
  g.add(unionA, C.Exec_Union.NAME, 'ExecOut', unionB, C.Exec_Union.NAME, 'ExecA');
  g.add(core[233], C.Exec_Var_Set.NAME, 'ExecOut', unionB, C.Exec_Union.NAME, 'ExecB');
  g.add(unionB, C.Exec_Union.NAME, 'ExecOut', previewDelay, C.BufferTicks.NAME, 'Input');
  const publicMaterial = g.one(g.rows().filter(item => item.brick.g === configGrid
    && item.savedComponent.type === C.MicrochipOutput.NAME
    && item.savedComponent.data.PortLabel === 'Material'), 'config Material output').brick;
  g.add(publicMaterial, C.MicrochipOutput.NAME, 'RER_Output', previewSend,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');

  // Use the configurable price in the visible success response.
  const success = g.row(C.Exec_Var_Set.NAME,
    data => data.Value?.value === '<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED</>',
    'success response').brick;
  const cost = g.row(C.Var.NAME, (data, brick) => data.Value?.value === 100
    && brick.comps.some(saved => saved.type === C.Interact.NAME
      && saved.data.PromptCustomLabel === 'Color purchase cost'), 'color price').brick;
  const successFormat = g.gate('Expr_String_FormatText', terminalGrid, [79, -355, 2], {
    FormatString: '<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED -🔩{A}</>',
    InputA: I(100), InputB: N(0), InputC: N(0), InputD: N(0), InputE: N(0),
    InputF: N(0), InputG: N(0),
  }, { name: 'success_with_price', color: [75, 210, 125] });
  g.component(success, C.Exec_Var_Set.NAME).data.Value =
    S('<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED -🔩100</>');
  g.add(cost, C.Var.NAME, 'Value', successFormat, C.Expr_String_FormatText.NAME, 'InputA');
  g.add(successFormat, C.Expr_String_FormatText.NAME, 'Output', success, C.Exec_Var_Set.NAME, 'Value');

  for (const grid of [terminalGrid, configGrid, coreGrid]) fitPlane(scene, grid);
  const name = 'Scrap Runners - Color Terminal v9 Vehicle Appearance Sync';
  const description = 'Compact labeled terminal that initializes from an entering vehicle, limits material to Plastic/Metal, idles repeat clocks, previews both appearance values, and reports the configured Scrap debit.';
  const generated = write(scene, { name, description, owner }).bytes;
  const bytes = repack(generated, inputBytes, { name, description });
  return { bytes, scene, grids: { terminal: terminalGrid, config: configGrid, core: coreGrid },
    added: { colorGet, materialGet, found, guard, terminalOutputs, configInputs, coreInputs,
      setters, successFormat }, removedEntryPreview: entryPreview };
}

function isBrickHandle(value) {
  return value && typeof value === 'object' && Number.isInteger(value.GridPersistentIndex)
    && value.ChunkIndex && Number.isInteger(value.ChunkIndex.X)
    && Number.isInteger(value.ChunkIndex.Y) && Number.isInteger(value.ChunkIndex.Z)
    && Number.isInteger(value.BrickIndexInChunk);
}
function visit(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) value.forEach(child => visit(child, callback));
  else Object.values(value).forEach(child => visit(child, callback));
}
function writeTruck(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const sourceEntities = [...scene.r.entities()];
  const outputEntities = [...first.r.entities()];
  assert.equal(outputEntities.length, sourceEntities.length);
  const grids = new Map([[1, 1]]);
  sourceEntities.forEach((entity, index) =>
    grids.set(entity.persistentIndex, outputEntities[index].persistentIndex));
  const keys = new Map();
  for (const sourceGrid of new Set(scene.bricks.map(brick => brick.g))) {
    const source = scene.bricks.filter(brick => brick.g === sourceGrid);
    const output = first.bricks.filter(brick => brick.g === grids.get(sourceGrid));
    assert.equal(output.length, source.length, `Truck grid ${sourceGrid} brick count`);
    source.forEach((brick, index) => keys.set(brick.key, output[index].key));
  }
  let remapped = 0;
  for (const brick of first.bricks) for (const saved of brick.comps) visit(saved.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const old = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    const replacement = keys.get(old);
    assert(replacement, `Lost stored BrickHandle ${old}`);
    const [grid, x, y, z, index] = JSON.parse(replacement);
    Object.assign(value, { GridPersistentIndex: grid, ChunkIndex: { X: x, Y: y, Z: z },
      BrickIndexInChunk: index });
    remapped++;
  });
  const bytes = write(first, metadata).bytes;
  const final = read(bytes);
  const valid = new Set(final.bricks.map(brick => brick.key));
  let checked = 0;
  for (const brick of final.bricks) for (const saved of brick.comps) visit(saved.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    assert(valid.has(key), `Dangling final BrickHandle ${key}`);
    checked++;
  });
  assert.equal(checked, remapped);
  return { bytes, remapped };
}

function buildTruck(input = TRUCK_INPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  scene.entityOverrides = new Map();
  const owner = ownerFrom(scene);
  const g = graph(scene, 'v9v');
  const colorGet = g.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Color', 'Truck1Color getter').brick;
  const materialGet = g.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material', 'Truck1Material getter').brick;
  const statsGrid = colorGet.g;
  const interfaceEvent = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'preview event').brick;
  const restoreEvent = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color', 'restore event').brick;
  const updateEvent = g.row(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === statsGrid && data.EventName === 'UpdateCar', 'stats update').brick;
  const ownerOutput = g.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState', 'owner output').brick;
  const generalGrid = ownerOutput.g;
  const readVehicle = g.one(g.rows().filter(item => item.brick.g === generalGrid
    && item.savedComponent.type === C.ReadBrickGrid.NAME
    && g.outgoing(item.brick, C.ReadBrickGrid.NAME, 'BrickGrid')
      .filter(edge => edge.zt === C.Exec_Entity_SetFrozen.NAME).length === 2),
  'vehicle ReadBrickGrid').brick;

  // Reuse the existing appearance-load union. Its UpdateCar branch is already
  // delayed by one tick so Owner PlayerState is available, while its other
  // branch is the literal zone-exit restore event. Both getters therefore read
  // the same owner at the same safe point instead of racing separate paths.
  const colorLoadEdge = g.one(g.incoming(colorGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec'), 'existing color load driver');
  const loadAppearance = g.brickFor(colorLoadEdge.a);
  assert(g.component(loadAppearance, C.Exec_Union.NAME), 'appearance load is an Exec Union');
  g.one(g.incoming(loadAppearance, C.Exec_Union.NAME, 'ExecB')
    .filter(edge => edge.a === restoreEvent.key), 'restore event appearance-load branch');
  const delayedLoadEdge = g.one(g.incoming(loadAppearance, C.Exec_Union.NAME, 'ExecA'),
    'delayed UpdateCar appearance-load branch');
  const delayedLoad = g.brickFor(delayedLoadEdge.a);
  assert(g.component(delayedLoad, C.BufferTicks.NAME), 'UpdateCar appearance load is delayed');
  g.one(g.incoming(delayedLoad, C.BufferTicks.NAME, 'Input')
    .filter(edge => edge.a === updateEvent.key), 'UpdateCar delay input');
  g.removeInput(materialGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  g.removeInput(materialGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  g.add(loadAppearance, C.Exec_Union.NAME, 'ExecOut', materialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  g.add(ownerOutput, C.MicrochipOutput.NAME, 'RER_Output', materialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');

  // Publish saved appearance on the root Entity for a terminal to read on entry.
  const materialX4 = g.gate('Expr_MathMultiply', statsGrid, [145, 15, 2], {
    InputA: N(0), InputB: N(4),
  }, { name: 'saved_material_enum', color: [165, 105, 220] });
  const publishColor = g.gate('Exec_Entity_SetCustomProperty', statsGrid, [165, 15, 2], {
    Key: 'CurrentColorScore', Value: I(0),
  }, { name: 'publish_color', color: [145, 95, 215] });
  const publishMaterial = g.gate('Exec_Entity_SetCustomProperty', statsGrid, [165, -5, 2], {
    Key: 'CurrentMaterialEnum', Value: N(0),
  }, { name: 'publish_material', color: [165, 105, 220] });
  g.add(materialGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', materialX4,
    C.Expr_MathMultiply.NAME, 'InputA');
  for (const setter of [publishColor, publishMaterial])
    g.add(readVehicle, C.ReadBrickGrid.NAME, 'BrickGrid', setter,
      C.Exec_Entity_SetCustomProperty.NAME, 'Entity');
  g.add(colorGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', publishColor,
    C.Exec_Entity_SetCustomProperty.NAME, 'Value');
  g.add(colorGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', publishColor,
    C.Exec_Entity_SetCustomProperty.NAME, 'Exec');
  g.add(materialX4, C.Expr_MathMultiply.NAME, 'Output', publishMaterial,
    C.Exec_Entity_SetCustomProperty.NAME, 'Value');
  g.add(materialGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', publishMaterial,
    C.Exec_Entity_SetCustomProperty.NAME, 'Exec');

  // Preview Data2 is an actual material enum (0 Plastic or 4 Metal).
  const materialVar = g.one(g.rows().filter(item => item.savedComponent.type === C.Var.NAME
    && item.savedComponent.data.Value?.$variant === 'dynamic_enum'
    && item.savedComponent.data.Value?.value?.$enum === 'EBrickMaterial'), 'material Var').brick;
  const materialGrid = materialVar.g;
  const previewMetal = g.gate('Expr_CompareEqual', materialGrid, [20, 5, 2], {
    InputA: N(0), InputB: N(4),
  }, { name: 'preview_is_metal', color: [165, 105, 220] });
  const previewBranch = g.gate('Exec_Branch', materialGrid, [30, 5, 2], {},
    { name: 'preview_material_branch', color: [165, 105, 220] });
  const setMetal = g.gate('Exec_Var_Set', materialGrid, [40, 5, 2], {
    bChangeType: false, Value: materialEnum(4),
  }, { name: 'preview_metal', color: [165, 105, 220] });
  const setPlastic = g.gate('Exec_Var_Set', materialGrid, [40, -15, 2], {
    bChangeType: false, Value: materialEnum(0),
  }, { name: 'preview_plastic', color: [165, 105, 220] });
  g.add(interfaceEvent, C.Event_CustomGlobal.NAME, 'DataOut2', previewMetal,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(interfaceEvent, C.Event_CustomGlobal.NAME, 'ExecOut', previewBranch, C.Exec_Branch.NAME, 'Exec');
  g.add(previewMetal, C.Expr_CompareEqual.NAME, 'bOutput', previewBranch, C.Exec_Branch.NAME, 'bCond');
  g.add(previewBranch, C.Exec_Branch.NAME, 'ExecOutA', setMetal, C.Exec_Var_Set.NAME, 'Exec');
  g.add(previewBranch, C.Exec_Branch.NAME, 'ExecOutB', setPlastic, C.Exec_Var_Set.NAME, 'Exec');
  for (const setter of [setMetal, setPlastic])
    g.add(materialVar, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');

  // Re-run the body foreach for either color or material changes.
  const colorChange = g.row(C.Expr_ChangeDetector.NAME,
    (_data, brick) => g.outgoing(brick, C.Expr_ChangeDetector.NAME, 'bPulseOnChange')
      .some(edge => edge.zt === C.Microchip_ForEachArray.NAME), 'color change').brick;
  const colorControllerGrid = colorChange.g;
  const foreachEdge = g.one(g.outgoing(colorChange, C.Expr_ChangeDetector.NAME, 'bPulseOnChange')
    .filter(edge => edge.zt === C.Microchip_ForEachArray.NAME), 'body foreach edge');
  const foreach = g.brickFor(foreachEdge.z);
  scene.edges = scene.edges.filter(edge => edge !== foreachEdge);
  const materialChange = g.gate('Expr_ChangeDetector', colorControllerGrid, [180, 105, 2], {
    Input: materialEnum(0), InputLast: materialEnum(0), bSeeded: true,
  }, { name: 'material_change', color: [165, 105, 220] });
  const appearanceChange = g.gate('Exec_Union', colorControllerGrid, [200, 105, 2], {},
    { name: 'appearance_change', color: [145, 95, 215] });
  const refreshBodyNextTick = g.gate('BufferTicks', colorControllerGrid, [220, 105, 2], {
    TicksToWait: 1, ZeroTicksToWait: -1, CurrentTicks: 0,
    Input: { $variant: 'WireGraphExec', value: {} },
    Output: { $variant: 'WireGraphExec', value: {} },
    Buffered: { $variant: 'WireGraphExec', value: {} },
    bHasQueued: false, bIsOffTimer: false,
  }, { name: 'coalesce_appearance_refresh', color: [145, 95, 215] });
  g.add(materialVar, C.Var.NAME, 'Value', materialChange, C.Expr_ChangeDetector.NAME, 'Input');
  g.add(colorChange, C.Expr_ChangeDetector.NAME, 'bPulseOnChange', appearanceChange,
    C.Exec_Union.NAME, 'ExecA');
  g.add(materialChange, C.Expr_ChangeDetector.NAME, 'bPulseOnChange', appearanceChange,
    C.Exec_Union.NAME, 'ExecB');
  g.add(appearanceChange, C.Exec_Union.NAME, 'ExecOut', refreshBodyNextTick,
    C.BufferTicks.NAME, 'Input');
  g.add(refreshBodyNextTick, C.BufferTicks.NAME, 'Output', foreach,
    C.Microchip_ForEachArray.NAME, 'Exec');

  for (const grid of [statsGrid, materialGrid, colorControllerGrid]) fitPlane(scene, grid);
  const name = 'Scrap Runners - Truck1 Color + Material Sync v5';
  const description = 'Truck1 for Color Terminal v9. Publishes saved color/material properties, previews Plastic/Metal, and restores both saved values on exit.';
  const written = writeTruck(scene, { name, description, owner });
  const bytes = repack(written.bytes, inputBytes, { name, description });
  return { bytes, scene, remappedBrickHandles: written.remapped,
    grids: { general: generalGrid, stats: statsGrid, material: materialGrid,
      colorController: colorControllerGrid } };
}

function build({ terminalInput = TERMINAL_INPUT, truckInput = TRUCK_INPUT } = {}) {
  return { terminal: buildTerminal(terminalInput), truck: buildTruck(truckInput),
    terminalInput, truckInput };
}

module.exports = build;
module.exports.buildTerminal = buildTerminal;
module.exports.buildTruck = buildTruck;

if (require.main === module) {
  const context = build();
  fs.mkdirSync(path.dirname(TERMINAL_OUTPUT), { recursive: true });
  fs.mkdirSync(path.dirname(TRUCK_OUTPUT), { recursive: true });
  fs.writeFileSync(TERMINAL_OUTPUT, context.terminal.bytes);
  fs.writeFileSync(TRUCK_OUTPUT, context.truck.bytes);
  console.log(JSON.stringify({ terminalOutput: TERMINAL_OUTPUT,
    terminalBricks: context.terminal.scene.bricks.length,
    terminalWires: context.terminal.scene.edges.length,
    truckOutput: TRUCK_OUTPUT,
    truckBricks: context.truck.scene.bricks.length,
    truckWires: context.truck.scene.edges.length,
    remappedBrickHandles: context.truck.remappedBrickHandles }, null, 2));
}
