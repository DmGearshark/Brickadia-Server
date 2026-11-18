'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV17 = require('./test-scrap-runners-color-terminal-v17.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const DEFAULT_V17_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v17.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V18_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v18.brz');
const DEFAULT_V18_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v18.cjs');
const V8_TRUCK_SHA256 = '698b8b21594f791ab6bc96cd65b7adad2b39daa0f5c6930a725af5ae88c1b621';

const valueOf = value => value && typeof value === 'object' && '$variant' in value
  ? value.value : value;

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const source = edge => bricks.get(edge.a);
  const target = edge => bricks.get(edge.z);
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  return { scene, bricks, rows, all, one, incoming, outgoing, source, target, label };
}

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  return { edge, brick: t.source(edge), comp: component(t.source(edge), edge.at) };
}

function targetOf(t, brick, type, port, label) {
  const edge = t.one(t.outgoing(brick, type, port), label);
  return { edge, brick: t.target(edge), comp: component(t.target(edge), edge.zt) };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort, label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
}

function execReachable(scene, start, goal) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const queue = [start.key];
  const seen = new Set(queue);
  const execPorts = new Set(['ExecOut', 'ExecOutA', 'ExecOutB', 'Output',
    'OnRisingEdge', 'bPulseOnChange']);
  while (queue.length) {
    const key = queue.shift();
    if (key === goal.key) return true;
    for (const edge of scene.edges.filter(candidate => candidate.a === key
      && execPorts.has(candidate.p))) {
      if (!bricks.has(edge.z) || seen.has(edge.z)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return false;
}

function publicMaterialOutput(t) {
  return t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Material').filter(({ brick }) => t.outgoing(brick,
    C.MicrochipOutput.NAME, 'RER_Output').some(edge =>
    edge.zt === C.Exec_SendCustomEventGlobal.NAME && edge.q === 'DataIn2')),
  'public selected Material output').brick;
}

function materialPurchaseContract(scene) {
  const t = api(scene);
  const writes = t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME);
  assert.equal(writes.length, 2, 'v18 has exactly color and material writes');
  const colorWrite = t.one(writes.filter(item => item.comp.data.Key === ''),
    'dynamic saved-color write').brick;
  const materialWrite = t.one(writes.filter(item => item.comp.data.Key === 'Truck1Material'),
    'fixed saved-material write').brick;
  const selectedMaterial = publicMaterialOutput(t);
  const materialState = t.label('Live material snapshot');

  const materialChanged = t.label('Selected material differs from saved material');
  assert(component(materialChanged, C.Expr_CompareNotEqual.NAME));
  assertEdge(t, materialState, C.Var.NAME, 'Value', materialChanged,
    C.Expr_CompareNotEqual.NAME, 'InputA', 'saved material comparison input');
  assertEdge(t, selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output', materialChanged,
    C.Expr_CompareNotEqual.NAME, 'InputB', 'selected material comparison input');

  const appearanceChanged = targetOf(t, materialChanged, C.Expr_CompareNotEqual.NAME,
    'bOutput', 'material changed OR target').brick;
  assert(component(appearanceChanged, C.Expr_LogicalOR.NAME),
    'appearance changed uses Logical OR');
  const orInputs = ['bInputA', 'bInputB'].map(port => sourceOf(t, appearanceChanged,
    C.Expr_LogicalOR.NAME, port, `appearance changed ${port}`).brick);
  assert(orInputs.includes(materialChanged), 'OR includes material changed');
  const colorChanged = orInputs.find(brick => brick !== materialChanged);
  assert(component(colorChanged, C.Expr_CompareNotEqual.NAME),
    'OR retains existing color changed comparison');
  const appearanceBranch = targetOf(t, appearanceChanged, C.Expr_LogicalOR.NAME,
    'bOutput', 'appearance changed branch').brick;
  assert(component(appearanceBranch, C.Exec_Branch.NAME));
  assertEdge(t, appearanceChanged, C.Expr_LogicalOR.NAME, 'bOutput', appearanceBranch,
    C.Exec_Branch.NAME, 'bCond', 'color-or-material drives already-applied branch');

  const changed = (color, material) => color || material;
  assert.equal(changed(false, false), false, 'unchanged color and material is rejected');
  assert.equal(changed(true, false), true, 'color-only change is purchasable');
  assert.equal(changed(false, true), true, 'material-only change is purchasable');
  assert.equal(changed(true, true), true, 'combined appearance change is purchasable');

  const materialScore = sourceOf(t, materialWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value', 'material score encoder').brick;
  const select = component(materialScore, C.Expr_Select.NAME);
  assert(select, 'material score is encoded through Select');
  assert.equal(valueOf(select.data.InputA), 0, 'Plastic encodes to score 0');
  assert.equal(valueOf(select.data.InputB), 1, 'Metal encodes to score 1');
  assert.equal(select.data.InputA.$variant, 'i64', 'Plastic score is i64');
  assert.equal(select.data.InputB.$variant, 'i64', 'Metal score is i64');
  const isMetal = sourceOf(t, materialScore, C.Expr_Select.NAME,
    'bSelectB', 'selected material is Metal').brick;
  const compare = component(isMetal, C.Expr_CompareEqual.NAME);
  assert(compare, 'Metal encoder compares selected material');
  assert.equal(valueOf(compare.data.InputB), 4, 'Metal enum is numeric 4');
  assertEdge(t, selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output', isMetal,
    C.Expr_CompareEqual.NAME, 'InputA', 'selected material reaches Metal encoder');

  const colorPlayer = sourceOf(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'PlayerState', 'color purchase PlayerState');
  const materialPlayer = sourceOf(t, materialWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'PlayerState', 'material purchase PlayerState');
  assert.equal(materialPlayer.brick.key, colorPlayer.brick.key,
    'material saves to the same player as color');
  assert.equal(materialPlayer.edge.p, colorPlayer.edge.p,
    'material and color use the same PlayerState output');

  const finalGuard = sourceOf(t, colorWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME,
    'Exec', 'final occupied-seat mutation guard').brick;
  assert.equal(t.label('Final seated-session BUY guard').key, finalGuard.key,
    'color write remains directly behind final seated-session guard');
  const guardCondition = sourceOf(t, finalGuard, C.Exec_Branch.NAME,
    'bCond', 'final guard condition').brick;
  assert(component(guardCondition, C.Expr_LogicalAND.NAME),
    'final guard still requires session and physical seat');
  assert(t.incoming(guardCondition, C.Expr_LogicalAND.NAME).some(edge =>
    edge.at === C.Seat.NAME && edge.p === 'bIsOccupied'),
  'final irreversible mutation guard still reads Seat.bIsOccupied');

  const colorBaseline = t.label('Update CURRENT COLOR after successful purchase');
  const materialBaseline = t.label('Update saved material baseline after successful purchase');
  const scrapDebit = t.one(t.all(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap'), 'Scrap debit').brick;
  assertEdge(t, colorWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut', materialWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec', 'color then material write');
  assert.equal(t.incoming(materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME,
    'Exec').length, 1, 'material write has one guarded execution source');
  assertEdge(t, materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    colorBaseline, C.Exec_Var_Set.NAME, 'Exec', 'material write then color baseline');
  assertEdge(t, colorBaseline, C.Exec_Var_Set.NAME, 'ExecOut', materialBaseline,
    C.Exec_Var_Set.NAME, 'Exec', 'color then material baseline');
  assertEdge(t, materialBaseline, C.Exec_Var_Set.NAME, 'ExecOut', scrapDebit,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec', 'both baselines before debit');
  assertEdge(t, materialState, C.Var.NAME, 'VarRef', materialBaseline,
    C.Exec_Var_Set.NAME, 'VarRef', 'purchase updates retained material baseline');
  assertEdge(t, selectedMaterial, C.MicrochipOutput.NAME, 'RER_Output', materialBaseline,
    C.Exec_Var_Set.NAME, 'Value', 'baseline advances to purchased material');

  return { colorWrite, materialWrite, colorChanged, materialChanged,
    appearanceChanged, materialScore, materialBaseline, finalGuard };
}

function truckMaterialRestoreContract(scene) {
  const t = api(scene);
  const getter = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'Truck1Material getter').brick;
  const restore = t.one(t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color'), 'zone-exit restore receiver').brick;
  assert(execReachable(scene, restore, getter),
    'zone exit executes the persistent Truck1Material getter');
  const updateCarEvents = t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'UpdateCar').map(item => item.brick);
  assert(updateCarEvents.some(update => execReachable(scene, update, getter)),
    'spawn-time UpdateCar executes the persistent Truck1Material getter');

  const branch = t.target(t.one(t.outgoing(getter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.Exec_Branch.NAME)),
  'material getter completion branch'));
  const condition = sourceOf(t, branch, C.Exec_Branch.NAME,
    'bCond', 'saved material score condition').brick;
  const compare = component(condition, C.Expr_CompareEqual.NAME);
  assert(compare, 'saved material score is compared explicitly');
  assert.equal(valueOf(compare.data.InputA), 1, 'saved score 1 means Metal');
  assert(t.incoming(condition, C.Expr_CompareEqual.NAME, 'InputB').some(edge =>
    edge.a === getter.key && edge.p === 'Value'),
  'saved score drives material restore condition');
  const metalSetter = t.target(t.one(t.outgoing(branch, C.Exec_Branch.NAME,
    'ExecOutA'), 'Metal restore setter'));
  const plasticSetter = t.target(t.one(t.outgoing(branch, C.Exec_Branch.NAME,
    'ExecOutB'), 'Plastic restore setter'));
  assert.equal(valueOf(component(metalSetter, C.Exec_Var_Set.NAME).data.Value).value, 4,
    'saved score 1 restores Metal enum 4');
  assert.equal(valueOf(component(plasticSetter, C.Exec_Var_Set.NAME).data.Value).value, 0,
    'saved score 0 restores Plastic enum 0');
  return { getter, restore, branch, updateCarEvents };
}

function brickSignature(brick) {
  return JSON.stringify({ g: brick.g, data: brick.data, comps: brick.comps });
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}

function intendedDelta(v17, v18) {
  assert.equal(v17.bricks.length, 667);
  assert.equal(v17.edges.length, 925);
  assert.equal(v18.bricks.length, 673, 'v18 adds exactly six labeled gates');
  assert.equal(v18.edges.length, 937, 'v18 rewires only material purchase contract');

  const counts = new Map();
  for (const brick of v18.bricks) {
    const signature = brickSignature(brick);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  for (const brick of v17.bricks) {
    const signature = brickSignature(brick);
    const remaining = counts.get(signature) || 0;
    assert(remaining > 0, 'every v17 brick survives v18 unchanged');
    counts.set(signature, remaining - 1);
  }
  assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), 6,
    'component-data delta is exactly six new gates');

  const t = api(v18);
  const labels = [
    'Selected material differs from saved material',
    'Color or material differs from saved appearance',
    'Selected material is Metal enum 4',
    'Encode Plastic 0 or Metal 1 for Truck1Material',
    'Save selected Plastic or Metal',
    'Update saved material baseline after successful purchase',
  ];
  const row = labels.map(label => t.label(label));
  assert(row.every(brick => brick.g === row[0].g), 'new gates share terminal microchip');
  assert(row.every(brick => brick.data.position[1] === row[0].data.position[1]),
    'new gates share one row');
  assert(row.every(brick => brick.data.position[2] === 2), 'new gates sit on chip grid');
  for (let index = 1; index < row.length; index++) {
    const left = row[index - 1]; const right = row[index];
    assert.equal(right.data.position[0] - left.data.position[0],
      halfSize(left)[0] + halfSize(right)[0],
      `new gate ${index + 1} touches prior gate with no gap`);
  }
}

function test({
  previousTerminal = DEFAULT_V17_TERMINAL,
  previousTruck = DEFAULT_V8_TRUCK,
  terminalOutput = DEFAULT_V18_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V18_BUILDER,
} = {}) {
  testV17();

  const previousBytes = fs.readFileSync(previousTerminal);
  const previousTruckBytes = fs.readFileSync(previousTruck);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const v17 = read(previousBytes);
  const v18 = read(terminalBytes);
  const truck = read(truckBytes);

  assert(validate(terminalBytes).strictOk, 'v18 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged Truck1 v8 passes strict placement');
  assert.deepEqual(truckBytes, previousTruckBytes, 'v18 keeps exact Truck1 v8 bytes');
  assert.equal(crypto.createHash('sha256').update(truckBytes).digest('hex'),
    V8_TRUCK_SHA256, 'Truck1 v8 hash is unchanged');
  const purchase = materialPurchaseContract(v18);
  const restore = truckMaterialRestoreContract(truck);
  intendedDelta(v17, v18);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build(); const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v18 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(terminalBytes),
    'checked v18 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: v18.bricks.length,
    terminalWires: v18.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckSha256: sha256(truckBytes),
    materialSave: 'selected Plastic/Metal 0/4 -> Truck1Material 0/1',
    purchaseChanged: 'color OR material; unchanged appearance rejected',
    transaction: 'seat guard -> color -> material -> baselines -> Scrap debit',
    exitRestore: restore.restore.key,
    materialWrite: purchase.materialWrite.key,
    inheritedV17Regressions: 'passed on v17/v8 baseline',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal: v18, truck, result };
}

if (require.main === module) test({
  previousTerminal: process.argv[2] || DEFAULT_V17_TERMINAL,
  previousTruck: process.argv[3] || DEFAULT_V8_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V18_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V18_BUILDER,
});

module.exports = test;
