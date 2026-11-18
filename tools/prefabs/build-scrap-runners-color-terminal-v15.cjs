'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, B } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v14.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v15.brz'));

const clone = structuredClone;
const I = value => ({ $variant: 'i64', value });
const O = value => ({ $variant: 'weak_object', value });
const X = () => ({ $variant: 'WireGraphExec', value: {} });

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
  return { component, rows, all, one, row, brick, incoming, outgoing,
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

function eventData(name, values) {
  return {
    EventName: name,
    bIsObjectEvent: false,
    ...Object.fromEntries(Array.from({ length: 8 }, (_, index) =>
      [`DataOut${index + 1}`, clone(values[index] || N(0))])),
  };
}

function sendData(name, values) {
  return {
    EventName: name,
    ...Object.fromEntries(Array.from({ length: 8 }, (_, index) =>
      [`DataIn${index + 1}`, clone(values[index] || N(0))])),
  };
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  const g = graph(scene, 'v15');

  const entered = g.row(C.EntityZoneEvent_Entered.NAME, () => true, 'zone entered').brick;
  const left = g.row(C.EntityZoneEvent_Left.NAME, () => true, 'zone left').brick;
  const terminalGrid = entered.g;
  const insert = g.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle insert').brick;
  const vehicleArray = g.brick(g.one(g.incoming(insert, C.Exec_ArrayVar_Insert.NAME,
    'ArrayVarRef'), 'vehicle array').a);
  const ready = g.label('Appearance ready (blocks preview until synchronized)');
  const readyExitOff = g.label('Reset appearance ready on exit');
  const readyOn = g.label('Set ready after every sync setter completes');
  const sessionEdge = g.label('Session start/exit detector');
  const scoreState = g.label('Live packed color snapshot');
  const materialState = g.label('Live material snapshot');
  const intensityState = g.label('Live intensity snapshot');
  const fallbackSetters = [g.label('Snapshot color'), g.label('Snapshot material'),
    g.label('Snapshot intensity')];
  const initializeGuard = g.label('Accept authoritative saved appearance');
  const shouldInitialize = g.label('Initialize only the current pending appearance');
  const sessionVehicle = g.label('Seated session has a supported vehicle');
  const vehicleSupported = g.brick(g.one(g.incoming(sessionVehicle,
    C.Expr_LogicalAND.NAME, 'bInputB'), 'supported vehicle state').a);
  assert(g.component(vehicleSupported, C.Var.NAME));
  const settle = g.brick(g.one(g.outgoing(fallbackSetters[2], C.Exec_Var_Set.NAME,
    'ExecOut'), 'snapshot settle').z);
  assert(g.component(settle, C.BufferTicks.NAME));

  // Truck1 v8 already responds with its live rendered color, Plastic/Metal
  // enum, and raw material intensity. Request that snapshot after the zone
  // array and its index-0 read have each had a full tick to settle. A seated
  // session retries only while the appearance has not already synchronized.
  const nonce = g.gate('Var', terminalGrid, { Value: I(0) }, 'appearance_nonce',
    [70, 185, 225], 'Appearance request nonce');
  const nonceNext = g.gate('Expr_MathAdd', terminalGrid,
    { InputA: I(0), InputB: I(1) }, 'nonce_next', [70, 185, 225], 'Next request nonce');
  const requestTriggers = g.gate('Exec_Union', terminalGrid, {}, 'request_triggers',
    [70, 185, 225], 'Vehicle entry or pending seated retry');
  const retryNotReady = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: false },
    'retry_not_ready', [70, 185, 225], 'Retry only before appearance is ready');
  const retryGuard = g.gate('Exec_Branch', terminalGrid, {}, 'retry_guard',
    [70, 185, 225], 'Seated retry guard');
  const commitNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(1) }, 'commit_nonce', [70, 185, 225],
    'Commit request nonce before reading vehicle');
  const requestDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'request_delay', [70, 185, 225],
    'Wait for inserted vehicle and nonce');
  const requestVehicle = g.gate('Exec_ArrayVar_Get', terminalGrid,
    { Index: 0, Value: O(null), bOutOfBounds: true }, 'request_vehicle',
    [70, 185, 225], 'Read retained zone vehicle');
  const vehicleDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'request_vehicle_delay',
    [70, 185, 225], 'Wait for retained vehicle value');
  const requestVehicleState = g.gate('Var', terminalGrid, { Value: O(null) },
    'request_vehicle_state', [70, 185, 225], 'Retained requested vehicle');
  const requestNonceState = g.gate('Var', terminalGrid, { Value: I(0) },
    'request_nonce_state', [70, 185, 225], 'Retained requested nonce');
  const snapshotRequestVehicle = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: O(null) }, 'snapshot_request_vehicle',
    [70, 185, 225], 'Snapshot requested vehicle after array read');
  const snapshotRequestNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(0) }, 'snapshot_request_nonce',
    [70, 185, 225], 'Snapshot committed request nonce');
  const requestSnapshotDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'request_snapshot_delay',
    [70, 185, 225], 'Wait for retained request snapshot');
  const requestHasVehicle = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: true },
    'request_has_vehicle', [70, 185, 225], 'Request vehicle exists');
  const requestGuard = g.gate('Exec_Branch', terminalGrid, {}, 'request_guard',
    [70, 185, 225], 'Send request only to a retained vehicle');
  const request = g.gate('Exec_SendCustomEventGlobal', terminalGrid,
    sendData('SR.Appearance.Request', [O(null), I(0)]), 'appearance_request',
    [70, 185, 225], null);
  const exitNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(1) }, 'exit_nonce', [70, 185, 225],
    'Invalidate late replies when vehicle leaves');

  g.add(nonce, C.Var.NAME, 'Value', nonceNext, C.Expr_MathAdd.NAME, 'InputA');
  for (const setter of [commitNonce, exitNonce]) {
    g.add(nonce, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    g.add(nonceNext, C.Expr_MathAdd.NAME, 'Output', setter, C.Exec_Var_Set.NAME, 'Value');
  }
  g.add(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut', requestTriggers,
    C.Exec_Union.NAME, 'ExecA');
  g.add(ready, C.Var.NAME, 'Value', retryNotReady, C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(sessionEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', retryGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(retryNotReady, C.Expr_LogicalNOT.NAME, 'bOutput', retryGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(retryGuard, C.Exec_Branch.NAME, 'ExecOutA', requestTriggers,
    C.Exec_Union.NAME, 'ExecB');
  g.add(requestTriggers, C.Exec_Union.NAME, 'ExecOut', commitNonce,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(commitNonce, C.Exec_Var_Set.NAME, 'ExecOut', requestDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(requestDelay, C.BufferTicks.NAME, 'Output', requestVehicle,
    C.Exec_ArrayVar_Get.NAME, 'Exec');
  g.add(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', requestVehicle,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  g.add(requestVehicle, C.Exec_ArrayVar_Get.NAME, 'ExecOut', vehicleDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(requestVehicle, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', requestHasVehicle,
    C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(requestVehicleState, C.Var.NAME, 'VarRef', snapshotRequestVehicle,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(requestVehicle, C.Exec_ArrayVar_Get.NAME, 'Value', snapshotRequestVehicle,
    C.Exec_Var_Set.NAME, 'Value');
  g.add(vehicleDelay, C.BufferTicks.NAME, 'Output', snapshotRequestVehicle,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(requestNonceState, C.Var.NAME, 'VarRef', snapshotRequestNonce,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(nonce, C.Var.NAME, 'Value', snapshotRequestNonce,
    C.Exec_Var_Set.NAME, 'Value');
  g.add(snapshotRequestVehicle, C.Exec_Var_Set.NAME, 'ExecOut', snapshotRequestNonce,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(snapshotRequestNonce, C.Exec_Var_Set.NAME, 'ExecOut', requestSnapshotDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(requestSnapshotDelay, C.BufferTicks.NAME, 'Output', requestGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(requestHasVehicle, C.Expr_LogicalNOT.NAME, 'bOutput', requestGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(requestGuard, C.Exec_Branch.NAME, 'ExecOutA', request,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  for (const port of ['Target', 'DataIn1']) g.add(requestVehicleState,
    C.Var.NAME, 'Value', request, C.Exec_SendCustomEventGlobal.NAME, port);
  g.add(requestNonceState, C.Var.NAME, 'Value', request,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');
  g.add(readyExitOff, C.Exec_Var_Set.NAME, 'ExecOut', exitNonce,
    C.Exec_Var_Set.NAME, 'Exec');

  // Buffer the index-0 read made for every reply, then validate the echoed
  // vehicle, the committed nonce, and the not-yet-ready state. This prevents a
  // late reply from an old/removed vehicle from overwriting the picker.
  const reply = g.gate('Event_CustomGlobal', terminalGrid,
    eventData('SR.Appearance.Reply', [O(null), I(0), I(0), N(0), N(128)]),
    'appearance_reply', [70, 185, 225], null);
  const stagedReply = [
    g.gate('Var', terminalGrid, { Value: O(null) }, 'staged_reply_vehicle',
      [70, 185, 225], 'Staged reply vehicle'),
    g.gate('Var', terminalGrid, { Value: I(0) }, 'staged_reply_nonce',
      [70, 185, 225], 'Staged reply nonce'),
    g.gate('Var', terminalGrid, { Value: I(0) }, 'staged_reply_score',
      [145, 95, 215], 'Staged reply color'),
    g.gate('Var', terminalGrid, { Value: N(0) }, 'staged_reply_material',
      [165, 105, 220], 'Staged reply material'),
    g.gate('Var', terminalGrid, { Value: N(128) }, 'staged_reply_intensity',
      [220, 165, 65], 'Staged reply intensity'),
  ];
  const stageReplySetters = stagedReply.map((state, index) => g.gate('Exec_Var_Set',
    terminalGrid, { bChangeType: false,
      Value: [O(null), I(0), I(0), N(0), N(128)][index] },
    `stage_reply_${index}`, [70, 185, 225], `Snapshot reply data ${index + 1}`));
  const stagedReplyDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'staged_reply_delay',
    [70, 185, 225], 'Wait for staged reply data');
  const currentVehicle = g.gate('Exec_ArrayVar_Get', terminalGrid,
    { Index: 0, Value: O(null), bOutOfBounds: true }, 'reply_vehicle',
    [70, 185, 225], 'Read current vehicle for reply');
  const replyDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'reply_vehicle_delay',
    [70, 185, 225], 'Wait for current reply vehicle');
  const currentExists = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: true },
    'reply_current_exists', [70, 185, 225], 'Current reply vehicle exists');
  const sameVehicle = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'reply_same_vehicle',
    [70, 185, 225], 'Reply matches current vehicle');
  const sameNonce = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: I(0), InputB: I(0) }, 'reply_same_nonce',
    [70, 185, 225], 'Reply matches committed nonce');
  const validEntity = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid_entity',
    [70, 185, 225], 'Reply has the current vehicle');
  const validNonce = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid_nonce',
    [70, 185, 225], 'Reply is current and initialization is pending');
  const syncBusy = g.gate('Var', terminalGrid, { Value: B(false) }, 'sync_busy',
    [70, 185, 225], 'Appearance synchronization busy');
  const notBusy = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: false },
    'sync_not_busy', [70, 185, 225], 'No appearance synchronization is running');
  const validState = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid_state',
    [70, 185, 225], 'Supported vehicle and synchronization is idle');
  const validIdentity = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid_identity',
    [70, 185, 225], 'Reply vehicle and nonce are current');
  const validReply = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid',
    [70, 185, 225], 'Accept only the current live appearance');
  const replyGuard = g.gate('Exec_Branch', terminalGrid, {}, 'reply_guard',
    [70, 185, 225], 'Accepted live vehicle appearance');
  const replySetters = [
    g.gate('Exec_Var_Set', terminalGrid, { bChangeType: false, Value: I(0) },
      'reply_score', [145, 95, 215], 'Set preview color from live truck'),
    g.gate('Exec_Var_Set', terminalGrid, { bChangeType: false, Value: N(0) },
      'reply_material', [165, 105, 220], 'Set preview material from live truck'),
    g.gate('Exec_Var_Set', terminalGrid, { bChangeType: false, Value: N(128) },
      'reply_intensity', [220, 165, 65], 'Set preview intensity from live truck'),
  ];
  const replyBusyOn = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(true) }, 'reply_busy_on', [70, 185, 225],
    'Lock live reply synchronization');
  const fallbackBusyOn = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(true) }, 'fallback_busy_on', [70, 185, 225],
    'Lock leaderboard fallback synchronization');
  const busyOff = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'sync_busy_off', [70, 185, 225],
    'Release appearance synchronization lock');
  const fallbackAllowed = g.gate('Expr_LogicalAND', terminalGrid, {},
    'fallback_allowed', [70, 185, 225], 'Fallback is pending and synchronization is idle');
  const settleUnion = g.gate('Exec_Union', terminalGrid, {}, 'appearance_settle_union',
    [70, 185, 225], 'Leaderboard fallback or live truck snapshot');

  stagedReply.forEach((state, index) => {
    g.add(state, C.Var.NAME, 'VarRef', stageReplySetters[index],
      C.Exec_Var_Set.NAME, 'VarRef');
    g.add(reply, C.Event_CustomGlobal.NAME, `DataOut${index + 1}`,
      stageReplySetters[index], C.Exec_Var_Set.NAME, 'Value');
    if (index) g.add(stageReplySetters[index - 1], C.Exec_Var_Set.NAME, 'ExecOut',
      stageReplySetters[index], C.Exec_Var_Set.NAME, 'Exec');
  });
  g.add(reply, C.Event_CustomGlobal.NAME, 'ExecOut', stageReplySetters[0],
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(stageReplySetters[4], C.Exec_Var_Set.NAME, 'ExecOut', stagedReplyDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', currentVehicle,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  g.add(stagedReplyDelay, C.BufferTicks.NAME, 'Output', currentVehicle,
    C.Exec_ArrayVar_Get.NAME, 'Exec');
  g.add(currentVehicle, C.Exec_ArrayVar_Get.NAME, 'ExecOut', replyDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(currentVehicle, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', currentExists,
    C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(currentVehicle, C.Exec_ArrayVar_Get.NAME, 'Value', sameVehicle,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(stagedReply[0], C.Var.NAME, 'Value', sameVehicle,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(nonce, C.Var.NAME, 'Value', sameNonce, C.Expr_CompareEqual.NAME, 'InputA');
  g.add(stagedReply[1], C.Var.NAME, 'Value', sameNonce,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(currentExists, C.Expr_LogicalNOT.NAME, 'bOutput', validEntity,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(sameVehicle, C.Expr_CompareEqual.NAME, 'bOutput', validEntity,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(sameNonce, C.Expr_CompareEqual.NAME, 'bOutput', validNonce,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(retryNotReady, C.Expr_LogicalNOT.NAME, 'bOutput', validNonce,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(syncBusy, C.Var.NAME, 'Value', notBusy, C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(vehicleSupported, C.Var.NAME, 'Value', validState,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(notBusy, C.Expr_LogicalNOT.NAME, 'bOutput', validState,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(validEntity, C.Expr_LogicalAND.NAME, 'bOutput', validIdentity,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(validNonce, C.Expr_LogicalAND.NAME, 'bOutput', validIdentity,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(validIdentity, C.Expr_LogicalAND.NAME, 'bOutput', validReply,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(validState, C.Expr_LogicalAND.NAME, 'bOutput', validReply,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(replyDelay, C.BufferTicks.NAME, 'Output', replyGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(validReply, C.Expr_LogicalAND.NAME, 'bOutput', replyGuard,
    C.Exec_Branch.NAME, 'bCond');
  [scoreState, materialState, intensityState].forEach((state, index) => {
    g.add(state, C.Var.NAME, 'VarRef', replySetters[index], C.Exec_Var_Set.NAME, 'VarRef');
    g.add(stagedReply[index + 2], C.Var.NAME, 'Value',
      replySetters[index], C.Exec_Var_Set.NAME, 'Value');
    if (index) g.add(replySetters[index - 1], C.Exec_Var_Set.NAME, 'ExecOut',
      replySetters[index], C.Exec_Var_Set.NAME, 'Exec');
  });
  for (const setter of [replyBusyOn, fallbackBusyOn, busyOff])
    g.add(syncBusy, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(replyGuard, C.Exec_Branch.NAME, 'ExecOutA', replyBusyOn,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(replyBusyOn, C.Exec_Var_Set.NAME, 'ExecOut', replySetters[0],
    C.Exec_Var_Set.NAME, 'Exec');
  const fallbackCondition = g.one(g.removeInput(initializeGuard,
    C.Exec_Branch.NAME, 'bCond'), 'fallback pending condition');
  assert.equal(fallbackCondition.a, shouldInitialize.key);
  g.add(shouldInitialize, C.Expr_LogicalAND.NAME, 'bOutput', fallbackAllowed,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(notBusy, C.Expr_LogicalNOT.NAME, 'bOutput', fallbackAllowed,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(fallbackAllowed, C.Expr_LogicalAND.NAME, 'bOutput', initializeGuard,
    C.Exec_Branch.NAME, 'bCond');
  const fallbackStart = g.one(g.removeInput(fallbackSetters[0],
    C.Exec_Var_Set.NAME, 'Exec'), 'fallback snapshot start');
  assert.equal(fallbackStart.a, initializeGuard.key);
  g.add(initializeGuard, C.Exec_Branch.NAME, 'ExecOutA', fallbackBusyOn,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(fallbackBusyOn, C.Exec_Var_Set.NAME, 'ExecOut', fallbackSetters[0],
    C.Exec_Var_Set.NAME, 'Exec');
  const fallbackSettle = g.one(g.removeInput(settle, C.BufferTicks.NAME, 'Input'),
    'fallback snapshot settle');
  assert.equal(fallbackSettle.a, fallbackSetters[2].key);
  g.add(fallbackSetters[2], C.Exec_Var_Set.NAME, 'ExecOut', settleUnion,
    C.Exec_Union.NAME, 'ExecA');
  g.add(replySetters[2], C.Exec_Var_Set.NAME, 'ExecOut', settleUnion,
    C.Exec_Union.NAME, 'ExecB');
  g.add(settleUnion, C.Exec_Union.NAME, 'ExecOut', settle,
    C.BufferTicks.NAME, 'Input');
  g.add(readyOn, C.Exec_Var_Set.NAME, 'ExecOut', busyOff,
    C.Exec_Var_Set.NAME, 'Exec');

  // Brickadia's RGB->HSV conversion stores normalized hue in SplitColor.R,
  // while the terminal's Hue Var and controls use degrees. v14 wrote 0..1
  // directly into 0..360, turning orange into approximately 0-degree red.
  // Correct both normalized-HSV paths: vehicle/leaderboard initialization and
  // accepted hex input. Saturation and brightness already multiply by 100.
  const coreGrid = g.brick(g.one(g.outgoing(settle, C.BufferTicks.NAME,
    'Output'), 'core sync start').z).g;
  const hsvConversions = g.all(C.Expr_ColorConvert.NAME,
    (data, brick) => brick.g === coreGrid && data.ToSpace === 3);
  assert.equal(hsvConversions.length, 2, 'two normalized RGB-to-HSV conversions');
  const hueScales = [];
  for (const [index, conversion] of hsvConversions.entries()) {
    const splitEdge = g.one(g.outgoing(conversion.brick, C.Expr_ColorConvert.NAME,
      'Output').filter(edge => edge.zt === C.Expr_SplitColor.NAME),
    `HSV conversion ${index} split`);
    const split = g.brick(splitEdge.z);
    const hueEdge = g.one(g.outgoing(split, C.Expr_SplitColor.NAME, 'R')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
    `HSV conversion ${index} Hue setter`);
    const hueSetter = g.brick(hueEdge.z);
    g.removeInput(hueSetter, C.Exec_Var_Set.NAME, 'Value');
    const scale = g.gate('Expr_MathMultiply', coreGrid,
      { InputA: N(0), InputB: N(360) }, `hue_degrees_${index}`,
      [235, 100, 65], `Convert normalized hue ${index + 1} to degrees`);
    g.add(split, C.Expr_SplitColor.NAME, 'R', scale, C.Expr_MathMultiply.NAME, 'InputA');
    g.add(scale, C.Expr_MathMultiply.NAME, 'Output', hueSetter,
      C.Exec_Var_Set.NAME, 'Value');
    hueScales.push(scale);
  }

  rowAt([nonce, nonceNext, requestTriggers, retryNotReady, retryGuard,
    commitNonce, requestDelay, requestVehicle, vehicleDelay, requestVehicleState,
    requestNonceState, snapshotRequestVehicle, snapshotRequestNonce,
    requestSnapshotDelay, requestHasVehicle, requestGuard, request], 320, -25);
  rowAt([reply, ...stagedReply, ...stageReplySetters, stagedReplyDelay,
    currentVehicle, replyDelay, currentExists, sameVehicle, sameNonce], 320, -45);
  rowAt([validEntity, validNonce, syncBusy, notBusy, validState, validIdentity,
    validReply, replyGuard, replyBusyOn, fallbackBusyOn, busyOff,
    fallbackAllowed], 320, -65);
  rowAt([replySetters[0], replySetters[1], replySetters[2], settleUnion,
    exitNonce], 320, -85);
  rowAt(hueScales, 600, -65);
  fit(scene, terminalGrid);
  fit(scene, coreGrid);

  const metadata = {
    name: 'Scrap Runners - Color Terminal v15 Live Vehicle Snapshot',
    description: 'Initializes from Truck1 live appearance on zone entry, retries while pending, converts normalized hue to degrees, and preserves v14 seat-safe purchases.',
    owner: owner(scene),
  };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, grids: { terminalGrid, coreGrid } };
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
  console.log(JSON.stringify({ output: OUTPUT, bricks: result.scene.bricks.length,
    wires: result.scene.edges.length, protocol: 'SR.Appearance.Request/Reply',
    hueScale: 'normalized * 360 for entry and hex input' }, null, 2));
}
