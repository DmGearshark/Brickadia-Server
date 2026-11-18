'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testTruckV9 = require('./test-scrap-runners-truck1-color-enabled-v9.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const DEFAULT_V18 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v18.brz');
const DEFAULT_V19 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v19.brz');
const DEFAULT_TRUCK_V9 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v9.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v19.cjs');

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
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  return {
    scene,
    bricks,
    rows,
    all,
    one,
    incoming,
    outgoing,
    source: edge => bricks.get(edge.a),
    target: edge => bricks.get(edge.z),
    label,
  };
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

const EXEC_PORTS = new Set(['ExecOut', 'ExecOutA', 'ExecOutB', 'Output',
  'OnRisingEdge', 'OnFallingEdge', 'bPulseOnChange']);

function execReachableFromPort(scene, start, startPort, goal) {
  const queue = scene.edges.filter(edge => edge.a === start.key && edge.p === startPort)
    .map(edge => edge.z);
  const seen = new Set(queue);
  while (queue.length) {
    const key = queue.shift();
    if (key === goal.key) return true;
    for (const edge of scene.edges.filter(candidate => candidate.a === key
      && EXEC_PORTS.has(candidate.p))) {
      if (seen.has(edge.z)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return false;
}

function dataDependsOn(scene, target, source, targetPort) {
  const incoming = targetPort
    ? scene.edges.filter(edge => edge.z === target.key && edge.q === targetPort)
    : scene.edges.filter(edge => edge.z === target.key);
  const queue = incoming.map(edge => edge.a);
  const seen = new Set(queue);
  while (queue.length) {
    const key = queue.shift();
    if (key === source.key) return true;
    for (const edge of scene.edges.filter(candidate => candidate.z === key)) {
      if (seen.has(edge.a)) continue;
      seen.add(edge.a);
      queue.push(edge.a);
    }
  }
  return false;
}

function assertWeakObject(comp, field, label) {
  assert.equal(comp.data[field].$variant, 'weak_object', `${label} is a weak_object`);
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}

function sectionLayoutContract(scene, terminalGrid) {
  const t = api(scene);
  const sections = [
    {
      text: 'VEHICLE BAY\r\nLOCK', y: -145,
      gates: ['Read active vehicle before accepting zone entry',
        'First vehicle lock empty check', 'Clear vehicle owner on entry',
        'Reset terminal session on vehicle entry', 'Reset active vehicle owner on entry',
        'Active vehicle exit check', 'Clear vehicle owner on exit',
        'Reset terminal session on vehicle exit', 'Reset active vehicle owner on exit'],
    },
    {
      text: 'OWNER\r\nREPLY', y: -165,
      gates: ['Staged vehicle owner', 'Snapshot reply vehicle owner',
        'Active vehicle owner', 'Vehicle owner ready', 'Reply contains vehicle owner',
        'Accept only a non-null vehicle owner', 'Commit active vehicle owner',
        'Commit vehicle owner ready'],
    },
    {
      text: 'OWNER\r\nAUTHORIZATION', y: -185,
      gates: ['Vehicle entry, seated retry, or null-owner retry',
        'Retry request after a null owner reply',
        'Normal owner request or post-sync recovery request',
        'Retry owner request after synchronization unlocks',
        'Seated player owns active vehicle',
        'Confirmed active owner matches seated player',
        'Occupied seat and supported active vehicle',
        'Appearance ready and synchronization idle',
        'Confirmed owner and active vehicle', 'Seated owner startup eligible',
        'Terminal authorized'],
    },
    {
      text: 'SESSION +\r\nINDICATOR', y: -205,
      gates: ['Authorize seated owner before user data',
        'Seat entry or completed owner sync', 'Retry seated owner after sync completes',
        'Authorized character input', 'Seated player is not the active owner',
        'Confirmed owner differs from seated player',
        'Wrong-player check has seat and vehicle',
        'Wrong-player check is synchronized',
        'Confirmed mismatch in occupied vehicle bay', 'Wrong player in seat'],
    },
    {
      text: 'PURCHASE OWNER\r\nGUARDS', y: -225,
      gates: ['Purchase seated owner matches active vehicle',
        'Authorize owner before purchase reads', 'Purchase active-session nonce',
        'Snapshot active session before purchase reads',
        'Refresh seated player before purchase write',
        'Fresh seated owner matches active vehicle', 'Purchase player remained in the seat',
        'Purchase active vehicle session is unchanged',
        'Fresh owner and purchase player both match',
        'Final purchase identity and session match'],
    },
  ];

  for (const section of sections) {
    const header = t.one(t.all(C.TextDisplay.NAME,
      data => data.Text === section.text), `${section.text} section header`).brick;
    assert.equal(header.g, terminalGrid, `${section.text} header is on the terminal chip`);
    assert.deepEqual(header.data.position, [280, section.y, 2],
      `${section.text} header has fixed aligned placement`);
    assert.deepEqual(header.data.size, [30, 5, 2],
      `${section.text} header has the fixed section-card size`);
    assert.deepEqual(header.data.color, [0, 0, 0], `${section.text} header is black`);

    const row = section.gates.map(label => t.label(label));
    assert(row.every(brick => brick.g === terminalGrid),
      `${section.text} gate row stays on the terminal chip`);
    assert(row.every(brick => brick.data.position[1] === section.y
      && brick.data.position[2] === 2),
    `${section.text} gate row is aligned on-grid`);
    assert.equal(row[0].data.position[0] - halfSize(row[0])[0], 320,
      `${section.text} gate row starts at the fixed grid edge`);
    for (let index = 1; index < row.length; index++) {
      const left = row[index - 1];
      const right = row[index];
      assert.equal(right.data.position[0] - left.data.position[0],
        halfSize(left)[0] + halfSize(right)[0],
        `${section.text} gate ${index + 1} touches the previous gate`);
    }
  }
  return sections;
}

function vehicleLockContract(scene) {
  const t = api(scene);
  const entry = t.one(t.all(C.EntityZoneEvent_Entered.NAME,
    data => data.TagFilter === 'Vehicle'), 'vehicle entered event').brick;
  const exit = t.one(t.all(C.EntityZoneEvent_Left.NAME,
    data => data.TagFilter === 'Vehicle'), 'vehicle left event').brick;
  const insert = t.one(t.all(C.Exec_ArrayVar_Insert.NAME), 'active vehicle insert').brick;
  const remove = t.one(t.all(C.Exec_ArrayVar_RemoveAtIndex.NAME),
    'active vehicle remove').brick;
  const restore = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color'), 'active vehicle restore').brick;

  const entryGuard = t.label('First vehicle lock empty check');
  assert(component(entryGuard, C.Exec_Branch.NAME), 'entry lock is an execution branch');
  const entryGet = sourceOf(t, entryGuard, C.Exec_Branch.NAME, 'Exec',
    'entry lock execution source').brick;
  assert(component(entryGet, C.Exec_ArrayVar_Get.NAME),
    'entry lock reads array index zero before accepting a vehicle');
  assertEdge(t, entry, C.EntityZoneEvent_Entered.NAME, 'Exec', entryGet,
    C.Exec_ArrayVar_Get.NAME, 'Exec', 'zone entry starts the empty-lock read');
  assertEdge(t, entryGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', entryGuard,
    C.Exec_Branch.NAME, 'bCond', 'only an empty array accepts the entering vehicle');
  assert(execReachableFromPort(scene, entryGuard, 'ExecOutA', insert),
    'accepted first vehicle reaches the array insert');
  assert.equal(t.outgoing(entryGuard, C.Exec_Branch.NAME, 'ExecOutB').length, 0,
    'extra vehicle entry is ignored without mutating the active session');

  const exitGuard = t.label('Active vehicle exit check');
  assert(component(exitGuard, C.Exec_Branch.NAME), 'exit lock is an execution branch');
  const find = sourceOf(t, exitGuard, C.Exec_Branch.NAME, 'Exec',
    'exit lock execution source').brick;
  assert(component(find, C.Exec_ArrayVar_Find.NAME),
    'exit lock searches only the retained active-vehicle array');
  assertEdge(t, exit, C.EntityZoneEvent_Left.NAME, 'Exec', find,
    C.Exec_ArrayVar_Find.NAME, 'Exec', 'zone exit first searches the active vehicle');
  assertEdge(t, find, C.Exec_ArrayVar_Find.NAME, 'bFound', exitGuard,
    C.Exec_Branch.NAME, 'bCond', 'only the active vehicle can close the session');
  assert(execReachableFromPort(scene, exitGuard, 'ExecOutA', remove),
    'active vehicle exit removes the retained array member');
  assert(execReachableFromPort(scene, exitGuard, 'ExecOutA', restore),
    'active vehicle exit restores its purchased appearance');
  assert.equal(t.outgoing(exitGuard, C.Exec_Branch.NAME, 'ExecOutB').length, 0,
    'ignored vehicle exit cannot clear or restore the active session');

  return { t, entry, exit, entryGuard, exitGuard, entryGet, find, insert, remove, restore };
}

function ownerReplyContract(scene, lock) {
  const { t } = lock;
  const reply = t.one(t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply event').brick;
  const replyComp = component(reply, C.Event_CustomGlobal.NAME);
  assertWeakObject(replyComp, 'DataOut6', 'appearance reply owner Data6');
  assert.equal(valueOf(replyComp.data.DataOut6), null,
    'appearance reply owner is null-safe before a live truck replies');

  const stagedOwner = t.label('Staged vehicle owner');
  const stagedComp = component(stagedOwner, C.Var.NAME);
  assert(stagedComp, 'staged owner is retained in a Var');
  assertWeakObject(stagedComp, 'Value', 'staged vehicle owner');
  const stageSetter = t.one(t.outgoing(stagedOwner, C.Var.NAME, 'VarRef')
    .map(edge => t.target(edge)).filter(brick => component(brick, C.Exec_Var_Set.NAME)
      && t.incoming(brick, C.Exec_Var_Set.NAME, 'Value').some(edge =>
        edge.a === reply.key && edge.p === 'DataOut6')), 'staged owner setter');
  assertEdge(t, reply, C.Event_CustomGlobal.NAME, 'DataOut6', stageSetter,
    C.Exec_Var_Set.NAME, 'Value', 'reply Data6 stages the vehicle owner');

  const activeOwner = t.label('Active vehicle owner');
  const activeComp = component(activeOwner, C.Var.NAME);
  assert(activeComp, 'accepted owner is retained separately from reply staging');
  assertWeakObject(activeComp, 'Value', 'active vehicle owner');
  const ownerReady = t.label('Vehicle owner ready');
  const readyComp = component(ownerReady, C.Var.NAME);
  assert(readyComp, 'owner-ready state is retained in a Var');
  assert.equal(readyComp.data.Value.$variant, 'Bool');
  assert.equal(valueOf(readyComp.data.Value), false, 'owner starts unavailable');

  const hasOwner = t.label('Reply contains vehicle owner');
  assert(component(hasOwner, C.Expr_CompareNotEqual.NAME),
    'owner presence uses an explicit null comparison');
  assert(dataDependsOn(scene, hasOwner, stagedOwner, 'InputA'),
    'owner presence reads the staged owner');
  const nullInput = component(hasOwner, C.Expr_CompareNotEqual.NAME).data.InputB;
  assert.equal(nullInput.$variant, 'weak_object');
  assert.equal(valueOf(nullInput), null, 'owner presence compares against null');
  const ownerBranch = targetOf(t, hasOwner, C.Expr_CompareNotEqual.NAME,
    'bOutput', 'owner-presence branch').brick;
  assert(component(ownerBranch, C.Exec_Branch.NAME));
  const acceptedAppearance = t.label('Accepted live vehicle appearance');
  assertEdge(t, acceptedAppearance, C.Exec_Branch.NAME, 'ExecOutA', ownerBranch,
    C.Exec_Branch.NAME, 'Exec', 'only an already validated current reply checks owner Data6');

  const commitOwner = t.label('Commit active vehicle owner');
  const commitReady = t.label('Commit vehicle owner ready');
  assert(component(commitOwner, C.Exec_Var_Set.NAME));
  assert(component(commitReady, C.Exec_Var_Set.NAME));
  assertEdge(t, stagedOwner, C.Var.NAME, 'Value', commitOwner,
    C.Exec_Var_Set.NAME, 'Value', 'accepted owner is copied from staging');
  assertEdge(t, activeOwner, C.Var.NAME, 'VarRef', commitOwner,
    C.Exec_Var_Set.NAME, 'VarRef', 'accepted owner updates the active owner');
  assertEdge(t, ownerReady, C.Var.NAME, 'VarRef', commitReady,
    C.Exec_Var_Set.NAME, 'VarRef', 'accepted owner marks owner-ready');
  assert.equal(valueOf(component(commitReady, C.Exec_Var_Set.NAME).data.Value), true,
    'accepted owner sets owner-ready true');
  assert(execReachableFromPort(scene, ownerBranch, 'ExecOutA', commitOwner));
  assert(execReachableFromPort(scene, ownerBranch, 'ExecOutA', commitReady));

  const request = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request'), 'appearance request sender').brick;
  assert(execReachableFromPort(scene, ownerBranch, 'ExecOutB', request),
    'a current reply with null owner retries instead of freezing the terminal');
  assert(!execReachableFromPort(scene, ownerBranch, 'ExecOutB', commitReady),
    'null owner never marks owner-ready');

  const busyOff = t.label('Release appearance synchronization lock');
  const retryAfterSync = t.label('Retry owner request after synchronization unlocks');
  const retryNotReady = t.label('Retry only before appearance is ready');
  assertEdge(t, busyOff, C.Exec_Var_Set.NAME, 'ExecOut', retryAfterSync,
    C.Exec_Branch.NAME, 'Exec', 'sync unlock evaluates an owner retry');
  assertEdge(t, ownerReady, C.Var.NAME, 'Value', retryNotReady,
    C.Expr_LogicalNOT.NAME, 'bInput', 'post-sync retry tests owner-ready, not appearance-ready');
  assertEdge(t, retryNotReady, C.Expr_LogicalNOT.NAME, 'bOutput', retryAfterSync,
    C.Exec_Branch.NAME, 'bCond', 'owner-not-ready selects the retry path');
  assert(execReachableFromPort(scene, retryAfterSync, 'ExecOutA', request),
    'sync completion with no owner reaches a new appearance request');

  const clearEntry = t.label('Clear vehicle owner on entry');
  const clearExit = t.label('Clear vehicle owner on exit');
  for (const [clear, source, port, label] of [
    [clearEntry, lock.entryGuard, 'ExecOutA', 'entry'],
    [clearExit, lock.exitGuard, 'ExecOutA', 'exit'],
  ]) {
    assert(component(clear, C.Exec_Var_Set.NAME), `${label} owner clear is a setter`);
    assertEdge(t, ownerReady, C.Var.NAME, 'VarRef', clear,
      C.Exec_Var_Set.NAME, 'VarRef', `${label} clears owner-ready`);
    assert.equal(valueOf(component(clear, C.Exec_Var_Set.NAME).data.Value), false,
      `${label} clears owner-ready to false`);
    assert(execReachableFromPort(scene, source, port, clear),
      `${label} accepted path clears stale ownership`);
  }

  const clearEntryOwner = t.label('Reset active vehicle owner on entry');
  const clearExitOwner = t.label('Reset active vehicle owner on exit');
  for (const [clear, source, terminalMutation, label] of [
    [clearEntryOwner, lock.entryGuard, lock.insert, 'entry'],
    [clearExitOwner, lock.exitGuard, lock.remove, 'exit'],
  ]) {
    const setter = component(clear, C.Exec_Var_Set.NAME);
    assert(setter, `${label} active-owner clear is a setter`);
    assert.equal(setter.data.Value.$variant, 'weak_object');
    assert.equal(valueOf(setter.data.Value), null,
      `${label} clears the retained active owner to null`);
    assertEdge(t, activeOwner, C.Var.NAME, 'VarRef', clear,
      C.Exec_Var_Set.NAME, 'VarRef', `${label} clears the active-owner Var`);
    assert(execReachableFromPort(scene, source, 'ExecOutA', clear),
      `${label} accepted path clears the active owner`);
    assert(execReachableFromPort(scene, clear, 'ExecOut', terminalMutation),
      `${label} clears the active owner before array mutation`);
  }

  return { reply, stagedOwner, activeOwner, ownerReady, hasOwner, ownerBranch,
    commitOwner, commitReady, clearEntry, clearExit, clearEntryOwner, clearExitOwner,
    request, busyOff, retryAfterSync, retryNotReady };
}

function authorizationContract(scene, lock, owner) {
  const { t } = lock;
  const seat = t.one(t.all(C.Seat.NAME), 'terminal seat').brick;
  const ownerMatch = t.label('Seated player owns active vehicle');
  assert(component(ownerMatch, C.Expr_CompareEqual.NAME),
    'seated player and vehicle owner are compared as weak objects');
  assert(dataDependsOn(scene, ownerMatch, owner.activeOwner),
    'owner comparison reads the active vehicle owner');
  const matchSources = ['InputA', 'InputB'].map(port => sourceOf(t, ownerMatch,
    C.Expr_CompareEqual.NAME, port, `owner match ${port}`).brick);
  const seatedPlayer = matchSources.find(brick => brick.key !== owner.activeOwner.key);
  assert(seatedPlayer && component(seatedPlayer, C.Var.NAME),
    'other owner-match input is the retained seated PlayerState');
  assertWeakObject(component(seatedPlayer, C.Var.NAME), 'Value', 'retained seated PlayerState');

  const authorized = t.label('Terminal authorized');
  assert(component(authorized, C.Expr_LogicalAND.NAME),
    'terminal authorization is an explicit combined condition');
  assert(dataDependsOn(scene, authorized, ownerMatch), 'authorization requires owner match');
  assert(dataDependsOn(scene, authorized, owner.ownerReady),
    'authorization requires a confirmed live owner reply');
  assert(dataDependsOn(scene, authorized, seat), 'authorization requires the seat occupied');
  assert(dataDependsOn(scene, authorized, t.label(
    'Appearance ready (blocks preview until synchronized)')),
  'authorization waits for the live appearance snapshot');
  const sessionReady = sourceOf(t, authorized, C.Expr_LogicalAND.NAME, 'bInputB',
    'terminal authorization session-ready input').brick;
  assert(component(sessionReady, C.Var.NAME),
    'terminal authorization reads retained session-ready state');

  for (const [reset, source, mutation, label] of [
    [t.label('Reset terminal session on vehicle entry'), lock.entryGuard,
      lock.insert, 'entry'],
    [t.label('Reset terminal session on vehicle exit'), lock.exitGuard,
      lock.remove, 'exit'],
  ]) {
    const setter = component(reset, C.Exec_Var_Set.NAME);
    assert(setter, `${label} session reset is a setter`);
    assert.equal(setter.data.Value.$variant, 'Bool');
    assert.equal(valueOf(setter.data.Value), false,
      `${label} clears session-ready to false`);
    assertEdge(t, sessionReady, C.Var.NAME, 'VarRef', reset,
      C.Exec_Var_Set.NAME, 'VarRef', `${label} resets the authorized session Var`);
    assert(execReachableFromPort(scene, source, 'ExecOutA', reset),
      `accepted ${label} reaches the session reset`);
    assert(execReachableFromPort(scene, reset, 'ExecOut', mutation),
      `${label} clears session-ready before array mutation`);
  }

  const startup = t.label('Authorize seated owner before user data');
  assert(component(startup, C.Exec_Branch.NAME), 'seat startup has an authorization branch');
  assert(dataDependsOn(scene, startup, ownerMatch, 'bCond'),
    'seat startup checks ownership before user data');
  assert(dataDependsOn(scene, startup, owner.ownerReady, 'bCond'),
    'seat startup waits for owner reply before user data');
  const userId = t.one(t.all(C.Exec_PlayerState_GetUserId.NAME), 'user ID getter').brick;
  const userName = t.one(t.all(C.Exec_PlayerState_GetUserName.NAME), 'username getter').brick;
  const sessionScrap = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Scrap').filter(({ brick }) =>
    t.incoming(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState')
      .some(edge => edge.a === seatedPlayer.key)), 'session Scrap getter').brick;
  for (const [target, label] of [[userId, 'user ID'], [userName, 'username'],
    [sessionScrap, 'session Scrap']]) {
    assert(execReachableFromPort(scene, startup, 'ExecOutA', target),
      `authorized startup reaches ${label}`);
    assert(!execReachableFromPort(scene, startup, 'ExecOutB', target),
      `wrong owner cannot reach ${label}`);
  }

  const inputSelect = t.label('Authorized character input');
  const inputSelectComp = component(inputSelect, C.Expr_Select.NAME);
  assert(inputSelectComp, 'seat controls are blocked through an object Select');
  assert.equal(inputSelectComp.data.InputA.$variant, 'weak_object');
  assert.equal(valueOf(inputSelectComp.data.InputA), null,
    'unauthorized input sends a null character');
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', inputSelect,
    C.Expr_Select.NAME, 'bSelectB', 'authorization selects the real sitting character');
  assertEdge(t, seat, C.Seat.NAME, 'SittingCharacter', inputSelect,
    C.Expr_Select.NAME, 'InputB', 'authorized input receives the sitting character');
  const coreInput = targetOf(t, inputSelect, C.Expr_Select.NAME, 'Output',
    'authorized character terminal core input').brick;
  assert(component(coreInput, C.MicrochipInput.NAME),
    'authorized character feeds the existing input microchip');

  const previewGuard = t.label('Send preview only after live appearance sync');
  assert(component(previewGuard, C.Exec_Branch.NAME));
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', previewGuard,
    C.Exec_Branch.NAME, 'bCond', 'live preview requires full authorization');

  const blinkClock = t.label('Selection blink clock');
  const blinkDetector = t.label('Session start/exit detector');
  const blinkVisible = t.label('Active visible blink');
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkClock,
    C.Clock.NAME, 'bEnabled', 'blink clock runs only while authorized');
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkDetector,
    C.Expr_EdgeDetectorExec.NAME, 'Input', 'blink start/stop follows authorization');
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', blinkVisible,
    C.Expr_LogicalAND.NAME, 'bInputA', 'visible selector requires authorization');

  const wrong = t.label('Wrong player in seat');
  assert(component(wrong, C.Expr_LogicalAND.NAME), 'wrong-player state is explicit');
  assert(dataDependsOn(scene, wrong, owner.ownerReady),
    'unknown owner remains black rather than red');
  const notOwner = t.one(t.all(C.Expr_LogicalNOT.NAME).filter(({ brick }) =>
    t.incoming(brick, C.Expr_LogicalNOT.NAME, 'bInput').some(edge =>
      edge.a === ownerMatch.key && edge.p === 'bOutput')), 'not owner match').brick;
  assert(dataDependsOn(scene, wrong, notOwner), 'red state requires a confirmed mismatch');
  assert(dataDependsOn(scene, wrong, seat), 'red state requires someone in the seat');

  const revalidate = t.label('Retry seated owner after sync completes');
  const startMerge = t.label('Seat entry or completed owner sync');
  assertEdge(t, owner.busyOff, C.Exec_Var_Set.NAME, 'ExecOut', revalidate,
    C.Exec_Branch.NAME, 'Exec', 'sync unlock also revalidates a seated player');
  assertEdge(t, seat, C.Seat.NAME, 'bIsOccupied', revalidate,
    C.Exec_Branch.NAME, 'bCond', 'post-sync revalidation runs only while occupied');
  assertEdge(t, revalidate, C.Exec_Branch.NAME, 'ExecOutA', startMerge,
    C.Exec_Union.NAME, 'ExecB', 'occupied post-sync path rejoins normal seat startup');
  const postSyncStart = targetOf(t, startMerge, C.Exec_Union.NAME, 'ExecOut',
    'post-sync seat-start reset').brick;
  const postSyncSetter = component(postSyncStart, C.Exec_Var_Set.NAME);
  assert(postSyncSetter, 'post-sync revalidation begins with the normal session reset');
  assert.equal(valueOf(postSyncSetter.data.Value), false,
    'post-sync revalidation first clears session-ready');
  assertEdge(t, sessionReady, C.Var.NAME, 'VarRef', postSyncStart,
    C.Exec_Var_Set.NAME, 'VarRef', 'post-sync revalidation resets the same session Var');
  assert(execReachableFromPort(scene, startMerge, 'ExecOut', startup),
    'post-sync revalidation reaches the owner-gated startup branch');

  return { seat, seatedPlayer, ownerMatch, authorized, startup, inputSelect,
    coreInput, previewGuard, blinkClock, blinkDetector, blinkVisible, wrong,
    sessionReady, revalidate, startMerge, postSyncStart };
}

function indicatorAndScreenContract(scene, lock, auth) {
  const { t } = lock;
  const offOrWrong = t.label('Indicator off or wrong');
  const inner = component(offOrWrong, C.Expr_Select.NAME);
  assert(inner, 'black/red state uses a color Select');
  assert.deepEqual(valueOf(inner.data.InputA), { R: 0, G: 0, B: 0, A: 1 },
    'indicator is black while off, syncing, or owner-unknown');
  assert.deepEqual(valueOf(inner.data.InputB), { R: 1, G: 0, B: 0, A: 1 },
    'indicator is red only for a confirmed wrong player');
  assertEdge(t, auth.wrong, C.Expr_LogicalAND.NAME, 'bOutput', offOrWrong,
    C.Expr_Select.NAME, 'bSelectB', 'wrong-player state selects red');

  const indicator = t.one(t.all(C.TextDisplay.NAME).filter(({ brick }) =>
    t.incoming(brick, C.TextDisplay.NAME, 'Color').length === 1),
  'physical on/off indicator').brick;
  const outer = sourceOf(t, indicator, C.TextDisplay.NAME, 'Color',
    'indicator color selector').brick;
  const outerComp = component(outer, C.Expr_Select.NAME);
  assert(outerComp, 'indicator has a final authorized color Select');
  assertEdge(t, offOrWrong, C.Expr_Select.NAME, 'Output', outer,
    C.Expr_Select.NAME, 'InputA', 'non-running indicator uses black/red result');
  assert.deepEqual(valueOf(outerComp.data.InputB), { R: 0, G: 1, B: 0, A: 1 },
    'authorized terminal indicator is green');
  assertEdge(t, auth.authorized, C.Expr_LogicalAND.NAME, 'bOutput', outer,
    C.Expr_Select.NAME, 'bSelectB', 'authorization selects green');

  const screenRerouter = t.one(t.all(C.Rerouter.NAME).filter(({ brick }) =>
    t.outgoing(brick, C.Rerouter.NAME, 'RER_Output').filter(edge =>
      edge.zt === C.TextDisplay.NAME && edge.q === 'bEnabled').length === 2),
  'shared screen enable rerouter').brick;
  assertEdge(t, auth.authorized, C.Expr_LogicalAND.NAME, 'bOutput', screenRerouter,
    C.Rerouter.NAME, 'RER_Input', 'wrong player sees no active terminal screens');
  return { offOrWrong, indicator, outer, screenRerouter };
}

function purchaseContract(scene, lock, owner, auth) {
  const { t } = lock;
  const preReadMatch = t.label('Purchase seated owner matches active vehicle');
  assert(component(preReadMatch, C.Expr_CompareEqual.NAME),
    'purchase checks the live seated PlayerState before leaderboard reads');
  assert(dataDependsOn(scene, preReadMatch, owner.activeOwner),
    'pre-read purchase check reads the active owner');
  const preReadPlayer = ['InputA', 'InputB'].map(port => sourceOf(t, preReadMatch,
    C.Expr_CompareEqual.NAME, port, `pre-read owner match ${port}`).brick)
    .find(brick => brick.key !== owner.activeOwner.key);
  assert(preReadPlayer && component(preReadPlayer, C.Exec_PlayerState_GetFromEntity.NAME),
    'pre-read purchase check uses a fresh PlayerState from the sitting character');

  const preReadGuard = t.label('Authorize owner before purchase reads');
  assert(component(preReadGuard, C.Exec_Branch.NAME),
    'purchase has an owner branch before any leaderboard read');
  assertEdge(t, preReadMatch, C.Expr_CompareEqual.NAME, 'bOutput', preReadGuard,
    C.Exec_Branch.NAME, 'bCond', 'fresh seated owner gates purchase reads');
  assertEdge(t, preReadPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', preReadGuard,
    C.Exec_Branch.NAME, 'Exec', 'fresh seated PlayerState completes before owner branch');

  const purchaseScrap = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Scrap').filter(({ brick }) =>
    t.incoming(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState')
      .some(edge => edge.a === preReadPlayer.key)), 'purchase Scrap getter').brick;
  assert(execReachableFromPort(scene, preReadGuard, 'ExecOutA', purchaseScrap),
    'authorized owner reaches purchase Scrap read');
  assert(!execReachableFromPort(scene, preReadGuard, 'ExecOutB', purchaseScrap),
    'wrong owner cannot reach purchase leaderboard reads');

  const freshMatch = t.label('Fresh seated owner matches active vehicle');
  assert(component(freshMatch, C.Expr_CompareEqual.NAME),
    'purchase performs another fresh owner equality check at mutation time');
  assert(dataDependsOn(scene, freshMatch, owner.activeOwner),
    'final purchase check reads the active owner');
  const finalPlayer = ['InputA', 'InputB'].map(port => sourceOf(t, freshMatch,
    C.Expr_CompareEqual.NAME, port, `final owner match ${port}`).brick)
    .find(brick => brick.key !== owner.activeOwner.key);
  assert(finalPlayer && component(finalPlayer, C.Exec_PlayerState_GetFromEntity.NAME),
    'final purchase check uses a newly-read PlayerState, not retained session data');
  assert.notEqual(finalPlayer.key, preReadPlayer.key,
    'mutation-time owner check performs a second fresh seat lookup');

  const samePlayer = t.label('Purchase player remained in the seat');
  assert(component(samePlayer, C.Expr_CompareEqual.NAME),
    'final mutation compares the fresh seated player with the purchase starter');
  assertEdge(t, finalPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    samePlayer, C.Expr_CompareEqual.NAME, 'InputA',
    'final seated PlayerState is compared at mutation time');
  assertEdge(t, preReadPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    samePlayer, C.Expr_CompareEqual.NAME, 'InputB',
    'mutation check compares against the original purchase PlayerState');

  const purchaseNonce = t.label('Purchase active-session nonce');
  const snapshotNonce = t.label('Snapshot active session before purchase reads');
  const appearanceNonce = t.label('Appearance request nonce');
  const sameNonce = t.label('Purchase active vehicle session is unchanged');
  assert(component(purchaseNonce, C.Var.NAME));
  assert(component(snapshotNonce, C.Exec_Var_Set.NAME));
  assert(component(sameNonce, C.Expr_CompareEqual.NAME));
  assertEdge(t, purchaseNonce, C.Var.NAME, 'VarRef', snapshotNonce,
    C.Exec_Var_Set.NAME, 'VarRef', 'purchase snapshots into a retained nonce');
  assertEdge(t, appearanceNonce, C.Var.NAME, 'Value', snapshotNonce,
    C.Exec_Var_Set.NAME, 'Value', 'purchase snapshots the active appearance/session nonce');
  assert(execReachableFromPort(scene, preReadGuard, 'ExecOutA', snapshotNonce),
    'nonce snapshot occurs only after pre-read owner authorization');
  assert(execReachableFromPort(scene, snapshotNonce, 'ExecOut', purchaseScrap),
    'nonce snapshot occurs before purchase leaderboard reads');
  assertEdge(t, appearanceNonce, C.Var.NAME, 'Value', sameNonce,
    C.Expr_CompareEqual.NAME, 'InputA', 'final mutation reads the current session nonce');
  assertEdge(t, purchaseNonce, C.Var.NAME, 'Value', sameNonce,
    C.Expr_CompareEqual.NAME, 'InputB', 'final mutation reads the snapshotted session nonce');

  const buyGuard = t.label('Final authorized owner BUY guard');
  assert(component(buyGuard, C.Exec_Branch.NAME), 'purchase has a final owner branch');
  assert(dataDependsOn(scene, buyGuard, freshMatch, 'bCond'));
  assert(dataDependsOn(scene, buyGuard, auth.authorized, 'bCond'));
  assert(dataDependsOn(scene, buyGuard, samePlayer, 'bCond'),
    'final mutation requires the same player who started the purchase');
  assert(dataDependsOn(scene, buyGuard, sameNonce, 'bCond'),
    'final mutation requires the same active vehicle appearance/session nonce');
  assertEdge(t, finalPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', buyGuard,
    C.Exec_Branch.NAME, 'Exec', 'second fresh PlayerState completes before mutation guard');

  const colorWrite = t.one(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    data => data.Key === ''), 'saved color write').brick;
  const materialWrite = t.one(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'saved material write').brick;
  const finalMutation = sourceOf(t, colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec', 'irreversible mutation branch').brick;
  assert.equal(finalMutation.key, buyGuard.key,
    'final authorized owner guard directly controls the irreversible color write');

  const colorBaseline = t.label('Update CURRENT COLOR after successful purchase');
  const materialBaseline = t.label('Update saved material baseline after successful purchase');
  const debit = t.one(t.all(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap'), 'Scrap debit').brick;
  assertEdge(t, colorWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec',
    'transaction writes color before material');
  assertEdge(t, materialWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    colorBaseline, C.Exec_Var_Set.NAME, 'Exec', 'material write precedes color baseline');
  assertEdge(t, colorBaseline, C.Exec_Var_Set.NAME, 'ExecOut', materialBaseline,
    C.Exec_Var_Set.NAME, 'Exec', 'color baseline precedes material baseline');
  assertEdge(t, materialBaseline, C.Exec_Var_Set.NAME, 'ExecOut', debit,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec',
    'both saved baselines update before the Scrap debit');
  return { preReadMatch, preReadPlayer, preReadGuard, purchaseScrap, freshMatch,
    finalPlayer, samePlayer, purchaseNonce, snapshotNonce, appearanceNonce, sameNonce,
    buyGuard, colorWrite, materialWrite, finalMutation, colorBaseline, materialBaseline,
    debit };
}

function test({
  previous = DEFAULT_V18,
  terminalOutput = DEFAULT_V19,
  truckOutput = DEFAULT_TRUCK_V9,
  builder = DEFAULT_BUILDER,
} = {}) {
  testTruckV9({ output: truckOutput });
  const previousBytes = fs.readFileSync(previous);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const previousScene = read(previousBytes);
  const terminal = read(terminalBytes);
  assert(validate(terminalBytes).strictOk, 'v19 terminal passes strict placement');
  assert(terminal.bricks.length > previousScene.bricks.length,
    'v19 adds explicit lock and authorization gates');
  assert(terminal.edges.length > previousScene.edges.length,
    'v19 adds explicit lock and authorization wiring');

  const lock = vehicleLockContract(terminal);
  const owner = ownerReplyContract(terminal, lock);
  const auth = authorizationContract(terminal, lock, owner);
  const indicator = indicatorAndScreenContract(terminal, lock, auth);
  const purchase = purchaseContract(terminal, lock, owner, auth);
  const sections = sectionLayoutContract(terminal, lock.entry.g);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v19 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), terminalBytes,
    'checked v19 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    vehicleLock: 'first vehicle stays active; ignored vehicles cannot mutate session',
    authorization: 'live vehicle owner must match retained seated PlayerState',
    indicator: 'black off/unknown; green authorized; red confirmed wrong player',
    wrongPlayer: 'no screen, controls, preview, leaderboard read, write, or debit',
    transaction: 'owner guard -> color -> material -> baselines -> Scrap debit',
    inheritedTruckV9Regressions: 'passed',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, result, lock, owner, auth, indicator, purchase, sections };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V18,
  terminalOutput: process.argv[3] || DEFAULT_V19,
  truckOutput: process.argv[4] || DEFAULT_TRUCK_V9,
  builder: process.argv[5] || DEFAULT_BUILDER,
});

module.exports = test;
