'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV13 = require('./test-scrap-runners-color-terminal-v13.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V13_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v13.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V14_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v14.brz');
const DEFAULT_V14_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v14.cjs');

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
  const row = (type, predicate = () => true, label = type) => one(all(type, predicate), label);
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const source = edge => bricks.get(edge.a);
  const target = edge => bricks.get(edge.z);
  return { scene, bricks, rows, all, one, row, incoming, outgoing, source, target };
}

function isExecPort(t, brick, type, port) {
  const saved = component(brick, type);
  if (saved?.data?.[port]?.$variant === 'WireGraphExec') return true;
  if (type === C.BufferTicks.NAME && ['Input', 'Output'].includes(port)) return true;
  if (/^(?:Exec|Pulse|Expired|OnRisingEdge|OnFallingEdge|bPulseOnChange)/.test(port)) return true;
  if (/^RER_/.test(port)) {
    return ['CallableDefault', 'CallableMirror', 'CallableResult']
      .some(field => saved?.data?.[field]?.$variant === 'WireGraphExec');
  }
  return false;
}

function execReachable(scene, start, goal, limit = 6000) {
  const t = api(scene);
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === goal.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of scene.edges) {
      if (edge.a !== key || !isExecPort(t, brick, edge.at, edge.p)
        || !isExecPort(t, t.target(edge), edge.zt, edge.q) || seen.has(edge.z)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return seen.has(goal.key);
}

function dataReachable(t, start, goal, limit = 6000) {
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === goal.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || isExecPort(t, brick, edge.at, edge.p)
        || isExecPort(t, t.target(edge), edge.zt, edge.q) || seen.has(edge.z)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return seen.has(goal.key);
}

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  const source = t.source(edge);
  return { edge, brick: source, comp: component(source, edge.at) };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function componentDataSignature(scene, predicate) {
  return scene.bricks.flatMap(brick => brick.comps)
    .filter(comp => predicate(comp.type, comp.data))
    .map(comp => JSON.stringify([comp.type, canonical(comp.data)]))
    .sort();
}

function assertPreservedSurface(v13, v14) {
  const oldT = api(v13);
  const newT = api(v14);
  const oldScreen = oldT.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v13 physical screen');
  const newScreen = newT.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v14 physical screen');
  assert.deepEqual(newScreen.brick.data, oldScreen.brick.data,
    'v14 preserves the physical screen brick layout');
  assert.deepEqual(newScreen.comp.data, oldScreen.comp.data,
    'v14 preserves the physical screen fallback presentation');

  const purchaseTypes = new Set([
    C.Exec_Gamemode_SetLeaderboardValue.NAME,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
  ]);
  assert.deepEqual(componentDataSignature(v14, type => purchaseTypes.has(type)),
    componentDataSignature(v13, type => purchaseTypes.has(type)),
    'v14 preserves every leaderboard purchase write and debit configuration');
  assert.deepEqual(componentDataSignature(v14, type => /Audio/.test(type)),
    componentDataSignature(v13, type => /Audio/.test(type)),
    'v14 preserves every interactive audio component and setting');
}

function assertV13BuyBug(v13) {
  const t = api(v13);
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'v13 InputSplitter').brick;
  const inputUp = t.one(t.outgoing(splitter, C.InputSplitter.NAME, 'InputUp'),
    'v13 direct InputUp purchase edge');
  const buyGuard = t.target(inputUp);
  assert.equal(inputUp.zt, C.Exec_Branch.NAME,
    'v13 reproduces InputUp wired straight into a Branch');
  assert.equal(inputUp.q, 'Exec',
    'v13 reproduces a numeric seat axis wired directly into Exec');

  const condition = sourceOf(t, buyGuard, C.Exec_Branch.NAME, 'bCond',
    'v13 BUY selection condition');
  assert.equal(condition.comp?.type, C.Expr_CompareEqual.NAME,
    'v13 BUY guard condition is only the selection comparison');
  assert([valueOf(condition.comp.data.InputA), valueOf(condition.comp.data.InputB)].includes(5),
    'v13 BUY selection comparison selects row 5');

  const blink = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    'v13 selection blink clock').brick;
  const sessionReady = sourceOf(t, blink, C.Clock.NAME, 'bEnabled',
    'v13 seated-session state').brick;
  assert(!dataReachable(t, sessionReady, condition.brick),
    'v13 BUY condition reproduces the missing seated-session requirement');
  return { splitter, buyGuard, sessionReady };
}

function assertBuySafety(v14) {
  const t = api(v14);
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'v14 InputSplitter').brick;
  const inputUpEdges = t.outgoing(splitter, C.InputSplitter.NAME, 'InputUp');
  assert.equal(inputUpEdges.length, 1, 'InputUp has one normalized purchase-input consumer');
  assert(inputUpEdges.every(edge => !isExecPort(t, t.target(edge), edge.zt, edge.q)),
    'InputUp numeric axis never drives an Exec port directly');

  const pressedEdge = inputUpEdges[0];
  const pressed = t.target(pressedEdge);
  const pressedComp = component(pressed, C.Expr_CompareGreater.NAME);
  assert(pressedComp, 'InputUp first passes through a > 0.5 comparator');
  assert.equal(pressedEdge.q, 'InputA', 'InputUp drives the comparator value input');
  assert.equal(valueOf(pressedComp.data.InputB), 0.5,
    'Space activation threshold is exactly 0.5');

  const normalizedEdges = t.outgoing(pressed, C.Expr_CompareGreater.NAME, 'bOutput');
  assert.equal(normalizedEdges.length, 1,
    'normalized Space state has one edge-detector consumer');
  const detectorEdge = normalizedEdges[0];
  const detector = t.target(detectorEdge);
  const detectorComp = component(detector, C.Expr_EdgeDetectorExec.NAME);
  assert(detectorComp,
    'normalized Space state feeds an executable edge detector');
  assert.equal(detectorEdge.q, 'Input');
  assert.equal(valueOf(detectorComp.data.Input), 0,
    'Space edge detector is saved with a neutral current input');
  assert.equal(valueOf(detectorComp.data.InputLast), 0,
    'Space edge detector is saved with a neutral previous input');
  assert.equal(detectorComp.data.bSeeded, true,
    'Space edge detector is seeded so load cannot synthesize a BUY edge');

  const rising = t.outgoing(detector, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge');
  assert.equal(rising.length, 1, 'Space has exactly one rising-edge purchase attempt');
  const buyGuard = t.target(rising[0]);
  assert(component(buyGuard, C.Exec_Branch.NAME),
    'Space rising edge executes the BUY authorization branch');
  assert.equal(rising[0].q, 'Exec');
  assert.equal(t.incoming(buyGuard, C.Exec_Branch.NAME, 'Exec').length, 1,
    'BUY authorization has no release/reset execution source');

  const falling = t.outgoing(detector, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge');
  assert.equal(falling.length, 0,
    'Space release and seat-exit axis reset cannot execute purchase logic');

  const blink = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    'v14 selection blink clock').brick;
  const sessionReady = sourceOf(t, blink, C.Clock.NAME, 'bEnabled',
    'v14 seated-session state').brick;
  assert(component(sessionReady, C.Var.NAME), 'seated-session state is retained in a Var');

  const guardCond = sourceOf(t, buyGuard, C.Exec_Branch.NAME, 'bCond',
    'v14 BUY authorization condition');
  assert.equal(guardCond.comp?.type, C.Expr_LogicalAND.NAME,
    'BUY authorization combines selection and seated session');
  const andInputs = ['bInputA', 'bInputB'].map(port => sourceOf(t, guardCond.brick,
    C.Expr_LogicalAND.NAME, port, `BUY authorization ${port}`));
  assert(andInputs.some(input => input.brick.key === sessionReady.key && input.edge.p === 'Value'),
    'BUY authorization directly requires the seated-session Var');
  const selected = andInputs.find(input => input.brick.key !== sessionReady.key);
  assert.equal(selected?.comp?.type, C.Expr_CompareEqual.NAME,
    'the other BUY authorization input is the selected-row comparison');
  assert([valueOf(selected.comp.data.InputA), valueOf(selected.comp.data.InputB)].includes(5),
    'BUY authorization still requires row 5');

  const colorWrite = t.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    () => true, 'color purchase leaderboard write').brick;
  const scrapDebit = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'purchase Scrap debit').brick;
  assert(execReachable(v14, buyGuard, colorWrite),
    'authorized rising-edge BUY reaches the saved-color write');
  assert(execReachable(v14, buyGuard, scrapDebit),
    'authorized rising-edge BUY reaches the Scrap debit');

  // Re-sample both retained session state and physical seat occupancy at the
  // last branch immediately before the irreversible leaderboard mutation.
  const colorWriteExec = sourceOf(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec', 'final color write authorization');
  assert.equal(colorWriteExec.comp?.type, C.Exec_Branch.NAME,
    'SetLeaderboardValue is executed only by a final mutation guard');
  assert.equal(colorWriteExec.edge.p, 'ExecOutA',
    'only the authorized branch output can write the new color');
  const mutationGuard = colorWriteExec.brick;
  assert(execReachable(v14, buyGuard, mutationGuard),
    'the rising-edge BUY transaction reaches the final mutation guard');
  const mutationCond = sourceOf(t, mutationGuard, C.Exec_Branch.NAME,
    'bCond', 'final color mutation condition');
  assert.equal(mutationCond.comp?.type, C.Expr_LogicalAND.NAME,
    'final mutation requires both session and physical seat state');
  const seat = t.row(C.Seat.NAME, () => true, 'terminal seat').brick;
  const mutationInputs = ['bInputA', 'bInputB'].map(port => sourceOf(t,
    mutationCond.brick, C.Expr_LogicalAND.NAME, port, `final mutation ${port}`));
  assert(mutationInputs.some(input => input.brick.key === sessionReady.key
    && input.edge.p === 'Value'),
  'final mutation directly resamples the seated-session Var');
  assert(mutationInputs.some(input => input.brick.key === seat.key
    && input.edge.p === 'bIsOccupied'),
  'final mutation directly resamples physical Seat occupancy');

  return { splitter, pressed, detector, buyGuard, sessionReady, mutationGuard,
    colorWrite, scrapDebit };
}

function assertLocalAppearanceAuthority(v14, v13, truck) {
  const t = api(v14);
  const old = api(v13);
  const v = api(truck);
  const entered = t.row(C.EntityZoneEvent_Entered.NAME, () => true,
    'vehicle zone entered').brick;
  const terminalGrid = entered.g;
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'terminal InputSplitter').brick;
  const coreGrid = splitter.g;

  // v13's terminal could execute a wireless request and let reply Data3-5
  // write snapshot setters. v14 has no terminal-side gate for either event, so
  // a late or malformed reply has no execution or data path into picker state.
  assert.equal(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request').length, 0,
  'v14 terminal contains no SR.Appearance.Request sender');
  assert.equal(t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply').length, 0,
  'v14 terminal contains no SR.Appearance.Reply receiver');
  const oldRequest = old.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request',
    'v13 appearance request sender').brick;
  const oldReply = old.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply',
    'v13 appearance reply receiver').brick;
  assert.equal(old.incoming(oldRequest, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn').length, 1,
    'v13 negative fixture actively executes the wireless request');
  assert(old.outgoing(oldReply, C.Event_CustomGlobal.NAME, 'ExecOut').length > 0,
    'v13 negative fixture actively executes reply processing');
  for (const port of ['DataOut3', 'DataOut4', 'DataOut5']) {
    assert(old.outgoing(oldReply, C.Event_CustomGlobal.NAME, port).some(edge =>
      edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
    `v13 negative fixture lets ${port} feed a snapshot setter`);
  }
  assert.equal(v.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request').length, 1,
  'unchanged v8 truck retains its now-dormant request responder');
  assert.equal(v.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply').length, 1,
  'unchanged v8 truck retains its now-dormant reply sender');

  // CURRENT COLOR's existing dynamic getter is proven in game. Its completed
  // read waits one tick, starts a same-player Truck1Material read, then waits a
  // second tick before evaluating the initialization guard.
  const currentColorGet = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === ''
      && t.outgoing(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
        .some(edge => component(t.target(edge), C.Expr_MathMax.NAME))),
  'authoritative current-color getter').brick;
  const savedMaterialGet = t.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Truck1Material',
    'local Truck1Material getter').brick;
  const colorPlayer = t.one(t.incoming(currentColorGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'),
  'current-color PlayerState');
  const materialPlayer = t.one(t.incoming(savedMaterialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'),
  'saved-material PlayerState');
  assert.deepEqual([materialPlayer.a, materialPlayer.at, materialPlayer.p],
    [colorPlayer.a, colorPlayer.at, colorPlayer.p],
    'color and material are read for the exact same PlayerState');

  const colorDelayEdge = t.one(t.outgoing(currentColorGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.BufferTicks.NAME)),
  'color publication delay');
  const colorDelay = t.target(colorDelayEdge);
  assert.equal(valueOf(component(colorDelay, C.BufferTicks.NAME).data.TicksToWait), 1,
    'material read starts one tick after current-color completion');
  const materialExec = t.one(t.outgoing(colorDelay, C.BufferTicks.NAME, 'Output'),
    'buffered material read');
  assert.equal(materialExec.z, savedMaterialGet.key);
  assert.equal(materialExec.q, 'Exec');

  const materialDelayEdge = t.one(t.outgoing(savedMaterialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.BufferTicks.NAME)),
  'material publication delay');
  const materialDelay = t.target(materialDelayEdge);
  assert.equal(valueOf(component(materialDelay, C.BufferTicks.NAME).data.TicksToWait), 1,
    'initialization waits one tick after material completion');
  const initializeEdge = t.one(t.outgoing(materialDelay, C.BufferTicks.NAME, 'Output'),
    'buffered initialization guard');
  const initializeGuard = t.target(initializeEdge);
  assert(component(initializeGuard, C.Exec_Branch.NAME),
    'saved values enter one initialization branch');
  assert.equal(initializeEdge.q, 'Exec');

  const blink = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    'selection blink clock').brick;
  const sessionReady = sourceOf(t, blink, C.Clock.NAME, 'bEnabled',
    'seated-session state').brick;
  const colorReadStart = sourceOf(t, currentColorGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec', 'current-color read start').brick;
  assert(component(colorReadStart, C.Exec_Var_Set.NAME));
  const colorRefresh = sourceOf(t, colorReadStart, C.Exec_Var_Set.NAME,
    'Exec', 'current-color refresh union').brick;
  assert(component(colorRefresh, C.Exec_Union.NAME));
  const refreshBranches = t.incoming(colorRefresh, C.Exec_Union.NAME)
    .map(edge => t.source(edge)).filter(brick => component(brick, C.Exec_Branch.NAME));
  assert.equal(refreshBranches.length, 2,
    'session and supported-vehicle branches can refresh current color');
  const vehicleBranch = t.one(refreshBranches.filter(branch => {
    const cond = t.one(t.incoming(branch, C.Exec_Branch.NAME, 'bCond'),
      'current-color refresh condition');
    return cond.a !== sessionReady.key;
  }), 'supported-vehicle refresh branch');
  const vehicleSupported = sourceOf(t, vehicleBranch, C.Exec_Branch.NAME,
    'bCond', 'supported-vehicle state').brick;
  assert(component(vehicleSupported, C.Var.NAME));

  const outerAnd = sourceOf(t, initializeGuard, C.Exec_Branch.NAME,
    'bCond', 'local initialization condition');
  assert.equal(outerAnd.comp?.type, C.Expr_LogicalAND.NAME,
    'local initialization outer condition is an AND');
  const outerInputs = ['bInputA', 'bInputB'].map(port => sourceOf(t, outerAnd.brick,
    C.Expr_LogicalAND.NAME, port, `local initialization ${port}`));
  const notReady = outerInputs.find(input => input.comp?.type === C.Expr_LogicalNOT.NAME);
  const activeAnd = outerInputs.find(input => input.comp?.type === C.Expr_LogicalAND.NAME);
  assert(notReady && activeAnd,
    'local initialization requires active supported session AND not-ready');
  const appearanceReady = sourceOf(t, notReady.brick, C.Expr_LogicalNOT.NAME,
    'bInput', 'appearance-ready state').brick;
  assert(component(appearanceReady, C.Var.NAME));
  const activeSources = ['bInputA', 'bInputB'].map(port => sourceOf(t, activeAnd.brick,
    C.Expr_LogicalAND.NAME, port, `active initialization ${port}`).brick.key).sort();
  assert.deepEqual(activeSources, [sessionReady.key, vehicleSupported.key].sort(),
    'init guard is exactly sessionReady && vehicleSupported && !appearanceReady');

  // The accepted branch snapshots score, mapped material, and raw intensity
  // 128 in one ordered transaction, then waits one tick before core decode.
  const firstSnapshot = t.one(t.outgoing(initializeGuard,
    C.Exec_Branch.NAME, 'ExecOutA'), 'accepted initialization snapshot');
  const colorSetter = t.target(firstSnapshot);
  assert(component(colorSetter, C.Exec_Var_Set.NAME));
  const secondSnapshot = t.one(t.outgoing(colorSetter,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'color-to-material snapshot order');
  const materialSetter = t.target(secondSnapshot);
  assert(component(materialSetter, C.Exec_Var_Set.NAME));
  const thirdSnapshot = t.one(t.outgoing(materialSetter,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'material-to-intensity snapshot order');
  const intensitySetter = t.target(thirdSnapshot);
  assert(component(intensitySetter, C.Exec_Var_Set.NAME));
  for (const setter of [colorSetter, materialSetter, intensitySetter]) {
    assert.equal(t.incoming(setter, C.Exec_Var_Set.NAME, 'Exec').length, 1,
      'each local snapshot setter has exactly one ordered Exec source');
  }

  const colorValue = sourceOf(t, colorSetter, C.Exec_Var_Set.NAME,
    'Value', 'local color snapshot value');
  assert.equal(colorValue.brick.key, currentColorGet.key,
    'local color snapshot directly uses proven current-color Value');
  assert.equal(colorValue.edge.p, 'Value');
  const colorState = sourceOf(t, colorSetter, C.Exec_Var_Set.NAME,
    'VarRef', 'live color-score state').brick;
  const materialState = sourceOf(t, materialSetter, C.Exec_Var_Set.NAME,
    'VarRef', 'live material state').brick;
  const intensityState = sourceOf(t, intensitySetter, C.Exec_Var_Set.NAME,
    'VarRef', 'live intensity state').brick;
  assert.equal(component(colorState, C.Var.NAME)?.data.Value?.$variant, 'i64');
  assert.equal(component(materialState, C.Var.NAME)?.data.Value?.$variant, 'f64');
  assert.equal(component(intensityState, C.Var.NAME)?.data.Value?.$variant, 'f64');
  for (const [state, setter, label] of [
    [colorState, colorSetter, 'color'],
    [materialState, materialSetter, 'material'],
    [intensityState, intensitySetter, 'intensity'],
  ]) {
    const writers = t.outgoing(state, C.Var.NAME, 'VarRef')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => t.target(edge));
    assert.deepEqual(writers.map(brick => brick.key), [setter.key],
      `${label} live state has only its local authoritative writer`);
  }

  const savedMetalCompare = t.one(t.outgoing(savedMaterialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value').map(edge => t.target(edge))
    .filter(brick => component(brick, C.Expr_CompareEqual.NAME)),
  'saved material Metal comparison');
  const metalCompare = component(savedMetalCompare, C.Expr_CompareEqual.NAME);
  assert.equal(valueOf(metalCompare.data.InputB), 1,
    'saved Truck1Material score 1 means Metal');
  assert(t.incoming(savedMetalCompare, C.Expr_CompareEqual.NAME, 'InputA')
    .some(edge => edge.a === savedMaterialGet.key && edge.p === 'Value'));
  const selectEdge = t.one(t.outgoing(savedMetalCompare,
    C.Expr_CompareEqual.NAME, 'bOutput'), 'saved material select');
  const materialSelect = t.target(selectEdge);
  const selectComp = component(materialSelect, C.Expr_Select.NAME);
  assert(selectComp, 'saved material comparison drives a numeric Select');
  assert.equal(selectEdge.q, 'bSelectB');
  assert.equal(valueOf(selectComp.data.InputA), 0, 'Plastic maps to material 0');
  assert.equal(valueOf(selectComp.data.InputB), 4, 'Metal maps to material 4');
  const materialValue = sourceOf(t, materialSetter, C.Exec_Var_Set.NAME,
    'Value', 'local material snapshot value');
  assert.equal(materialValue.brick.key, materialSelect.key,
    'local material snapshot uses the saved-score mapping');
  assert.equal(materialValue.edge.p, 'Output');
  assert.equal(t.incoming(intensitySetter, C.Exec_Var_Set.NAME, 'Value').length, 0,
    'baseline intensity snapshot is a fixed saved value');
  assert.equal(valueOf(component(intensitySetter, C.Exec_Var_Set.NAME).data.Value), 128,
    'local initialization starts raw intensity at 128 (50%)');

  const settleEdge = t.one(t.outgoing(intensitySetter,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'completed snapshot settle');
  const settle = t.target(settleEdge);
  assert(component(settle, C.BufferTicks.NAME));
  assert.equal(valueOf(component(settle, C.BufferTicks.NAME).data.TicksToWait), 1,
    'all local snapshots settle for one tick before core decode');

  // Live state crosses into the picker core directly. The former nested
  // Appearance Sync output/input remains present only as an inert interface.
  const scoreConsumers = t.outgoing(colorState, C.Var.NAME, 'Value')
    .filter(edge => t.target(edge).g === coreGrid
      && component(t.target(edge), C.Expr_MathMax.NAME));
  assert(scoreConsumers.length >= 1,
    'live packed score directly drives the core RGB decoder clamp');
  const materialConsumers = t.outgoing(materialState, C.Var.NAME, 'Value')
    .filter(edge => t.target(edge).g === coreGrid
      && component(t.target(edge), C.Expr_CompareEqual.NAME));
  assert(materialConsumers.length >= 1,
    'live material directly drives the core Plastic/Metal decoder');
  const intensityConsumers = t.outgoing(intensityState, C.Var.NAME, 'Value')
    .filter(edge => t.target(edge).g === coreGrid
      && component(t.target(edge), C.Expr_MathMax.NAME) && edge.q === 'InputA');
  assert.equal(intensityConsumers.length, 1,
    'live raw intensity directly drives the core lower clamp');

  const coreStartEdge = t.one(t.outgoing(settle, C.BufferTicks.NAME, 'Output'),
    'direct local-to-core synchronization');
  const firstCoreSetter = t.target(coreStartEdge);
  assert.equal(firstCoreSetter.g, coreGrid,
    'local settle directly enters the picker core grid');
  assert(component(firstCoreSetter, C.Exec_Var_Set.NAME));
  assert.equal(coreStartEdge.q, 'Exec');
  assert.equal(t.incoming(firstCoreSetter, C.Exec_Var_Set.NAME, 'Exec').length, 1,
    'first core setter has no nested relay execution source');

  const terminalSync = t.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === terminalGrid && data.PortLabel === 'Appearance Sync',
    'retired terminal Appearance Sync output').brick;
  const coreSync = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Appearance Sync',
    'retired core Appearance Sync input').brick;
  assert.equal(t.incoming(terminalSync, C.MicrochipOutput.NAME, 'RER_Input').length, 0,
    'terminal Appearance Sync output is no longer authoritative');
  assert.equal(t.outgoing(coreSync, C.MicrochipInput.NAME, 'RER_Output').length, 0,
    'core Appearance Sync input no longer starts initialization');

  const readySetters = t.outgoing(appearanceReady, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => t.target(edge));
  const readyTrue = readySetters.filter(setter =>
    valueOf(component(setter, C.Exec_Var_Set.NAME).data.Value) === true);
  assert.equal(readyTrue.length, 1, 'only one setter marks local appearance ready');
  const coreSetters = [firstCoreSetter];
  while (true) {
    const next = t.outgoing(coreSetters.at(-1), C.Exec_Var_Set.NAME, 'ExecOut')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME
        && t.target(edge).g === coreGrid);
    assert(next.length <= 1, 'core appearance synchronization is a single ordered chain');
    if (!next.length) break;
    coreSetters.push(t.target(next[0]));
  }
  assert.equal(coreSetters.length, 5,
    'core synchronization writes H, S, B, Material, and Intensity in order');
  const readyExec = sourceOf(t, readyTrue[0], C.Exec_Var_Set.NAME,
    'Exec', 'appearance-ready completion');
  assert.equal(readyExec.brick.key, coreSetters.at(-1).key,
    'only the final core appearance setter marks initialization ready');
  assert.equal(readyExec.edge.p, 'ExecOut');

  const oldSplitter = old.row(C.InputSplitter.NAME, () => true,
    'v13 InputSplitter').brick;
  const oldCoreSync = old.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === oldSplitter.g && data.PortLabel === 'Appearance Sync',
    'v13 core Appearance Sync input').brick;
  assert(old.outgoing(oldCoreSync, C.MicrochipInput.NAME, 'RER_Output').length > 0,
    'v13 negative fixture starts core sync through the nested relay');

  return {
    currentColorGet, savedMaterialGet, colorDelay, materialDelay,
    initializeGuard, sessionReady, vehicleSupported, appearanceReady,
    colorState, materialState, intensityState, settle, firstCoreSetter,
  };
}

function test({
  previousTerminal = DEFAULT_V13_TERMINAL,
  previousTruck = DEFAULT_V8_TRUCK,
  terminalOutput = DEFAULT_V14_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V14_BUILDER,
} = {}) {
  // v14 intentionally replaces the v11-v13 wireless appearance authority. Run
  // the complete inherited suite against its committed v13/v8 baseline, then
  // enforce only the deliberate local-authority delta below.
  testV13();

  const oldTerminalBytes = fs.readFileSync(previousTerminal);
  const oldTruckBytes = fs.readFileSync(previousTruck);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const oldTerminal = read(oldTerminalBytes);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);

  assert(validate(terminalBytes).strictOk, 'v14 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged v8 truck passes strict placement');
  assert.deepEqual(truckBytes, oldTruckBytes,
    'v14 uses the exact proven v8 truck without modifying it');
  assertPreservedSurface(oldTerminal, terminal);
  assertV13BuyBug(oldTerminal);
  const buy = assertBuySafety(terminal);
  const appearance = assertLocalAppearanceAuthority(terminal, oldTerminal, truck);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  assert.equal(typeof build, 'function', 'v14 builder exports its build function');
  const first = build();
  const second = build();
  const firstTerminal = first.terminal?.bytes || first.terminalBytes;
  const secondTerminal = second.terminal?.bytes || second.terminalBytes;
  const firstTruck = first.truck?.bytes || first.truckBytes;
  const secondTruck = second.truck?.bytes || second.truckBytes;
  assert(firstTerminal && secondTerminal && firstTruck && secondTruck,
    'v14 builder returns both terminal and truck bytes');
  assert.deepEqual(firstTerminal, secondTerminal, 'v14 terminal build is deterministic');
  assert.deepEqual(firstTruck, secondTruck, 'v8 truck rebuild is deterministic');
  assert.deepEqual(Buffer.from(firstTerminal), Buffer.from(terminalBytes),
    'checked v14 terminal output matches a fresh build');
  assert.deepEqual(Buffer.from(firstTruck), Buffer.from(truckBytes),
    'checked v8 truck output matches a fresh v14 build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckBricks: truck.bricks.length,
    truckWires: truck.edges.length,
    truckSha256: sha256(truckBytes),
    localAppearanceAuthority: {
      color: 'current-color leaderboard Value',
      material: component(appearance.savedMaterialGet,
        C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key,
      intensity: 128,
      wirelessSrTerminalPath: 'removed',
      directCoreSync: true,
    },
    buyInputSafety: {
      threshold: valueOf(component(buy.pressed, C.Expr_CompareGreater.NAME).data.InputB),
      risingEdgeOnly: true,
      requiresSeatedSession: true,
      finalPhysicalSeatGuard: true,
    },
    inheritedV13Regressions: 'passed on v13/v8 baseline',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  previousTerminal: process.argv[2] || DEFAULT_V13_TERMINAL,
  previousTruck: process.argv[3] || DEFAULT_V8_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V14_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V14_BUILDER,
});

module.exports = test;
