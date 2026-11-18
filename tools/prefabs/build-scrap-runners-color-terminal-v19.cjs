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
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v18.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v19.brz'));

const clone = structuredClone;
const I = value => ({ $variant: 'i64', value });
const B = value => ({ $variant: 'Bool', value });
const O = value => ({ $variant: 'weak_object', value });
const L = (R, G, Bc, A = 1) => ({
  $variant: 'LinearColor', value: { R, G, B: Bc, A },
});

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
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  };
  const removeInput = (target, type, port) => {
    const previous = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return previous;
  };
  const label = text => one(scene.bricks.filter(saved => saved.comps.some(comp =>
    comp.type === C.Interact.NAME && (comp.data.PromptCustomLabel === text
      || comp.data.Message === text))), `label ${text}`);
  const relabel = (brickToLabel, text) => {
    const interact = component(brickToLabel, C.Interact.NAME);
    interact.data.Message = text;
    interact.data.PromptCustomLabel = text;
  };
  const base = clone(scene.bricks.find(saved =>
    saved.data.asset.startsWith('B_1x1_Gate_')).data);
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
    const result = {
      key: `${prefix}:${grid}:${name}:${sequence++}`,
      g: grid,
      data: brickData,
      comps,
    };
    scene.bricks.push(result);
    return result;
  };
  return {
    component, all, one, row, brick, incoming, outgoing,
    add, removeInput, label, relabel, gate,
  };
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
  copy.data.PlaneCenter = {
    X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2,
    Z: 0,
  };
  copy.data.PlaneExtent = {
    X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10,
    Z: 0,
  };
  scene.entityOverrides.set(grid, copy);
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  const g = graph(scene, 'v19');

  const entered = g.row(C.EntityZoneEvent_Entered.NAME,
    data => data.TagFilter === 'Vehicle', 'vehicle entered').brick;
  const left = g.row(C.EntityZoneEvent_Left.NAME,
    data => data.TagFilter === 'Vehicle', 'vehicle left').brick;
  const terminalGrid = entered.g;
  const insert = g.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle insert').brick;
  const remove = g.row(C.Exec_ArrayVar_RemoveAtIndex.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle remove').brick;
  const find = g.row(C.Exec_ArrayVar_Find.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle find').brick;
  const vehicleArray = g.brick(g.one(g.incoming(insert, C.Exec_ArrayVar_Insert.NAME,
    'ArrayVarRef'), 'active vehicle array').a);
  const restore = g.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color', 'vehicle restore sender').brick;
  const ready = g.label('Appearance ready (blocks preview until synchronized)');
  const readyEntryOff = g.label('Reset appearance ready on entry');
  const readyExitOff = g.label('Reset appearance ready on exit');
  const readyOn = g.label('Set ready after every sync setter completes');
  const previewGuard = g.label('Send preview only after live appearance sync');
  const syncBusy = g.label('Appearance synchronization busy');
  const notBusy = g.label('No appearance synchronization is running');
  const busyOff = g.label('Release appearance synchronization lock');
  const replyBusyOn = g.label('Lock live reply synchronization');
  const retryNotReady = g.label('Retry only before appearance is ready');
  const retryGuard = g.label('Seated retry guard');
  const requestTriggers = g.label('Vehicle entry or pending seated retry');
  const commitNonce = g.label('Commit request nonce before reading vehicle');

  const sessionVehicle = g.label('Seated session has a supported vehicle');
  const vehicleSupported = g.brick(g.one(g.incoming(sessionVehicle,
    C.Expr_LogicalAND.NAME, 'bInputB'), 'vehicle-supported state').a);
  const blinkClock = g.label('Selection blink clock');
  const blinkDetector = g.label('Session start/exit detector');
  const blinkVisible = g.label('Active visible blink');
  const sessionReady = g.brick(g.one(g.incoming(blinkClock, C.Clock.NAME,
    'bEnabled'), 'session-ready state').a);
  const seat = g.row(C.Seat.NAME, () => true, 'terminal seat').brick;

  // The first accepted vehicle owns the bay until that exact entity leaves.
  // Additional entries and their exits are complete no-ops.
  const entryGet = g.gate('Exec_ArrayVar_Get', terminalGrid,
    { Index: 0, Value: O(null), bOutOfBounds: true }, 'entry_active_vehicle',
    [70, 185, 225], 'Read active vehicle before accepting zone entry');
  const entryGuard = g.gate('Exec_Branch', terminalGrid, {}, 'entry_lock',
    [70, 185, 225], 'First vehicle lock empty check');
  const exitGuard = g.gate('Exec_Branch', terminalGrid, {}, 'exit_lock',
    [70, 185, 225], 'Active vehicle exit check');
  g.add(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', entryGet,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  g.one(g.removeInput(readyEntryOff, C.Exec_Var_Set.NAME, 'Exec'),
    'old unguarded vehicle entry');
  g.add(entered, C.EntityZoneEvent_Entered.NAME, 'Exec', entryGet,
    C.Exec_ArrayVar_Get.NAME, 'Exec');
  g.add(entryGet, C.Exec_ArrayVar_Get.NAME, 'ExecOut', entryGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(entryGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', entryGuard,
    C.Exec_Branch.NAME, 'bCond');

  g.one(g.removeInput(restore, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'),
    'old unguarded restore');
  g.one(g.removeInput(readyExitOff, C.Exec_Var_Set.NAME, 'Exec'),
    'old unguarded ready reset');
  g.one(g.removeInput(remove, C.Exec_ArrayVar_RemoveAtIndex.NAME, 'Exec'),
    'old unguarded vehicle removal');
  g.add(find, C.Exec_ArrayVar_Find.NAME, 'ExecOut', exitGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(find, C.Exec_ArrayVar_Find.NAME, 'bFound', exitGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(exitGuard, C.Exec_Branch.NAME, 'ExecOutA', restore,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');

  // Extend the already-validated appearance reply with the truck's retained
  // spawner owner. A null owner is never accepted and causes another request.
  const reply = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'appearance reply event').brick;
  g.component(reply, C.Event_CustomGlobal.NAME).data.DataOut6 = O(null);
  const stagedOwner = g.gate('Var', terminalGrid, { Value: O(null) },
    'staged_owner', [70, 185, 225], 'Staged vehicle owner');
  const stageOwner = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: O(null) }, 'stage_owner', [70, 185, 225],
    'Snapshot reply vehicle owner');
  g.add(stagedOwner, C.Var.NAME, 'VarRef', stageOwner,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(reply, C.Event_CustomGlobal.NAME, 'DataOut6', stageOwner,
    C.Exec_Var_Set.NAME, 'Value');
  const lastReplyStage = g.label('Snapshot reply data 5');
  const stagedReplyDelay = g.label('Wait for staged reply data');
  g.one(g.removeInput(stagedReplyDelay, C.BufferTicks.NAME, 'Input'),
    'old staged reply delay input');
  g.add(lastReplyStage, C.Exec_Var_Set.NAME, 'ExecOut', stageOwner,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(stageOwner, C.Exec_Var_Set.NAME, 'ExecOut', stagedReplyDelay,
    C.BufferTicks.NAME, 'Input');

  const activeOwner = g.gate('Var', terminalGrid, { Value: O(null) },
    'active_owner', [70, 185, 225], 'Active vehicle owner');
  const ownerReady = g.gate('Var', terminalGrid, { Value: B(false) },
    'owner_ready', [70, 185, 225], 'Vehicle owner ready');
  const clearEntry = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'clear_owner_entry',
    [70, 185, 225], 'Clear vehicle owner on entry');
  const clearEntryOwner = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: O(null) }, 'clear_active_owner_entry',
    [70, 185, 225], 'Reset active vehicle owner on entry');
  const clearExit = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'clear_owner_exit',
    [70, 185, 225], 'Clear vehicle owner on exit');
  const clearExitOwner = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: O(null) }, 'clear_active_owner_exit',
    [70, 185, 225], 'Reset active vehicle owner on exit');
  const clearEntrySession = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'clear_session_entry',
    [70, 185, 225], 'Reset terminal session on vehicle entry');
  const clearExitSession = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'clear_session_exit',
    [70, 185, 225], 'Reset terminal session on vehicle exit');
  for (const setter of [clearEntry, clearExit]) g.add(ownerReady, C.Var.NAME,
    'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  for (const setter of [clearEntryOwner, clearExitOwner]) g.add(activeOwner,
    C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  for (const setter of [clearEntrySession, clearExitSession]) g.add(sessionReady,
    C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(entryGuard, C.Exec_Branch.NAME, 'ExecOutA', clearEntry,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearEntry, C.Exec_Var_Set.NAME, 'ExecOut', clearEntrySession,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearEntrySession, C.Exec_Var_Set.NAME, 'ExecOut', clearEntryOwner,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearEntryOwner, C.Exec_Var_Set.NAME, 'ExecOut', readyEntryOff,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(restore, C.Exec_SendCustomEventGlobal.NAME, 'ExecOut', clearExit,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearExit, C.Exec_Var_Set.NAME, 'ExecOut', clearExitSession,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearExitSession, C.Exec_Var_Set.NAME, 'ExecOut', clearExitOwner,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(clearExitOwner, C.Exec_Var_Set.NAME, 'ExecOut', readyExitOff,
    C.Exec_Var_Set.NAME, 'Exec');
  const exitNonce = g.label('Invalidate late replies when vehicle leaves');
  g.add(exitNonce, C.Exec_Var_Set.NAME, 'ExecOut', remove,
    C.Exec_ArrayVar_RemoveAtIndex.NAME, 'Exec');

  const ownerPresent = g.gate('Expr_CompareNotEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'reply_owner_present',
    [70, 185, 225], 'Reply contains vehicle owner');
  const ownerBranch = g.gate('Exec_Branch', terminalGrid, {}, 'reply_owner_guard',
    [70, 185, 225], 'Accept only a non-null vehicle owner');
  const commitOwner = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: O(null) }, 'commit_owner',
    [70, 185, 225], 'Commit active vehicle owner');
  const commitOwnerReady = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(true) }, 'commit_owner_ready',
    [70, 185, 225], 'Commit vehicle owner ready');
  g.add(stagedOwner, C.Var.NAME, 'Value', ownerPresent,
    C.Expr_CompareNotEqual.NAME, 'InputA');
  g.add(ownerPresent, C.Expr_CompareNotEqual.NAME, 'bOutput', ownerBranch,
    C.Exec_Branch.NAME, 'bCond');
  g.add(stagedOwner, C.Var.NAME, 'Value', commitOwner,
    C.Exec_Var_Set.NAME, 'Value');
  g.add(activeOwner, C.Var.NAME, 'VarRef', commitOwner,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(ownerReady, C.Var.NAME, 'VarRef', commitOwnerReady,
    C.Exec_Var_Set.NAME, 'VarRef');
  const acceptedReply = g.label('Accepted live vehicle appearance');
  g.one(g.removeInput(replyBusyOn, C.Exec_Var_Set.NAME, 'Exec'),
    'old reply acceptance path');
  g.add(acceptedReply, C.Exec_Branch.NAME, 'ExecOutA', ownerBranch,
    C.Exec_Branch.NAME, 'Exec');
  g.add(ownerBranch, C.Exec_Branch.NAME, 'ExecOutA', replyBusyOn,
    C.Exec_Var_Set.NAME, 'Exec');
  const firstReplySetter = g.label('Set preview color from live truck');
  g.one(g.removeInput(firstReplySetter, C.Exec_Var_Set.NAME, 'Exec'),
    'old live-reply setter start');
  g.add(replyBusyOn, C.Exec_Var_Set.NAME, 'ExecOut', commitOwner,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(commitOwner, C.Exec_Var_Set.NAME, 'ExecOut', commitOwnerReady,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(commitOwnerReady, C.Exec_Var_Set.NAME, 'ExecOut', firstReplySetter,
    C.Exec_Var_Set.NAME, 'Exec');

  g.one(g.removeInput(retryNotReady, C.Expr_LogicalNOT.NAME, 'bInput'),
    'old appearance-ready retry signal');
  g.add(ownerReady, C.Var.NAME, 'Value', retryNotReady,
    C.Expr_LogicalNOT.NAME, 'bInput');
  const requestMerge = g.gate('Exec_Union', terminalGrid, {}, 'owner_request_merge',
    [70, 185, 225], 'Vehicle entry, seated retry, or null-owner retry');
  const nullOwnerDelay = g.gate('BufferTicks', terminalGrid,
    { TicksToWait: 1, ZeroTicksToWait: 0 }, 'null_owner_retry',
    [70, 185, 225], 'Retry request after a null owner reply');
  const requestDispatch = g.gate('Exec_Union', terminalGrid, {},
    'owner_request_dispatch', [70, 185, 225],
    'Normal owner request or post-sync recovery request');
  const retryAfterSync = g.gate('Exec_Branch', terminalGrid, {},
    'owner_retry_after_sync', [70, 185, 225],
    'Retry owner request after synchronization unlocks');
  g.one(g.removeInput(commitNonce, C.Exec_Var_Set.NAME, 'Exec'),
    'old appearance request trigger');
  g.add(requestTriggers, C.Exec_Union.NAME, 'ExecOut', requestMerge,
    C.Exec_Union.NAME, 'ExecA');
  g.add(ownerBranch, C.Exec_Branch.NAME, 'ExecOutB', nullOwnerDelay,
    C.BufferTicks.NAME, 'Input');
  g.add(nullOwnerDelay, C.BufferTicks.NAME, 'Output', requestMerge,
    C.Exec_Union.NAME, 'ExecB');
  g.add(requestMerge, C.Exec_Union.NAME, 'ExecOut', requestDispatch,
    C.Exec_Union.NAME, 'ExecA');
  g.add(busyOff, C.Exec_Var_Set.NAME, 'ExecOut', retryAfterSync,
    C.Exec_Branch.NAME, 'Exec');
  g.add(retryNotReady, C.Expr_LogicalNOT.NAME, 'bOutput', retryAfterSync,
    C.Exec_Branch.NAME, 'bCond');
  g.add(retryAfterSync, C.Exec_Branch.NAME, 'ExecOutA', requestDispatch,
    C.Exec_Union.NAME, 'ExecB');
  g.add(requestDispatch, C.Exec_Union.NAME, 'ExecOut', commitNonce,
    C.Exec_Var_Set.NAME, 'Exec');

  // Use the raw seat edge for recovery requests. The separately labeled blink
  // detector is changed below to represent only the authorized terminal state.
  const seatLifecycleEdge = g.one(g.all(C.Expr_EdgeDetectorExec.NAME,
    (_data, brick) => g.incoming(brick, C.Expr_EdgeDetectorExec.NAME, 'Input')
      .some(edge => edge.a === seat.key && edge.p === 'bIsOccupied')),
  'raw seat lifecycle detector').brick;
  g.one(g.removeInput(retryGuard, C.Exec_Branch.NAME, 'Exec'),
    'old session-ready retry trigger');
  g.add(seatLifecycleEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', retryGuard,
    C.Exec_Branch.NAME, 'Exec');

  // Resolve and gate the seated-session setup before user identity, Scrap, or
  // appearance leaderboard data can be read.
  const sessionStartUnion = g.brick(g.one(g.outgoing(seatLifecycleEdge,
    C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge').filter(edge =>
    edge.zt === C.Exec_Union.NAME), 'seat lifecycle union').z);
  const seatStateBranch = g.brick(g.one(g.outgoing(sessionStartUnion,
    C.Exec_Union.NAME, 'ExecOut').filter(edge => edge.zt === C.Exec_Branch.NAME),
  'seat occupied branch').z);
  const sessionStartOff = g.brick(g.one(g.outgoing(seatStateBranch,
    C.Exec_Branch.NAME, 'ExecOutA'), 'session start reset').z);
  const sessionGetPlayer = g.brick(g.one(g.outgoing(sessionStartOff,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'session PlayerState getter').z);
  const seatedSetter = g.brick(g.one(g.outgoing(sessionGetPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut'), 'seated PlayerState setter').z);
  const seatedPlayer = g.brick(g.one(g.incoming(seatedSetter,
    C.Exec_Var_Set.NAME, 'VarRef'), 'retained seated PlayerState').a);
  const userIdGetter = g.brick(g.one(g.outgoing(seatedSetter,
    C.Exec_Var_Set.NAME, 'ExecOut'), 'user ID getter after seat state').z);
  assert(g.component(userIdGetter, C.Exec_PlayerState_GetUserId.NAME));

  const ownerMatch = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'owner_match', [225, 75, 95],
    'Seated player owns active vehicle');
  g.add(activeOwner, C.Var.NAME, 'Value', ownerMatch,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(seatedPlayer, C.Var.NAME, 'Value', ownerMatch,
    C.Expr_CompareEqual.NAME, 'InputB');
  const ownerConfirmed = g.gate('Expr_LogicalAND', terminalGrid, {},
    'owner_confirmed', [225, 75, 95], 'Confirmed active owner matches seated player');
  const occupiedSupported = g.gate('Expr_LogicalAND', terminalGrid, {},
    'occupied_supported', [225, 75, 95], 'Occupied seat and supported active vehicle');
  const appearanceIdle = g.gate('Expr_LogicalAND', terminalGrid, {},
    'appearance_idle', [225, 75, 95], 'Appearance ready and synchronization idle');
  const ownerAndVehicle = g.gate('Expr_LogicalAND', terminalGrid, {},
    'owner_vehicle', [225, 75, 95], 'Confirmed owner and active vehicle');
  const startupEligible = g.gate('Expr_LogicalAND', terminalGrid, {},
    'startup_eligible', [225, 75, 95], 'Seated owner startup eligible');
  const authorized = g.gate('Expr_LogicalAND', terminalGrid, {},
    'terminal_authorized', [55, 190, 105], 'Terminal authorized');
  g.add(ownerReady, C.Var.NAME, 'Value', ownerConfirmed,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(ownerMatch, C.Expr_CompareEqual.NAME, 'bOutput', ownerConfirmed,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(seat, C.Seat.NAME, 'bIsOccupied', occupiedSupported,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(vehicleSupported, C.Var.NAME, 'Value', occupiedSupported,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(ready, C.Var.NAME, 'Value', appearanceIdle,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(notBusy, C.Expr_LogicalNOT.NAME, 'bOutput', appearanceIdle,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(ownerConfirmed, C.Expr_LogicalAND.NAME, 'bOutput', ownerAndVehicle,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(occupiedSupported, C.Expr_LogicalAND.NAME, 'bOutput', ownerAndVehicle,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(ownerAndVehicle, C.Expr_LogicalAND.NAME, 'bOutput', startupEligible,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(appearanceIdle, C.Expr_LogicalAND.NAME, 'bOutput', startupEligible,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(startupEligible, C.Expr_LogicalAND.NAME, 'bOutput', authorized,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(sessionReady, C.Var.NAME, 'Value', authorized,
    C.Expr_LogicalAND.NAME, 'bInputB');

  const startupGuard = g.gate('Exec_Branch', terminalGrid, {},
    'startup_owner_guard', [225, 75, 95], 'Authorize seated owner before user data');
  g.one(g.removeInput(userIdGetter, C.Exec_PlayerState_GetUserId.NAME, 'Exec'),
    'old unguarded user-data start');
  g.add(seatedSetter, C.Exec_Var_Set.NAME, 'ExecOut', startupGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(startupEligible, C.Expr_LogicalAND.NAME, 'bOutput', startupGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(startupGuard, C.Exec_Branch.NAME, 'ExecOutA', userIdGetter,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec');

  // A player may sit before the request/reply sync is complete. Re-run the
  // normal seat-start chain after the sync lock releases, but only if occupied.
  const sessionStartMerge = g.gate('Exec_Union', terminalGrid, {},
    'session_start_merge', [225, 75, 95], 'Seat entry or completed owner sync');
  const revalidateOccupied = g.gate('Exec_Branch', terminalGrid, {},
    'revalidate_occupied', [225, 75, 95], 'Retry seated owner after sync completes');
  const oldSessionStart = g.one(g.removeInput(sessionStartOff,
    C.Exec_Var_Set.NAME, 'Exec'), 'old seat-start execution');
  assert.equal(oldSessionStart.a, seatStateBranch.key);
  g.add(seatStateBranch, C.Exec_Branch.NAME, 'ExecOutA', sessionStartMerge,
    C.Exec_Union.NAME, 'ExecA');
  g.add(busyOff, C.Exec_Var_Set.NAME, 'ExecOut', revalidateOccupied,
    C.Exec_Branch.NAME, 'Exec');
  g.add(seat, C.Seat.NAME, 'bIsOccupied', revalidateOccupied,
    C.Exec_Branch.NAME, 'bCond');
  g.add(revalidateOccupied, C.Exec_Branch.NAME, 'ExecOutA', sessionStartMerge,
    C.Exec_Union.NAME, 'ExecB');
  g.add(sessionStartMerge, C.Exec_Union.NAME, 'ExecOut', sessionStartOff,
    C.Exec_Var_Set.NAME, 'Exec');

  // Every interactive surface is driven by full authorization, not merely by
  // seat occupancy or an appearance-ready bit.
  g.removeInput(previewGuard, C.Exec_Branch.NAME, 'bCond');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', previewGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.removeInput(blinkClock, C.Clock.NAME, 'bEnabled');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkClock,
    C.Clock.NAME, 'bEnabled');
  g.removeInput(blinkDetector, C.Expr_EdgeDetectorExec.NAME, 'Input');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkDetector,
    C.Expr_EdgeDetectorExec.NAME, 'Input');
  g.removeInput(blinkVisible, C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkVisible,
    C.Expr_LogicalAND.NAME, 'bInputA');
  const buyAllowed = g.label('BUY selected during seated session');
  g.removeInput(buyAllowed, C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', buyAllowed,
    C.Expr_LogicalAND.NAME, 'bInputB');

  const coreCharacter = g.row(C.MicrochipInput.NAME,
    data => data.PortLabel === 'Character', 'core character input').brick;
  g.one(g.removeInput(coreCharacter, C.MicrochipInput.NAME, 'RER_Input'),
    'old unrestricted character input');
  const authorizedCharacter = g.gate('Expr_Select', terminalGrid,
    { bSelectB: false, InputA: O(null), InputB: O(null) },
    'authorized_character', [55, 190, 105], 'Authorized character input');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', authorizedCharacter,
    C.Expr_Select.NAME, 'bSelectB');
  g.add(seat, C.Seat.NAME, 'SittingCharacter', authorizedCharacter,
    C.Expr_Select.NAME, 'InputB');
  g.add(authorizedCharacter, C.Expr_Select.NAME, 'Output', coreCharacter,
    C.MicrochipInput.NAME, 'RER_Input');

  const screenRerouter = g.one(g.all(C.Rerouter.NAME,
    (_data, brick) => g.outgoing(brick, C.Rerouter.NAME, 'RER_Output')
      .filter(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'bEnabled').length === 2),
  'shared screen enable').brick;
  g.one(g.removeInput(screenRerouter, C.Rerouter.NAME, 'RER_Input'),
    'old occupied-screen enable');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', screenRerouter,
    C.Rerouter.NAME, 'RER_Input');

  // Indicator truth table: black off/unknown, green authorized, red only when
  // a supported synchronized vehicle has a confirmed different owner.
  const notOwnerMatch = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: false },
    'not_owner_match', [225, 75, 95], 'Seated player is not the active owner');
  const wrongConfirmed = g.gate('Expr_LogicalAND', terminalGrid, {},
    'wrong_confirmed', [225, 75, 95], 'Confirmed owner differs from seated player');
  const wrongOccupied = g.gate('Expr_LogicalAND', terminalGrid, {},
    'wrong_occupied', [225, 75, 95], 'Wrong-player check has seat and vehicle');
  const wrongAppearance = g.gate('Expr_LogicalAND', terminalGrid, {},
    'wrong_appearance', [225, 75, 95], 'Wrong-player check is synchronized');
  const wrongLeft = g.gate('Expr_LogicalAND', terminalGrid, {},
    'wrong_left', [225, 75, 95], 'Confirmed mismatch in occupied vehicle bay');
  const wrongPlayer = g.gate('Expr_LogicalAND', terminalGrid, {},
    'wrong_player', [225, 75, 95], 'Wrong player in seat');
  g.add(ownerMatch, C.Expr_CompareEqual.NAME, 'bOutput', notOwnerMatch,
    C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(ownerReady, C.Var.NAME, 'Value', wrongConfirmed,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(notOwnerMatch, C.Expr_LogicalNOT.NAME, 'bOutput', wrongConfirmed,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(seat, C.Seat.NAME, 'bIsOccupied', wrongOccupied,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(vehicleSupported, C.Var.NAME, 'Value', wrongOccupied,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(ready, C.Var.NAME, 'Value', wrongAppearance,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(notBusy, C.Expr_LogicalNOT.NAME, 'bOutput', wrongAppearance,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(wrongConfirmed, C.Expr_LogicalAND.NAME, 'bOutput', wrongLeft,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(wrongOccupied, C.Expr_LogicalAND.NAME, 'bOutput', wrongLeft,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(wrongLeft, C.Expr_LogicalAND.NAME, 'bOutput', wrongPlayer,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(wrongAppearance, C.Expr_LogicalAND.NAME, 'bOutput', wrongPlayer,
    C.Expr_LogicalAND.NAME, 'bInputB');

  const indicator = g.one(g.all(C.TextDisplay.NAME,
    (_data, brick) => g.incoming(brick, C.TextDisplay.NAME, 'Color').length === 1),
  'physical indicator display').brick;
  const indicatorSelect = g.brick(g.one(g.incoming(indicator, C.TextDisplay.NAME,
    'Color'), 'indicator color select').a);
  g.one(g.removeInput(indicatorSelect, C.Expr_Select.NAME, 'bSelectB'),
    'old indicator seat state');
  const offOrWrong = g.gate('Expr_Select', indicatorSelect.g,
    { bSelectB: false, InputA: L(0, 0, 0), InputB: L(1, 0, 0) },
    'indicator_off_wrong', [225, 75, 95], 'Indicator off or wrong');
  g.add(wrongPlayer, C.Expr_LogicalAND.NAME, 'bOutput', offOrWrong,
    C.Expr_Select.NAME, 'bSelectB');
  g.add(offOrWrong, C.Expr_Select.NAME, 'Output', indicatorSelect,
    C.Expr_Select.NAME, 'InputA');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', indicatorSelect,
    C.Expr_Select.NAME, 'bSelectB');

  // Require a current owner match before any purchase leaderboard read, then
  // resolve the seated PlayerState again immediately before the write.
  const playerGetters = g.all(C.Exec_PlayerState_GetFromEntity.NAME,
    (_data, brick) => brick.g === terminalGrid).map(item => item.brick);
  const purchaseGetPlayer = g.one(playerGetters.filter(brick => brick !== sessionGetPlayer),
    'purchase PlayerState getter');
  const purchaseScrap = g.brick(g.one(g.outgoing(purchaseGetPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut'), 'purchase Scrap getter').z);
  assert.equal(g.component(purchaseScrap,
    C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key, 'Scrap');
  const purchaseOwnerMatch = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'purchase_owner_match',
    [235, 165, 65], 'Purchase seated owner matches active vehicle');
  const purchaseOwnerGuard = g.gate('Exec_Branch', terminalGrid, {},
    'purchase_owner_guard', [235, 165, 65], 'Authorize owner before purchase reads');
  const purchaseNonce = g.gate('Var', terminalGrid, { Value: I(0) },
    'purchase_nonce', [235, 165, 65], 'Purchase active-session nonce');
  const snapshotPurchaseNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(0) }, 'snapshot_purchase_nonce',
    [235, 165, 65], 'Snapshot active session before purchase reads');
  const appearanceNonce = g.label('Appearance request nonce');
  g.add(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    purchaseOwnerMatch, C.Expr_CompareEqual.NAME, 'InputA');
  g.add(activeOwner, C.Var.NAME, 'Value', purchaseOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(purchaseOwnerMatch, C.Expr_CompareEqual.NAME, 'bOutput', purchaseOwnerGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(purchaseNonce, C.Var.NAME, 'VarRef', snapshotPurchaseNonce,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(appearanceNonce, C.Var.NAME, 'Value', snapshotPurchaseNonce,
    C.Exec_Var_Set.NAME, 'Value');
  g.one(g.removeInput(purchaseScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec'),
    'old unguarded purchase data start');
  g.add(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut',
    purchaseOwnerGuard, C.Exec_Branch.NAME, 'Exec');
  g.add(purchaseOwnerGuard, C.Exec_Branch.NAME, 'ExecOutA', snapshotPurchaseNonce,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(snapshotPurchaseNonce, C.Exec_Var_Set.NAME, 'ExecOut', purchaseScrap,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');

  const colorWrite = g.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    data => data.Key === '', 'saved color write').brick;
  const finalMutation = g.brick(g.one(g.incoming(colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec'), 'final mutation branch').a);
  const finalCondition = g.brick(g.one(g.incoming(finalMutation,
    C.Exec_Branch.NAME, 'bCond'), 'old final mutation condition').a);
  g.relabel(finalMutation, 'Final authorized owner BUY guard');
  const changedDriver = g.one(g.removeInput(finalMutation, C.Exec_Branch.NAME, 'Exec'),
    'appearance-changed execution before final mutation');
  const freshPlayer = g.gate('Exec_PlayerState_GetFromEntity', terminalGrid, {},
    'fresh_purchase_player', [235, 165, 65], 'Refresh seated player before purchase write');
  const freshOwnerMatch = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'fresh_owner_match',
    [235, 165, 65], 'Fresh seated owner matches active vehicle');
  const samePurchasePlayer = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'same_purchase_player',
    [235, 165, 65], 'Purchase player remained in the seat');
  const samePurchaseNonce = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: I(0), InputB: I(0) }, 'same_purchase_nonce',
    [235, 165, 65], 'Purchase active vehicle session is unchanged');
  const finalOwnerIdentity = g.gate('Expr_LogicalAND', terminalGrid, {},
    'final_owner_identity', [235, 165, 65], 'Fresh owner and purchase player both match');
  const finalSessionIdentity = g.gate('Expr_LogicalAND', terminalGrid, {},
    'final_session_identity', [235, 165, 65], 'Final purchase identity and session match');
  g.add(seat, C.Seat.NAME, 'SittingCharacter', freshPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'Entity');
  g.add(g.brick(changedDriver.a), changedDriver.at, changedDriver.p, freshPlayer,
    C.Exec_PlayerState_GetFromEntity.NAME, 'Exec');
  g.add(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', finalMutation,
    C.Exec_Branch.NAME, 'Exec');
  g.add(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', freshOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(activeOwner, C.Var.NAME, 'Value', freshOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    samePurchasePlayer, C.Expr_CompareEqual.NAME, 'InputA');
  g.add(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    samePurchasePlayer, C.Expr_CompareEqual.NAME, 'InputB');
  g.add(appearanceNonce, C.Var.NAME, 'Value', samePurchaseNonce,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(purchaseNonce, C.Var.NAME, 'Value', samePurchaseNonce,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(freshOwnerMatch, C.Expr_CompareEqual.NAME, 'bOutput', finalOwnerIdentity,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(samePurchasePlayer, C.Expr_CompareEqual.NAME, 'bOutput', finalOwnerIdentity,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(finalOwnerIdentity, C.Expr_LogicalAND.NAME, 'bOutput', finalSessionIdentity,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(samePurchaseNonce, C.Expr_CompareEqual.NAME, 'bOutput', finalSessionIdentity,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.removeInput(finalCondition, C.Expr_LogicalAND.NAME, 'bInputA');
  g.removeInput(finalCondition, C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(authorized, C.Expr_LogicalAND.NAME, 'bOutput', finalCondition,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(finalSessionIdentity, C.Expr_LogicalAND.NAME, 'bOutput', finalCondition,
    C.Expr_LogicalAND.NAME, 'bInputB');

  rowAt([entryGet, entryGuard, clearEntry, clearEntrySession, clearEntryOwner,
    exitGuard, clearExit, clearExitSession, clearExitOwner], 320, -145);
  rowAt([stagedOwner, stageOwner, activeOwner, ownerReady, ownerPresent,
    ownerBranch, commitOwner, commitOwnerReady], 320, -165);
  rowAt([requestMerge, nullOwnerDelay, requestDispatch, retryAfterSync,
    ownerMatch, ownerConfirmed,
    occupiedSupported, appearanceIdle, ownerAndVehicle, startupEligible,
    authorized], 320, -185);
  rowAt([startupGuard, sessionStartMerge, revalidateOccupied,
    authorizedCharacter, notOwnerMatch, wrongConfirmed, wrongOccupied,
    wrongAppearance, wrongLeft, wrongPlayer], 320, -205);
  rowAt([purchaseOwnerMatch, purchaseOwnerGuard, purchaseNonce,
    snapshotPurchaseNonce, freshPlayer, freshOwnerMatch, samePurchasePlayer,
    samePurchaseNonce, finalOwnerIdentity, finalSessionIdentity], 320, -225);
  rowAt([offOrWrong], 220, -85);

  // Match the user's existing readable layout: every new touching-gate lane
  // gets a fixed black section card in addition to per-gate hover labels.
  const headerDonor = g.one(scene.bricks.filter(brick => brick.g === terminalGrid
    && brick.comps.some(comp => comp.type === C.TextDisplay.NAME
      && comp.data.Text === 'ZONE\r\nVEHICLE')), 'terminal section-header donor');
  const addHeader = (text, y, index) => {
    const header = clone(headerDonor);
    header.key = `v19:${terminalGrid}:section_header:${index}`;
    header.data.position = [280, y, 2];
    header.data.size = [30, 5, 2];
    g.component(header, C.TextDisplay.NAME).data.Text = text;
    scene.bricks.push(header);
    return header;
  };
  addHeader('VEHICLE BAY\r\nLOCK', -145, 0);
  addHeader('OWNER\r\nREPLY', -165, 1);
  addHeader('OWNER\r\nAUTHORIZATION', -185, 2);
  addHeader('SESSION +\r\nINDICATOR', -205, 3);
  addHeader('PURCHASE OWNER\r\nGUARDS', -225, 4);
  fit(scene, terminalGrid);
  fit(scene, indicatorSelect.g);

  const metadata = {
    name: 'Scrap Runners - Color Terminal v19 Owner-Locked Bay',
    description: 'Locks the bay to its first vehicle, accepts only its spawner-provided owner, blocks unauthorized display/input/preview/purchase paths, and shows black/green/red terminal state.',
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
    vehicleLock: 'first vehicle stays active until it leaves',
    ownerGate: 'spawner owner must equal seated PlayerState',
    indicator: 'black off/unknown, green authorized, red wrong player',
    truck: 'pair with Truck1 v9',
  }, null, 2));
}
