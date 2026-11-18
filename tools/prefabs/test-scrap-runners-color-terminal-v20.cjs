'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV19 = require('./test-scrap-runners-color-terminal-v19.cjs');
const testTruckV11 = require('./test-scrap-runners-truck1-color-enabled-v11.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const DEFAULT_V19 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v19.brz');
const DEFAULT_V20 = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v20.brz');
const DEFAULT_TRUCK_V11 = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v11.brz');
const DEFAULT_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v20.cjs');

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
  return { scene, bricks, all, one, incoming, outgoing, label,
    source: edge => bricks.get(edge.a), target: edge => bricks.get(edge.z) };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
}

const EXEC_PORTS = new Set(['ExecOut', 'ExecOutA', 'ExecOutB', 'Output',
  'OnRisingEdge', 'OnFallingEdge', 'bPulseOnChange']);

function execReachable(scene, start, startPort, goal) {
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
  const queue = scene.edges.filter(edge => edge.z === target.key
    && (!targetPort || edge.q === targetPort)).map(edge => edge.a);
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

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}

function assertStringField(brick, type, field, label) {
  const value = component(brick, type).data[field];
  assert.equal(value.$variant, 'str', `${label} is a string`);
  assert.equal(value.value, '', `${label} starts empty`);
}

function staleBayContract(scene) {
  const t = api(scene);
  const vehicleArray = t.one(t.all(C.ArrayVar.NAME,
    data => data.Value?.$elementType === 'weak_object'), 'vehicle array').brick;
  const entryGet = t.label('Read active vehicle before accepting zone entry');
  const entryNull = t.label('Active vehicle slot is null');
  const entryAvailable = t.label('Vehicle bay is empty or stale');
  const entryGuard = t.label('First vehicle lock empty check');
  const clearArray = t.label('Clear empty or stale vehicle slot');
  const clearOwner = t.label('Clear vehicle owner on entry');
  const insert = t.one(t.all(C.Exec_ArrayVar_Insert.NAME), 'active vehicle insert').brick;

  assertEdge(t, vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', entryGet,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef', 'entry reads active vehicle array');
  assertEdge(t, entryGet, C.Exec_ArrayVar_Get.NAME, 'Value', entryNull,
    C.Expr_CompareEqual.NAME, 'InputA', 'entry checks dead/null active vehicle');
  assertEdge(t, entryGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', entryAvailable,
    C.Expr_LogicalOR.NAME, 'bInputA', 'empty array enters availability OR');
  assertEdge(t, entryNull, C.Expr_CompareEqual.NAME, 'bOutput', entryAvailable,
    C.Expr_LogicalOR.NAME, 'bInputB', 'dead slot enters availability OR');
  assertEdge(t, entryAvailable, C.Expr_LogicalOR.NAME, 'bOutput', entryGuard,
    C.Exec_Branch.NAME, 'bCond', 'empty-or-stale result controls entry lock');
  assert(!t.scene.edges.some(edge => edge.a === entryGet.key
    && edge.p === 'bOutOfBounds' && edge.z === entryGuard.key),
  'out-of-bounds no longer bypasses the stale-slot test');
  assertEdge(t, vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', clearArray,
    C.Exec_ArrayVar_Clear.NAME, 'ArrayVarRef', 'stale recovery clears exact active array');
  assertEdge(t, entryGuard, C.Exec_Branch.NAME, 'ExecOutA', clearArray,
    C.Exec_ArrayVar_Clear.NAME, 'Exec', 'only accepted entry clears stale state');
  assertEdge(t, clearArray, C.Exec_ArrayVar_Clear.NAME, 'ExecOut', clearOwner,
    C.Exec_Var_Set.NAME, 'Exec', 'clear finishes before normal entry reset');
  assert(execReachable(scene, clearArray, 'ExecOut', insert),
    'new vehicle inserts only after stale state is cleared');
  assert.equal(t.outgoing(entryGuard, C.Exec_Branch.NAME, 'ExecOutB').length, 0,
    'valid active vehicle still rejects later entrants with a complete no-op');

  const accepts = (outOfBounds, slotIsNull) => outOfBounds || slotIsNull;
  assert.equal(accepts(true, true), true);
  assert.equal(accepts(true, false), true);
  assert.equal(accepts(false, true), true);
  assert.equal(accepts(false, false), false);
  return { t, vehicleArray, entryGet, entryNull, entryAvailable, entryGuard,
    clearArray, clearOwner, insert };
}

function ownerIdReplyContract(scene, truck) {
  const t = api(scene);
  const reply = t.one(t.all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply receiver').brick;
  const stagedOwner = t.label('Staged vehicle owner ID');
  const stageOwner = t.label('Snapshot reply vehicle owner ID');
  const activeOwner = t.label('Active vehicle owner ID');
  const ownerReady = t.label('Vehicle owner ID ready');
  const ownerPresent = t.label('Reply contains vehicle owner ID');
  const ownerBranch = t.label('Accept only a non-empty vehicle owner ID');
  const commitOwner = t.label('Commit active vehicle owner ID');
  const commitOwnerReady = t.label('Commit vehicle owner ID ready');
  assertStringField(reply, C.Event_CustomGlobal.NAME, 'DataOut6', 'reply Data6');
  assertStringField(stagedOwner, C.Var.NAME, 'Value', 'staged owner ID');
  assertStringField(stageOwner, C.Exec_Var_Set.NAME, 'Value', 'stage owner setter');
  assertStringField(activeOwner, C.Var.NAME, 'Value', 'active owner ID');
  assertStringField(ownerPresent, C.Expr_CompareNotEqual.NAME, 'InputA',
    'owner-present input A');
  assertStringField(ownerPresent, C.Expr_CompareNotEqual.NAME, 'InputB',
    'owner-present empty sentinel');
  assertStringField(commitOwner, C.Exec_Var_Set.NAME, 'Value', 'owner commit setter');
  assertEdge(t, reply, C.Event_CustomGlobal.NAME, 'DataOut6', stageOwner,
    C.Exec_Var_Set.NAME, 'Value', 'reply snapshots stable owner ID');
  assertEdge(t, stagedOwner, C.Var.NAME, 'Value', ownerPresent,
    C.Expr_CompareNotEqual.NAME, 'InputA', 'non-empty owner ID is required');
  assertEdge(t, stagedOwner, C.Var.NAME, 'Value', commitOwner,
    C.Exec_Var_Set.NAME, 'Value', 'accepted owner ID is committed');
  assertEdge(t, activeOwner, C.Var.NAME, 'VarRef', commitOwner,
    C.Exec_Var_Set.NAME, 'VarRef', 'owner ID uses retained active variable');
  assertEdge(t, ownerPresent, C.Expr_CompareNotEqual.NAME, 'bOutput', ownerBranch,
    C.Exec_Branch.NAME, 'bCond', 'empty owner ID cannot authorize');

  const truckApi = api(truck);
  const send = truckApi.one(truckApi.all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'truck appearance reply').brick;
  const sendComp = component(send, C.Exec_SendCustomEventGlobal.NAME);
  assert.equal(sendComp.data.DataIn6.$variant, 'str',
    'truck and terminal agree that owner identity is a string');
  const ownerIdOutput = truckApi.one(truckApi.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'truck owner ID output').brick;
  assertEdge(truckApi, ownerIdOutput, C.MicrochipOutput.NAME, 'RER_Output', send,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6', 'truck sends stable owner ID');
  return { t, reply, stagedOwner, stageOwner, activeOwner, ownerReady,
    ownerPresent, ownerBranch, commitOwner, commitOwnerReady };
}

function authorizationContract(scene, owner) {
  const t = owner.t;
  const ownerMatch = t.label('Seated user ID owns active vehicle');
  const startupGuard = t.label('Authorize seated user ID before user data');
  const userIdGetter = t.source(t.one(t.incoming(ownerMatch,
    C.Expr_CompareEqual.NAME, 'InputB'), 'seated user ID comparison source'));
  assert(component(userIdGetter, C.Exec_PlayerState_GetUserId.NAME));
  const seatedSetter = t.source(t.one(t.incoming(userIdGetter,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec'), 'seated PlayerState completion'));
  assert(component(seatedSetter, C.Exec_Var_Set.NAME));
  const setUserId = t.target(t.one(t.outgoing(startupGuard,
    C.Exec_Branch.NAME, 'ExecOutA'), 'authorized user ID retention'));
  assert(component(setUserId, C.Exec_Var_Set.NAME));
  assertStringField(ownerMatch, C.Expr_CompareEqual.NAME, 'InputA',
    'owner ID comparison A');
  assertStringField(ownerMatch, C.Expr_CompareEqual.NAME, 'InputB',
    'owner ID comparison B');
  assertEdge(t, owner.activeOwner, C.Var.NAME, 'Value', ownerMatch,
    C.Expr_CompareEqual.NAME, 'InputA', 'vehicle owner ID enters startup comparison');
  assertEdge(t, seatedSetter, C.Exec_Var_Set.NAME, 'ExecOut', userIdGetter,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec', 'seated PlayerState resolves user ID first');
  assertEdge(t, userIdGetter, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', startupGuard,
    C.Exec_Branch.NAME, 'Exec', 'owner guard waits for user ID');
  assertEdge(t, startupGuard, C.Exec_Branch.NAME, 'ExecOutA', setUserId,
    C.Exec_Var_Set.NAME, 'Exec', 'only authorized ID continues into user data');

  const purchaseId = t.label('Resolve purchase player user ID');
  const purchaseMatch = t.label('Purchase user ID matches active vehicle owner ID');
  const purchaseGuard = t.label('Authorize owner before purchase reads');
  const purchasePlayer = t.source(t.one(t.incoming(purchaseId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec'), 'purchase PlayerState completion'));
  assert(component(purchasePlayer, C.Exec_PlayerState_GetFromEntity.NAME));
  assertEdge(t, purchaseId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', purchaseMatch,
    C.Expr_CompareEqual.NAME, 'InputA', 'purchase compares current user ID');
  assertEdge(t, owner.activeOwner, C.Var.NAME, 'Value', purchaseMatch,
    C.Expr_CompareEqual.NAME, 'InputB', 'purchase compares active owner ID');
  assertEdge(t, purchaseId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', purchaseGuard,
    C.Exec_Branch.NAME, 'Exec', 'purchase guard waits for current user ID');

  const freshId = t.label('Resolve final seated user ID');
  const freshMatch = t.label('Final seated user ID matches active vehicle owner ID');
  const finalGuard = t.label('Final authorized owner BUY guard');
  const freshPlayer = t.source(t.one(t.incoming(freshId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec'), 'fresh PlayerState completion'));
  assert(component(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME));
  assertEdge(t, freshId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', freshMatch,
    C.Expr_CompareEqual.NAME, 'InputA', 'final guard compares fresh user ID');
  assertEdge(t, owner.activeOwner, C.Var.NAME, 'Value', freshMatch,
    C.Expr_CompareEqual.NAME, 'InputB', 'final guard compares active owner ID');
  assertEdge(t, freshId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', finalGuard,
    C.Exec_Branch.NAME, 'Exec', 'final mutation waits for fresh user ID');

  const samePlayer = t.label('Purchase player remained in the seat');
  assert.equal(component(samePlayer, C.Expr_CompareEqual.NAME).data.InputA.$variant,
    'weak_object', 'transaction continuity still compares retained PlayerStates');
  const sameNonce = t.label('Purchase active vehicle session is unchanged');
  assert(dataDependsOn(scene, finalGuard, samePlayer, 'bCond'),
    'final mutation still requires the same seated PlayerState');
  assert(dataDependsOn(scene, finalGuard, sameNonce, 'bCond'),
    'final mutation still requires the same vehicle/session nonce');

  const authorized = t.label('Terminal authorized');
  const wrongPlayer = t.label('Wrong player in seat');
  const screenEnable = t.one(t.all(C.Rerouter.NAME, (_data, brick) =>
    t.outgoing(brick, C.Rerouter.NAME, 'RER_Output')
      .filter(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'bEnabled').length === 2),
  'shared screen enable').brick;
  assertEdge(t, authorized, C.Expr_LogicalAND.NAME, 'bOutput', screenEnable,
    C.Rerouter.NAME, 'RER_Input', 'screens remain authorization-only');
  assert(dataDependsOn(scene, wrongPlayer, ownerMatch),
    'red wrong-player state is driven by the stable owner-ID mismatch');
  return { ownerMatch, startupGuard, userIdGetter, seatedSetter, setUserId,
    purchaseId, purchaseMatch, purchaseGuard, purchasePlayer,
    freshId, freshMatch, finalGuard, freshPlayer, samePlayer, sameNonce,
    authorized, wrongPlayer, screenEnable };
}

function layoutContract(scene, terminalGrid) {
  const t = api(scene);
  const sections = [
    {
      text: 'VEHICLE BAY\r\nLOCK', y: -145,
      labels: ['Read active vehicle before accepting zone entry',
        'Active vehicle slot is null', 'Vehicle bay is empty or stale',
        'First vehicle lock empty check', 'Clear empty or stale vehicle slot',
        'Clear vehicle owner on entry', 'Reset terminal session on vehicle entry',
        'Reset active vehicle owner ID on entry', 'Active vehicle exit check',
        'Clear vehicle owner on exit', 'Reset terminal session on vehicle exit',
        'Reset active vehicle owner ID on exit'],
    },
    {
      text: 'OWNER ID\r\nREPLY', y: -165,
      labels: ['Staged vehicle owner ID', 'Snapshot reply vehicle owner ID',
        'Active vehicle owner ID', 'Vehicle owner ID ready',
        'Reply contains vehicle owner ID', 'Accept only a non-empty vehicle owner ID',
        'Commit active vehicle owner ID', 'Commit vehicle owner ID ready'],
    },
    {
      text: 'PURCHASE OWNER ID\r\nGUARDS', y: -225,
      labels: ['Resolve purchase player user ID',
        'Purchase user ID matches active vehicle owner ID',
        'Authorize owner before purchase reads', 'Purchase active-session nonce',
        'Snapshot active session before purchase reads',
        'Refresh seated player before purchase write', 'Resolve final seated user ID',
        'Final seated user ID matches active vehicle owner ID',
        'Purchase player remained in the seat',
        'Purchase active vehicle session is unchanged',
        'Fresh owner and purchase player both match',
        'Final purchase identity and session match'],
    },
  ];
  for (const section of sections) {
    const header = t.one(t.all(C.TextDisplay.NAME,
      data => data.Text === section.text), `${section.text} header`).brick;
    assert.equal(header.g, terminalGrid);
    const row = section.labels.map(text => t.label(text));
    assert(row.every(brick => brick.g === terminalGrid
      && brick.data.position[1] === section.y && brick.data.position[2] === 2),
    `${section.text} stays aligned on the terminal grid`);
    assert.equal(row[0].data.position[0] - halfSize(row[0])[0], 320,
      `${section.text} starts at fixed row edge`);
    for (let index = 1; index < row.length; index++) {
      assert.equal(row[index].data.position[0] - row[index - 1].data.position[0],
        halfSize(row[index])[0] + halfSize(row[index - 1])[0],
        `${section.text} gate ${index + 1} touches prior gate`);
    }
  }
  return sections;
}

function test({
  previous = DEFAULT_V19,
  terminalOutput = DEFAULT_V20,
  truckOutput = DEFAULT_TRUCK_V11,
  builder = DEFAULT_BUILDER,
} = {}) {
  testV19();
  testTruckV11({ output: truckOutput });
  const previousBytes = fs.readFileSync(previous);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const v19 = read(previousBytes);
  const v20 = read(terminalBytes);
  const truck = read(truckBytes);
  assert(validate(terminalBytes).strictOk, 'v20 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'paired Truck1 v11 passes strict placement');
  assert.equal(v20.bricks.length, v19.bricks.length + 5,
    'v20 adds three stale-lock gates and two purchase ID gates');
  assert.equal(v20.edges.length, v19.edges.length + 9,
    'v20 net wiring delta matches stale recovery and stable-ID authorization');
  const oldKeys = new Set(v19.bricks.map(brick => brick.key));
  assert.equal(v20.bricks.filter(brick => !oldKeys.has(brick.key)).length, 5,
    'exactly five functional gates are added');
  const edgeKey = edge => JSON.stringify(edge);
  const oldEdges = new Set(v19.edges.map(edgeKey));
  const newEdges = new Set(v20.edges.map(edgeKey));
  assert.equal(v19.edges.filter(edge => !newEdges.has(edgeKey(edge))).length, 10,
    'exactly ten obsolete object/stale-lock wires are removed');
  assert.equal(v20.edges.filter(edge => !oldEdges.has(edgeKey(edge))).length, 19,
    'exactly nineteen stable-ID/stale-recovery wires are added');

  const bay = staleBayContract(v20);
  const owner = ownerIdReplyContract(v20, truck);
  const auth = authorizationContract(v20, owner);
  const sections = layoutContract(v20, bay.entryGet.g);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v20 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), terminalBytes,
    'checked v20 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: v20.bricks.length,
    terminalWires: v20.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckSha256: sha256(truckBytes),
    vehicleLock: 'first live vehicle; empty or dead/null slot self-heals',
    authorization: 'vehicle owner user ID must match seated user ID',
    wrongPlayer: 'red indicator with no screens, controls, preview, or purchase',
    transaction: 'startup, pre-read, and final-mutation ID checks plus PlayerState/nonce continuity',
    inheritedV19Regressions: 'passed on v19 baseline',
    inheritedTruckV11Regressions: 'passed',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal: v20, truck, bay, owner, auth, sections, result };
}

if (require.main === module) test({
  previous: process.argv[2] || DEFAULT_V19,
  terminalOutput: process.argv[3] || DEFAULT_V20,
  truckOutput: process.argv[4] || DEFAULT_TRUCK_V11,
  builder: process.argv[5] || DEFAULT_BUILDER,
});

module.exports = test;
