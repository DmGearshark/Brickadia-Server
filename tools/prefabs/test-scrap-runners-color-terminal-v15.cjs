'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV14 = require('./test-scrap-runners-color-terminal-v14.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V14_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v14.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V15_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v15.brz');
const DEFAULT_V15_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v15.cjs');

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
  if (/^RER_/.test(port)) return ['CallableDefault', 'CallableMirror', 'CallableResult']
    .some(field => saved?.data?.[field]?.$variant === 'WireGraphExec');
  return false;
}

function reachableFromPort(t, start, type, port, goal, exec) {
  const accepts = edge => {
    const sourceExec = isExecPort(t, start, edge.at, edge.p);
    const targetExec = isExecPort(t, t.target(edge), edge.zt, edge.q);
    return exec ? sourceExec && targetExec : !sourceExec && !targetExec;
  };
  const initial = t.outgoing(start, type, port).filter(accepts);
  const queue = initial.map(edge => edge.z);
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < 10000; steps++) {
    const key = queue.shift();
    if (key === goal.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || seen.has(edge.z)) continue;
      const sourceExec = isExecPort(t, brick, edge.at, edge.p);
      const targetExec = isExecPort(t, t.target(edge), edge.zt, edge.q);
      if (exec ? !(sourceExec && targetExec) : (sourceExec || targetExec)) continue;
      seen.add(edge.z); queue.push(edge.z);
    }
  }
  return seen.has(goal.key);
}

const execReachableFromPort = (t, start, type, port, goal) =>
  reachableFromPort(t, start, type, port, goal, true);
const dataReachableFromPort = (t, start, type, port, goal) =>
  reachableFromPort(t, start, type, port, goal, false);

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

function assertSurfacePreserved(v14, v15) {
  const oldT = api(v14); const t = api(v15);
  const oldScreen = oldT.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v14 physical screen');
  const screen = t.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v15 physical screen');
  assert.deepEqual(screen.brick.data, oldScreen.brick.data,
    'v15 preserves the physical terminal screen');
  assert.deepEqual(screen.comp.data, oldScreen.comp.data,
    'v15 preserves the terminal fallback text styling');
  const purchaseTypes = new Set([
    C.Exec_Gamemode_SetLeaderboardValue.NAME,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
  ]);
  assert.deepEqual(componentDataSignature(v15, type => purchaseTypes.has(type)),
    componentDataSignature(v14, type => purchaseTypes.has(type)),
    'v15 preserves leaderboard write/debit configuration');
  assert.deepEqual(componentDataSignature(v15, type => /Audio/.test(type)),
    componentDataSignature(v14, type => /Audio/.test(type)),
    'v15 preserves all interactive sounds');
}

function assertBuySafety(scene) {
  const t = api(scene);
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'terminal InputSplitter').brick;
  const inputUp = t.one(t.outgoing(splitter, C.InputSplitter.NAME, 'InputUp'),
    'only normalized InputUp route');
  assert.equal(inputUp.zt, C.Expr_CompareGreater.NAME);
  assert.equal(inputUp.q, 'InputA');
  const positive = t.target(inputUp);
  assert.equal(valueOf(component(positive, C.Expr_CompareGreater.NAME).data.InputB), 0.5);
  const detectorEdge = t.one(t.outgoing(positive,
    C.Expr_CompareGreater.NAME, 'bOutput'), 'Space rising detector');
  const detector = t.target(detectorEdge);
  const detectorData = component(detector, C.Expr_EdgeDetectorExec.NAME)?.data;
  assert(detectorData, 'Space uses EdgeDetectorExec');
  assert.equal(valueOf(detectorData.Input), 0);
  assert.equal(valueOf(detectorData.InputLast), 0);
  assert.equal(detectorData.bSeeded, true);
  assert.equal(t.outgoing(detector, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge').length, 0,
    'Space release/seat reset has no BUY route');
  const rising = t.one(t.outgoing(detector,
    C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge'), 'one Space BUY rising edge');
  const buyGuard = t.target(rising);
  assert(component(buyGuard, C.Exec_Branch.NAME));
  assert.equal(t.incoming(buyGuard, C.Exec_Branch.NAME, 'Exec').length, 1);

  const blink = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    'selection blink clock').brick;
  const sessionReady = sourceOf(t, blink, C.Clock.NAME, 'bEnabled',
    'session-ready Var').brick;
  const allowed = sourceOf(t, buyGuard, C.Exec_Branch.NAME, 'bCond',
    'BUY selection/session AND');
  assert.equal(allowed.comp?.type, C.Expr_LogicalAND.NAME);
  assert(dataReachableFromPort(t, sessionReady, C.Var.NAME, 'Value', allowed.brick),
    'BUY authorization requires retained seated session');

  const colorWrite = t.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    () => true, 'color leaderboard write').brick;
  const mutationGuard = sourceOf(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec', 'final mutation guard');
  assert.equal(mutationGuard.comp?.type, C.Exec_Branch.NAME);
  assert.equal(mutationGuard.edge.p, 'ExecOutA');
  const mutationAnd = sourceOf(t, mutationGuard.brick, C.Exec_Branch.NAME,
    'bCond', 'final session/seat AND');
  assert.equal(mutationAnd.comp?.type, C.Expr_LogicalAND.NAME);
  const seat = t.row(C.Seat.NAME, () => true, 'terminal seat').brick;
  assert(dataReachableFromPort(t, sessionReady, C.Var.NAME, 'Value', mutationAnd.brick),
    'final mutation rechecks sessionReady');
  assert(dataReachableFromPort(t, seat, C.Seat.NAME, 'bIsOccupied', mutationAnd.brick),
    'final mutation rechecks physical seat occupancy');
  const debit = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'Scrap debit').brick;
  assert(execReachableFromPort(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut', debit),
  'Scrap debit is downstream of the guarded color write');
  return { sessionReady, colorWrite, debit };
}

function appearanceReadyState(t) {
  const preview = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'vehicle preview sender').brick;
  const guard = sourceOf(t, preview, C.Exec_SendCustomEventGlobal.NAME,
    'ExecIn', 'preview readiness guard');
  assert.equal(guard.comp?.type, C.Exec_Branch.NAME);
  const ready = sourceOf(t, guard.brick, C.Exec_Branch.NAME,
    'bCond', 'appearance-ready Var').brick;
  assert(component(ready, C.Var.NAME));
  return ready;
}

function assertSettledHandshake(v15, truck) {
  const t = api(v15); const v = api(truck);
  const entered = t.row(C.EntityZoneEvent_Entered.NAME, () => true,
    'vehicle zone entered').brick;
  const left = t.row(C.EntityZoneEvent_Left.NAME, () => true,
    'vehicle zone left').brick;
  const terminalGrid = entered.g;
  const insert = t.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === entered.g, 'vehicle array insert').brick;
  const vehicleArray = sourceOf(t, insert, C.Exec_ArrayVar_Insert.NAME,
    'ArrayVarRef', 'retained vehicle array').brick;
  assert(component(vehicleArray, C.ArrayVar.NAME));
  const ready = appearanceReadyState(t);

  const request = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request', 'appearance request').brick;
  const reply = t.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'appearance reply').brick;
  assert.equal(v.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request').length, 1,
  'unchanged v8 truck receives targeted appearance requests');
  assert.equal(v.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply').length, 1,
  'unchanged v8 truck returns live appearance replies');

  const target = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'Target', 'request target vehicle');
  const echoedVehicle = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn1', 'request echoed vehicle');
  assert.equal(target.comp?.type, C.Var.NAME,
    'request target comes from a retained vehicle snapshot');
  assert.deepEqual([echoedVehicle.brick.key, echoedVehicle.edge.p],
    [target.brick.key, target.edge.p]);
  const requestVehicleState = target.brick;
  assert.equal(target.edge.p, 'Value');
  const requestVehicleWriter = t.one(t.outgoing(requestVehicleState,
    C.Var.NAME, 'VarRef').filter(edge => edge.zt === C.Exec_Var_Set.NAME),
  'retained request vehicle writer');
  const snapshotRequestVehicle = t.target(requestVehicleWriter);
  const requestVehicleValue = sourceOf(t, snapshotRequestVehicle,
    C.Exec_Var_Set.NAME, 'Value', 'settled ArrayGet vehicle value');
  assert.equal(requestVehicleValue.comp?.type, C.Exec_ArrayVar_Get.NAME);
  assert.equal(requestVehicleValue.edge.p, 'Value');
  const requestVehicle = requestVehicleValue.brick;
  const requestArray = sourceOf(t, requestVehicle, C.Exec_ArrayVar_Get.NAME,
    'ArrayVarRef', 'request vehicle array');
  assert.equal(requestArray.brick.key, vehicleArray.key);
  const requestRead = sourceOf(t, requestVehicle, C.Exec_ArrayVar_Get.NAME,
    'Exec', 'buffered request vehicle read');
  assert.equal(requestRead.comp?.type, C.BufferTicks.NAME);
  assert.equal(valueOf(requestRead.comp.data.TicksToWait), 1,
    'request waits for committed nonce/inserted vehicle');
  const vehicleDelay = sourceOf(t, snapshotRequestVehicle, C.Exec_Var_Set.NAME,
    'Exec', 'request vehicle Value settle barrier');
  assert.equal(vehicleDelay.comp?.type, C.BufferTicks.NAME);
  assert.equal(valueOf(vehicleDelay.comp.data.TicksToWait), 1,
    'request vehicle is snapshotted one tick after ArrayGet completion');
  assert(execReachableFromPort(t, requestVehicle,
    C.Exec_ArrayVar_Get.NAME, 'ExecOut', vehicleDelay.brick),
  'request ArrayGet completion reaches the vehicle settle barrier');
  const requestExecGuard = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'ExecIn', 'request retained-vehicle guard');
  assert.equal(requestExecGuard.comp?.type, C.Exec_Branch.NAME);
  const requestSnapshotDelay = sourceOf(t, requestExecGuard.brick,
    C.Exec_Branch.NAME, 'Exec', 'request snapshot settle barrier');
  assert.equal(requestSnapshotDelay.comp?.type, C.BufferTicks.NAME);
  assert.equal(valueOf(requestSnapshotDelay.comp.data.TicksToWait), 1,
    'request send waits for retained vehicle and nonce snapshots');
  assert(execReachableFromPort(t, snapshotRequestVehicle,
    C.Exec_Var_Set.NAME, 'ExecOut', requestSnapshotDelay.brick),
  'vehicle snapshot chains through nonce snapshot into send barrier');
  assert(execReachableFromPort(t, entered, C.EntityZoneEvent_Entered.NAME, 'Exec', request),
    'vehicle zone entry executes the live appearance request');
  const blink = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    'selection blink clock').brick;
  const sessionReady = sourceOf(t, blink, C.Clock.NAME,
    'bEnabled', 'seated-session state').brick;
  const sessionDetectors = t.outgoing(sessionReady, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_EdgeDetectorExec.NAME && edge.q === 'Input')
    .map(edge => t.target(edge));
  assert(sessionDetectors.some(detector => execReachableFromPort(t, detector,
    C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', request)),
  'a seated-session rising edge retries the live request while pending');

  const requestNonceState = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn2', 'retained request nonce').brick;
  assert(component(requestNonceState, C.Var.NAME));
  const requestNonceWriter = t.one(t.outgoing(requestNonceState,
    C.Var.NAME, 'VarRef').filter(edge => edge.zt === C.Exec_Var_Set.NAME),
  'retained request nonce writer');
  const snapshotRequestNonce = t.target(requestNonceWriter);
  const nonce = sourceOf(t, snapshotRequestNonce, C.Exec_Var_Set.NAME,
    'Value', 'committed nonce snapshot').brick;
  assert(component(nonce, C.Var.NAME));
  const nonceWriters = t.outgoing(nonce, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => t.target(edge));
  assert(nonceWriters.some(setter => execReachableFromPort(t, insert,
    C.Exec_ArrayVar_Insert.NAME, 'ExecOut', setter)),
  'vehicle insertion commits a new request nonce');
  assert(nonceWriters.some(setter => execReachableFromPort(t, left,
    C.EntityZoneEvent_Left.NAME, 'Exec', setter)),
  'vehicle exit invalidates late replies');
  const liveNonceInput = t.incoming(request, C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');
  assert.equal(liveNonceInput.length, 1);
  assert.equal(liveNonceInput[0].a, requestNonceState.key,
    'request sends the retained nonce snapshot, never a live n+1 expression');

  const firstStage = t.target(t.one(t.outgoing(reply,
    C.Event_CustomGlobal.NAME, 'ExecOut'), 'immediate reply staging start'));
  assert(component(firstStage, C.Exec_Var_Set.NAME));
  const stageSetters = [firstStage];
  while (stageSetters.length < 5) {
    const next = t.outgoing(stageSetters.at(-1), C.Exec_Var_Set.NAME, 'ExecOut')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME);
    assert.equal(next.length, 1, 'reply Data1..5 are snapshotted immediately in order');
    stageSetters.push(t.target(next[0]));
  }
  const staged = stageSetters.map((setter, index) => {
    const value = sourceOf(t, setter, C.Exec_Var_Set.NAME,
      'Value', `staged reply DataOut${index + 1}`);
    assert.equal(value.brick.key, reply.key);
    assert.equal(value.edge.p, `DataOut${index + 1}`);
    return sourceOf(t, setter, C.Exec_Var_Set.NAME,
      'VarRef', `staged reply state ${index + 1}`).brick;
  });
  for (let index = 0; index < 5; index++) assert.deepEqual(
    t.outgoing(reply, C.Event_CustomGlobal.NAME, `DataOut${index + 1}`)
      .map(edge => [edge.z, edge.zt, edge.q]),
    [[stageSetters[index].key, C.Exec_Var_Set.NAME, 'Value']],
    `reply DataOut${index + 1} has no delayed live consumer`);
  const stagedDelay = t.target(t.one(t.outgoing(stageSetters[4],
    C.Exec_Var_Set.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.BufferTicks.NAME)), 'staged reply settle'));
  assert.equal(valueOf(component(stagedDelay, C.BufferTicks.NAME).data.TicksToWait), 1,
    'reply payload settles before any delayed validation');
  const current = t.target(t.one(t.outgoing(stagedDelay,
    C.BufferTicks.NAME, 'Output').filter(edge =>
    component(t.target(edge), C.Exec_ArrayVar_Get.NAME)),
  'reply current-vehicle read'));
  const currentArray = sourceOf(t, current, C.Exec_ArrayVar_Get.NAME,
    'ArrayVarRef', 'reply vehicle array');
  assert.equal(currentArray.brick.key, vehicleArray.key);
  const replyBarrierEdge = t.one(t.outgoing(current,
    C.Exec_ArrayVar_Get.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.BufferTicks.NAME)), 'reply ArrayGet settle barrier');
  const replyBarrier = t.target(replyBarrierEdge);
  assert.equal(valueOf(component(replyBarrier, C.BufferTicks.NAME).data.TicksToWait), 1,
    'reply validation waits for current vehicle Value');
  const guardEdge = t.one(t.outgoing(replyBarrier,
    C.BufferTicks.NAME, 'Output').filter(edge =>
    component(t.target(edge), C.Exec_Branch.NAME)), 'settled reply guard');
  const guard = t.target(guardEdge);
  const condition = sourceOf(t, guard, C.Exec_Branch.NAME,
    'bCond', 'reply validation condition').brick;
  assert(dataReachableFromPort(t, current, C.Exec_ArrayVar_Get.NAME,
    'Value', condition), 'reply validates retained current vehicle');
  assert(dataReachableFromPort(t, current, C.Exec_ArrayVar_Get.NAME,
    'bOutOfBounds', condition), 'reply rejects an absent vehicle');
  assert(dataReachableFromPort(t, staged[0], C.Var.NAME,
    'Value', condition), 'reply validates staged echoed vehicle identity');
  assert(dataReachableFromPort(t, staged[1], C.Var.NAME,
    'Value', condition), 'reply validates staged echoed nonce');
  assert(dataReachableFromPort(t, nonce, C.Var.NAME,
    'Value', condition), 'reply compares against committed nonce');
  assert(dataReachableFromPort(t, ready, C.Var.NAME,
    'Value', condition), 'reply is accepted only while appearance is pending');

  const replyBusyOn = t.target(t.one(t.outgoing(guard,
    C.Exec_Branch.NAME, 'ExecOutA'), 'accepted reply busy lock'));
  assert.equal(valueOf(component(replyBusyOn, C.Exec_Var_Set.NAME).data.Value), true,
    'accepted reply locks appearance synchronization before writing state');
  const busy = sourceOf(t, replyBusyOn, C.Exec_Var_Set.NAME,
    'VarRef', 'appearance sync busy state').brick;
  assert(component(busy, C.Var.NAME));
  assert(dataReachableFromPort(t, busy, C.Var.NAME,
    'Value', condition), 'reply guard requires synchronization to be idle');
  const firstSetter = t.target(t.one(t.outgoing(replyBusyOn,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'accepted reply color snapshot'));
  const setters = [firstSetter];
  while (setters.length < 3) {
    const next = t.outgoing(setters.at(-1), C.Exec_Var_Set.NAME, 'ExecOut')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME);
    assert.equal(next.length, 1, 'reply snapshots color/material/intensity in one chain');
    setters.push(t.target(next[0]));
  }
  for (let i = 0; i < 3; i++) {
    const value = sourceOf(t, setters[i], C.Exec_Var_Set.NAME,
      'Value', `reply snapshot staged DataOut${i + 3}`);
    assert.equal(value.brick.key, staged[i + 2].key);
    assert.equal(value.edge.p, 'Value');
  }
  const states = setters.map((setter, index) => sourceOf(t, setter,
    C.Exec_Var_Set.NAME, 'VarRef', `reply retained state ${index}`).brick);
  const settle = t.one(t.all(C.BufferTicks.NAME, (_data, brick) =>
    brick.g === terminalGrid && execReachableFromPort(t, setters[2],
      C.Exec_Var_Set.NAME, 'ExecOut', brick)
      && t.outgoing(brick, C.BufferTicks.NAME, 'Output').some(edge =>
        edge.zt === C.Exec_Var_Set.NAME && t.target(edge).g !== terminalGrid)),
  'reply/fallback snapshot settle').brick;
  assert.equal(valueOf(component(settle, C.BufferTicks.NAME).data.TicksToWait), 1,
    'reply snapshots settle before core synchronization');

  return { entered, insert, vehicleArray, request, reply, guard, ready, busy,
    states, settle, staged, stageSetters };
}

function assertLeaderboardFallback(v15, handshake, sessionReady) {
  const t = api(v15);
  const terminalGrid = handshake.entered.g;
  const currentColor = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === ''
      && t.outgoing(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
        .some(edge => component(t.target(edge), C.Expr_MathMax.NAME))),
  'CURRENT COLOR leaderboard getter').brick;
  const material = t.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Truck1Material',
    'fallback Truck1Material getter').brick;
  const materialBarrier = t.target(t.one(t.outgoing(material,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(t.target(edge), C.BufferTicks.NAME)), 'fallback material settle'));
  const fallbackGuard = t.target(t.one(t.outgoing(materialBarrier,
    C.BufferTicks.NAME, 'Output').filter(edge =>
    component(t.target(edge), C.Exec_Branch.NAME)), 'fallback initialization guard'));
  const fallbackCondition = sourceOf(t, fallbackGuard, C.Exec_Branch.NAME,
    'bCond', 'fallback condition').brick;
  assert(dataReachableFromPort(t, sessionReady, C.Var.NAME,
    'Value', fallbackCondition), 'leaderboard fallback requires a seated session');
  assert(dataReachableFromPort(t, handshake.ready, C.Var.NAME,
    'Value', fallbackCondition),
  'leaderboard fallback requires appearance to still be pending');
  assert(dataReachableFromPort(t, handshake.busy, C.Var.NAME,
    'Value', fallbackCondition),
  'leaderboard fallback requires synchronization to be idle');
  const readyNot = t.all(C.Expr_LogicalNOT.NAME).filter(({ brick }) =>
    t.incoming(brick, C.Expr_LogicalNOT.NAME, 'bInput')
      .some(edge => edge.a === handshake.ready.key && edge.p === 'Value'));
  assert(readyNot.some(({ brick }) => dataReachableFromPort(t, brick,
    C.Expr_LogicalNOT.NAME, 'bOutput', fallbackCondition)),
  'ready=true from a successful handshake makes the fallback condition false');
  assert(execReachableFromPort(t, currentColor,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', fallbackGuard),
  'seated current-color read can reach the guarded fallback');
  const fallbackBusyOn = t.target(t.one(t.outgoing(fallbackGuard,
    C.Exec_Branch.NAME, 'ExecOutA'), 'fallback busy lock'));
  assert.equal(valueOf(component(fallbackBusyOn, C.Exec_Var_Set.NAME).data.Value), true,
    'accepted fallback locks synchronization before writing state');
  const fallbackBusyState = sourceOf(t, fallbackBusyOn, C.Exec_Var_Set.NAME,
    'VarRef', 'fallback busy state').brick;
  assert.equal(fallbackBusyState.key, handshake.busy.key,
    'reply and fallback share one exclusion lock');
  return { currentColor, material, fallbackGuard, fallbackBusyOn };
}

function srgbChannel(byte) {
  const encoded = byte / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function normalizedLinearHsv(score) {
  const R = srgbChannel((score >> 16) & 255);
  const G = srgbChannel((score >> 8) & 255);
  const B = srgbChannel(score & 255);
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const delta = max - min;
  let degrees = 0;
  if (delta !== 0) {
    if (max === R) degrees = 60 * (((G - B) / delta) % 6);
    else if (max === G) degrees = 60 * (((B - R) / delta) + 2);
    else degrees = 60 * (((R - G) / delta) + 4);
  }
  if (degrees < 0) degrees += 360;
  return { R: degrees / 360, G: max === 0 ? 0 : delta / max, B: max, A: 1 };
}

function hsvSyncPaths(scene) {
  const t = api(scene);
  const coreGrid = t.row(C.InputSplitter.NAME, () => true, 'color core InputSplitter').brick.g;
  const converters = t.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === coreGrid && data.ToSpace === 3);
  assert.equal(converters.length, 2,
    'core has exactly two RGB-to-HSV paths: vehicle sync and hex input');
  return converters.map(({ brick: converter }) => {
    const split = t.target(t.one(t.outgoing(converter,
      C.Expr_ColorConvert.NAME, 'Output').filter(edge =>
      edge.zt === C.Expr_SplitColor.NAME && edge.q === 'Input'),
    'HSV converter split'));
    const multipliers = {};
    for (const [port, scale] of [['R', 360], ['G', 100], ['B', 100]]) {
      const edge = t.one(t.outgoing(split, C.Expr_SplitColor.NAME, port)
        .filter(candidate => candidate.zt === C.Expr_MathMultiply.NAME
          && candidate.q === 'InputA'
          && valueOf(component(t.target(candidate), C.Expr_MathMultiply.NAME)
            .data.InputB) === scale), `HSV ${port} x${scale}`);
      const multiply = t.target(edge);
      const setter = t.one(t.outgoing(multiply,
        C.Expr_MathMultiply.NAME, 'Output').filter(candidate =>
        candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Value'),
      `HSV ${port} scaled setter`);
      multipliers[port] = { multiply, setter: t.target(setter) };
    }
    return { converter, split, multipliers };
  });
}

function assertHueUnitCorrection(v14, v15) {
  const old = api(v14);
  const oldCore = old.row(C.InputSplitter.NAME, () => true,
    'v14 color core InputSplitter').brick.g;
  const oldConverters = old.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === oldCore && data.ToSpace === 3);
  assert.equal(oldConverters.length, 2, 'v14 negative fixture has both HSV conversion paths');
  for (const { brick: converter } of oldConverters) {
    const split = old.target(old.one(old.outgoing(converter,
      C.Expr_ColorConvert.NAME, 'Output').filter(edge =>
      edge.zt === C.Expr_SplitColor.NAME), 'v14 HSV split'));
    assert(old.outgoing(split, C.Expr_SplitColor.NAME, 'R').some(edge =>
      edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
    'v14 reproduces normalized Hue wired directly into degree Var');
    assert(!old.outgoing(split, C.Expr_SplitColor.NAME, 'R').some(edge =>
      edge.zt === C.Expr_MathMultiply.NAME
        && valueOf(component(old.target(edge), C.Expr_MathMultiply.NAME).data.InputB) === 360),
    'v14 negative fixture lacks Hue x360');
  }

  const paths = hsvSyncPaths(v15);
  const samples = new Map([
    ['FFA100', [0xffa100, [21.38400864875661, 100, 100]]],
    ['GREEN', [0x00ff00, [120, 100, 100]]],
    ['BLUE', [0x0000ff, [240, 100, 100]]],
  ]);
  const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`);
  for (const [pathIndex, path] of paths.entries()) for (const [label, [score, expected]] of samples) {
    const hsv = normalizedLinearHsv(score);
    const actual = [hsv.R * valueOf(component(path.multipliers.R.multiply,
      C.Expr_MathMultiply.NAME).data.InputB), hsv.G * valueOf(component(
      path.multipliers.G.multiply, C.Expr_MathMultiply.NAME).data.InputB),
    hsv.B * valueOf(component(path.multipliers.B.multiply,
      C.Expr_MathMultiply.NAME).data.InputB)];
    actual.forEach((value, index) => close(value, expected[index],
      `path ${pathIndex + 1} ${label} HSV[${index}]`));
  }
  return paths;
}

function assertCoreCompletion(v15, handshake) {
  const t = api(v15);
  const coreGrid = t.row(C.InputSplitter.NAME, () => true, 'color core InputSplitter').brick.g;
  const start = t.target(t.one(t.outgoing(handshake.settle,
    C.BufferTicks.NAME, 'Output').filter(edge =>
    edge.zt === C.Exec_Var_Set.NAME && t.target(edge).g === coreGrid),
  'handshake direct core start'));
  const setters = [start];
  while (true) {
    const next = t.outgoing(setters.at(-1), C.Exec_Var_Set.NAME, 'ExecOut')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME && t.target(edge).g === coreGrid);
    assert(next.length <= 1, 'core appearance sync is one ordered setter chain');
    if (!next.length) break;
    setters.push(t.target(next[0]));
  }
  assert.equal(setters.length, 5,
    'core sync writes Hue, Saturation, Brightness, Material, and Intensity');
  const readyTrue = t.outgoing(handshake.ready, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge)).filter(setter =>
      valueOf(component(setter, C.Exec_Var_Set.NAME).data.Value) === true);
  assert.equal(readyTrue.length, 1);
  const readyExec = sourceOf(t, readyTrue[0], C.Exec_Var_Set.NAME,
    'Exec', 'appearance-ready completion');
  assert.equal(readyExec.brick.key, setters.at(-1).key,
    'ready becomes true only after the fifth core setter');
  const busyOff = t.target(t.one(t.outgoing(readyTrue[0],
    C.Exec_Var_Set.NAME, 'ExecOut'), 'post-ready busy release'));
  assert.equal(valueOf(component(busyOff, C.Exec_Var_Set.NAME).data.Value), false,
    'synchronization lock clears only after appearanceReady=true');
  const busyState = sourceOf(t, busyOff, C.Exec_Var_Set.NAME,
    'VarRef', 'busy release state').brick;
  assert.equal(busyState.key, handshake.busy.key);
  return setters;
}

function test({
  previousTerminal = DEFAULT_V14_TERMINAL,
  previousTruck = DEFAULT_V8_TRUCK,
  terminalOutput = DEFAULT_V15_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V15_BUILDER,
} = {}) {
  testV14();
  const oldTerminalBytes = fs.readFileSync(previousTerminal);
  const oldTruckBytes = fs.readFileSync(previousTruck);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const oldTerminal = read(oldTerminalBytes);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);

  assert(validate(terminalBytes).strictOk, 'v15 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged v8 truck passes strict placement');
  assert.deepEqual(truckBytes, oldTruckBytes,
    'v15 keeps the exact proven v8 truck bytes');
  assertSurfacePreserved(oldTerminal, terminal);
  const buy = assertBuySafety(terminal);
  const handshake = assertSettledHandshake(terminal, truck);
  const fallback = assertLeaderboardFallback(terminal, handshake, buy.sessionReady);
  const hsvPaths = assertHueUnitCorrection(oldTerminal, terminal);
  const coreSetters = assertCoreCompletion(terminal, handshake);
  assert.equal(api(terminal).all(C.Exec_Entity_GetCustomProperty.NAME,
    data => ['CurrentColorScore', 'CurrentMaterialEnum'].includes(data.Key)).length, 0,
  'v15 does not revive timing-sensitive root custom-property authority');

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build(); const second = build();
  const firstTerminal = first.terminal?.bytes || first.terminalBytes || first.bytes;
  const secondTerminal = second.terminal?.bytes || second.terminalBytes || second.bytes;
  const firstTruck = first.truck?.bytes || first.truckBytes || truckBytes;
  const secondTruck = second.truck?.bytes || second.truckBytes || truckBytes;
  assert(firstTerminal && secondTerminal,
    'v15 builder returns terminal bytes');
  assert.deepEqual(firstTerminal, secondTerminal, 'v15 terminal build is deterministic');
  assert.deepEqual(firstTruck, secondTruck, 'v8 truck rebuild is deterministic');
  assert.deepEqual(Buffer.from(firstTerminal), Buffer.from(terminalBytes),
    'checked v15 terminal output matches fresh build');
  assert.deepEqual(Buffer.from(firstTruck), Buffer.from(truckBytes),
    'checked v8 truck output matches fresh build');

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
    entryAuthority: 'settled SR.Appearance request/reply',
    seatedFallback: component(fallback.material,
      C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key,
    hueUnits: 'normalized HSV x 360 degrees on sync and hex paths',
    buySafety: 'seeded rising edge plus final occupied-seat guard',
    coreSetters: coreSetters.length,
    hsvPaths: hsvPaths.length,
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  previousTerminal: process.argv[2] || DEFAULT_V14_TERMINAL,
  previousTruck: process.argv[3] || DEFAULT_V8_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V15_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V15_BUILDER,
});

module.exports = test;
