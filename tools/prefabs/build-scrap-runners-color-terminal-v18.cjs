'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v17.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v18.brz'));

const clone = structuredClone;
const I = value => ({ $variant: 'i64', value });

function owner(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Prefab owner');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function graph(scene, prefix) {
  let sequence = 0;
  const component = (brick, type) => {
    const result = brick?.comps.find(saved => saved.type === type);
    assert(result, `Missing ${type}`);
    return result;
  };
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows().filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected 1, got ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(all(type, predicate), label);
  const brick = key => one(scene.bricks.filter(item => item.key === key), `brick ${key}`);
  const incoming = (target, type, port) => scene.edges.filter(edge => edge.z === target.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (source, type, port) => scene.edges.filter(edge => edge.a === source.key
    && edge.at === type && (!port || edge.p === port));
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({ a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort });
  };
  const removeInput = (target, type, port) => {
    const previous = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return previous;
  };
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(comp =>
    comp.type === C.Interact.NAME && (comp.data.PromptCustomLabel === text
      || comp.data.Message === text))), `label ${text}`);
  const base = clone(scene.bricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const gate = (kind, grid, data, name, color = [70, 145, 205], hover = name) => {
    const definition = C[kind];
    assert(definition, kind);
    const procedural = definition.BRICK.startsWith('PB_Gate_');
    const brickData = clone(base);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position: [0, 0, 2],
      direction: 4,
      rotation: 0,
      size: procedural ? [10, 5, 2] : [0, 0, 0],
      color,
      material_intensity: 5,
    });
    const comps = [{ type: definition.NAME, data: clone(data) }];
    if (hover && !procedural) comps.push({
      type: C.Interact.NAME,
      data: {
        InteractSound: 0,
        Message: hover,
        ConsoleTag: '',
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
        PromptCustomLabel: hover,
      },
    });
    const result = { key: `${prefix}:${grid}:${name}:${sequence++}`, g: grid,
      data: brickData, comps };
    scene.bricks.push(result);
    return result;
  };
  return { component, all, one, row, brick, incoming, outgoing,
    add, removeInput, label, gate };
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}

function rowAt(bricks, x, y) {
  let edge = x;
  for (const brick of bricks) {
    const half = halfSize(brick);
    assert(half, brick.data.asset);
    brick.data.position = [edge + half[0], y, 2];
    edge += half[0] * 2;
  }
}

function fit(scene, grid) {
  const entity = [...scene.r.entities()].find(saved => saved.persistentIndex === grid);
  assert(entity, `microchip entity ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const low = [0, 1].map(axis => Math.floor(Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis]))));
  const high = [0, 1].map(axis => Math.ceil(Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis]))));
  for (let axis = 0; axis < 2; axis++) if ((low[axis] + high[axis]) % 2) high[axis]++;
  const copy = clone(entity);
  copy.data = clone(entity.data);
  copy.data.bCollapsed = true;
  copy.data.PlaneCenter = { X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2, Z: 0 };
  copy.data.PlaneExtent = { X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10, Z: 0 };
  scene.entityOverrides.set(grid, copy);
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  const g = graph(scene, 'v18');

  const colorWrite = g.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    () => true, 'existing saved-color write').brick;
  const terminalGrid = colorWrite.g;
  const materialState = g.label('Live material snapshot');
  assert.equal(materialState.g, terminalGrid, 'material baseline is retained in terminal chip');
  const purchaseColorBaseline = g.label('Update CURRENT COLOR after successful purchase');
  const scrapDebit = g.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'purchase Scrap debit').brick;

  // Select the public/config Material output which already drives preview
  // event DataIn2. Its numeric convention is Plastic 0 / Metal 4.
  const selectedMaterial = g.one(g.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Material').filter(({ brick }) => g.outgoing(brick,
    C.MicrochipOutput.NAME, 'RER_Output').some(edge =>
    edge.zt === C.Exec_SendCustomEventGlobal.NAME && edge.q === 'DataIn2')),
  'public selected Material output').brick;

  // The final changed/not-changed branch immediately precedes the existing
  // occupied-seat mutation guard. Extend its condition from color-only to
  // color OR material, so a material-only purchase is valid and buying an
  // already-saved appearance still cannot debit Scrap twice.
  const finalMutation = g.brick(g.one(g.incoming(colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec'), 'final mutation guard').a);
  assert.equal(g.component(finalMutation, C.Exec_Branch.NAME).data.bCond, false);
  const appearanceBranch = g.brick(g.one(g.incoming(finalMutation,
    C.Exec_Branch.NAME, 'Exec'), 'appearance changed branch').a);
  const oldChangedCondition = g.one(g.removeInput(appearanceBranch,
    C.Exec_Branch.NAME, 'bCond'), 'color changed condition');
  const colorChanged = g.brick(oldChangedCondition.a);
  assert(g.component(colorChanged, C.Expr_CompareNotEqual.NAME),
    'existing condition compares saved and selected color');

  const materialChanged = g.gate('Expr_CompareNotEqual', terminalGrid,
    { InputA: N(0), InputB: N(0) }, 'material_changed', [165, 105, 220],
    'Selected material differs from saved material');
  const appearanceChanged = g.gate('Expr_LogicalOR', terminalGrid,
    { bInputA: false, bInputB: false }, 'appearance_changed', [235, 150, 55],
    'Color or material differs from saved appearance');
  g.add(materialState, C.Var.NAME, 'Value', materialChanged,
    C.Expr_CompareNotEqual.NAME, 'InputA');
  g.add(selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output', materialChanged,
    C.Expr_CompareNotEqual.NAME, 'InputB');
  g.add(colorChanged, C.Expr_CompareNotEqual.NAME, 'bOutput', appearanceChanged,
    C.Expr_LogicalOR.NAME, 'bInputA');
  g.add(materialChanged, C.Expr_CompareNotEqual.NAME, 'bOutput', appearanceChanged,
    C.Expr_LogicalOR.NAME, 'bInputB');
  g.add(appearanceChanged, C.Expr_LogicalOR.NAME, 'bOutput', appearanceBranch,
    C.Exec_Branch.NAME, 'bCond');

  // Encode the terminal's Plastic 0 / Metal 4 selection into the truck's
  // established persistent leaderboard convention: Plastic 0 / Metal 1.
  const isMetal = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: N(0), InputB: N(4) }, 'selected_is_metal', [165, 105, 220],
    'Selected material is Metal enum 4');
  const materialScore = g.gate('Expr_Select', terminalGrid,
    { bSelectB: false, InputA: I(0), InputB: I(1) }, 'material_score',
    [165, 105, 220], 'Encode Plastic 0 or Metal 1 for Truck1Material');
  g.add(selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output', isMetal,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(isMetal, C.Expr_CompareEqual.NAME, 'bOutput', materialScore,
    C.Expr_Select.NAME, 'bSelectB');

  const materialWrite = g.gate('Exec_Gamemode_SetLeaderboardValue', terminalGrid,
    { Key: 'Truck1Material', Value: 0 }, 'save_material', [165, 105, 220],
    'Save selected Plastic or Metal');
  g.add(materialScore, C.Expr_Select.NAME, 'Output', materialWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value');
  const colorPlayer = g.one(g.incoming(colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'PlayerState'),
  'saved-color PlayerState');
  g.add(g.brick(colorPlayer.a), colorPlayer.at, colorPlayer.p, materialWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'PlayerState');

  // Keep both retained baselines synchronized with the completed writes. The
  // sequence remains behind the existing final occupied-seat guard:
  // color write -> material write -> color baseline -> material baseline -> debit.
  const oldColorBaselineExec = g.one(g.removeInput(purchaseColorBaseline,
    C.Exec_Var_Set.NAME, 'Exec'), 'color write to color baseline');
  assert.equal(oldColorBaselineExec.a, colorWrite.key);
  assert.equal(oldColorBaselineExec.at, C.Exec_Gamemode_SetLeaderboardValue.NAME);
  const oldDebitExec = g.one(g.removeInput(scrapDebit,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec'),
  'color baseline to Scrap debit');
  assert.equal(oldDebitExec.a, purchaseColorBaseline.key);
  assert.equal(oldDebitExec.at, C.Exec_Var_Set.NAME);

  const purchaseMaterialBaseline = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: N(0) }, 'purchase_material_baseline',
    [165, 105, 220], 'Update saved material baseline after successful purchase');
  g.add(materialState, C.Var.NAME, 'VarRef', purchaseMaterialBaseline,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output',
    purchaseMaterialBaseline, C.Exec_Var_Set.NAME, 'Value');
  g.add(colorWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec');
  g.add(materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    purchaseColorBaseline, C.Exec_Var_Set.NAME, 'Exec');
  g.add(purchaseColorBaseline, C.Exec_Var_Set.NAME, 'ExecOut',
    purchaseMaterialBaseline, C.Exec_Var_Set.NAME, 'Exec');
  g.add(purchaseMaterialBaseline, C.Exec_Var_Set.NAME, 'ExecOut',
    scrapDebit, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec');

  rowAt([materialChanged, appearanceChanged, isMetal, materialScore,
    materialWrite, purchaseMaterialBaseline], 320, -125);
  fit(scene, terminalGrid);

  const metadata = {
    name: 'Scrap Runners - Color Terminal v18 Saved Material',
    description: 'Saves Plastic or Metal with the successful appearance purchase, permits material-only changes, updates both retained baselines, and preserves the v17 exact color sync and occupied-seat purchase guard.',
    owner: owner(scene),
  };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, terminalGrid };
}

function finite(value, name) {
  if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite ${name}`);
  else if (Array.isArray(value)) value.forEach((child, index) =>
    finite(child, `${name}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value)
    .forEach(([key, child]) => finite(child, `${name}.${key}`));
}

module.exports = build;
if (require.main === module) {
  const result = build();
  result.scene.bricks.forEach((brick, index) => finite(brick, `terminal[${index}]`));
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    materialPersistence: 'selected Plastic/Metal -> Truck1Material 0/1',
    purchaseChanged: 'color OR material',
    truck: 'unchanged v8',
  }, null, 2));
}
