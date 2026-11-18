'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v19.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v20.brz'));

const clone = structuredClone;
const B = value => ({ $variant: 'Bool', value });
const O = value => ({ $variant: 'weak_object', value });
const S = value => ({ $variant: 'str', value });

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

function graph(scene) {
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
    assert.equal(items.length, 1, `${label}: expected one, got ${items.length}`);
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
    const old = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return old;
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
  const gate = (kind, grid, data, name, color, hover = name) => {
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
      key: `v20:${grid}:${name}:${sequence++}`,
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
  const g = graph(scene);

  const entered = g.row(C.EntityZoneEvent_Entered.NAME,
    data => data.TagFilter === 'Vehicle', 'vehicle entered').brick;
  const terminalGrid = entered.g;
  const vehicleArray = g.row(C.ArrayVar.NAME,
    data => data.Value?.$elementType === 'weak_object', 'active vehicle array').brick;
  const entryGet = g.label('Read active vehicle before accepting zone entry');
  const entryGuard = g.label('First vehicle lock empty check');
  const clearEntry = g.label('Clear vehicle owner on entry');
  const clearEntrySession = g.label('Reset terminal session on vehicle entry');
  const clearEntryOwner = g.label('Reset active vehicle owner on entry');
  const exitGuard = g.label('Active vehicle exit check');
  const clearExit = g.label('Clear vehicle owner on exit');
  const clearExitSession = g.label('Reset terminal session on vehicle exit');
  const clearExitOwner = g.label('Reset active vehicle owner on exit');

  // A dead weak-object can leave a one-element [null] array behind when a
  // vehicle is despawned in the bay. Treat that slot exactly like an empty bay.
  const entryNull = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'entry_vehicle_null', [70, 185, 225],
    'Active vehicle slot is null');
  const entryAvailable = g.gate('Expr_LogicalOR', terminalGrid,
    { bInputA: false, bInputB: false }, 'entry_vehicle_available', [70, 185, 225],
    'Vehicle bay is empty or stale');
  const clearVehicleArray = g.gate('Exec_ArrayVar_Clear', terminalGrid,
    {}, 'clear_stale_vehicle', [70, 185, 225], 'Clear empty or stale vehicle slot');
  g.one(g.removeInput(entryGuard, C.Exec_Branch.NAME, 'bCond'),
    'old out-of-bounds-only entry lock');
  g.one(g.removeInput(clearEntry, C.Exec_Var_Set.NAME, 'Exec'),
    'old entry guard to owner reset');
  g.add(entryGet, C.Exec_ArrayVar_Get.NAME, 'Value', entryNull,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(entryGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', entryAvailable,
    C.Expr_LogicalOR.NAME, 'bInputA');
  g.add(entryNull, C.Expr_CompareEqual.NAME, 'bOutput', entryAvailable,
    C.Expr_LogicalOR.NAME, 'bInputB');
  g.add(entryAvailable, C.Expr_LogicalOR.NAME, 'bOutput', entryGuard,
    C.Exec_Branch.NAME, 'bCond');
  g.add(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', clearVehicleArray,
    C.Exec_ArrayVar_Clear.NAME, 'ArrayVarRef');
  g.add(entryGuard, C.Exec_Branch.NAME, 'ExecOutA', clearVehicleArray,
    C.Exec_ArrayVar_Clear.NAME, 'Exec');
  g.add(clearVehicleArray, C.Exec_ArrayVar_Clear.NAME, 'ExecOut', clearEntry,
    C.Exec_Var_Set.NAME, 'Exec');

  // Replace weak-object identity in the appearance protocol with the stable
  // account user ID while leaving all seated PlayerState transaction guards.
  const reply = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'appearance reply event').brick;
  const stagedOwner = g.label('Staged vehicle owner');
  const stageOwner = g.label('Snapshot reply vehicle owner');
  const activeOwner = g.label('Active vehicle owner');
  const ownerReady = g.label('Vehicle owner ready');
  const ownerPresent = g.label('Reply contains vehicle owner');
  const ownerBranch = g.label('Accept only a non-null vehicle owner');
  const commitOwner = g.label('Commit active vehicle owner');
  const commitOwnerReady = g.label('Commit vehicle owner ready');
  const asString = (brick, type, field, value = '') => {
    g.component(brick, type).data[field] = S(value);
  };
  asString(reply, C.Event_CustomGlobal.NAME, 'DataOut6');
  asString(stagedOwner, C.Var.NAME, 'Value');
  asString(stageOwner, C.Exec_Var_Set.NAME, 'Value');
  asString(activeOwner, C.Var.NAME, 'Value');
  asString(clearEntryOwner, C.Exec_Var_Set.NAME, 'Value');
  asString(clearExitOwner, C.Exec_Var_Set.NAME, 'Value');
  asString(ownerPresent, C.Expr_CompareNotEqual.NAME, 'InputA');
  asString(ownerPresent, C.Expr_CompareNotEqual.NAME, 'InputB');
  asString(commitOwner, C.Exec_Var_Set.NAME, 'Value');
  g.relabel(stagedOwner, 'Staged vehicle owner ID');
  g.relabel(stageOwner, 'Snapshot reply vehicle owner ID');
  g.relabel(activeOwner, 'Active vehicle owner ID');
  g.relabel(ownerReady, 'Vehicle owner ID ready');
  g.relabel(ownerPresent, 'Reply contains vehicle owner ID');
  g.relabel(ownerBranch, 'Accept only a non-empty vehicle owner ID');
  g.relabel(commitOwner, 'Commit active vehicle owner ID');
  g.relabel(commitOwnerReady, 'Commit vehicle owner ID ready');
  g.relabel(clearEntryOwner, 'Reset active vehicle owner ID on entry');
  g.relabel(clearExitOwner, 'Reset active vehicle owner ID on exit');

  const seat = g.row(C.Seat.NAME, () => true, 'terminal seat').brick;
  const startupGuard = g.label('Authorize seated owner before user data');
  const ownerMatch = g.label('Seated player owns active vehicle');
  const seatedSetter = g.brick(g.one(g.incoming(startupGuard,
    C.Exec_Branch.NAME, 'Exec'), 'old seated session startup').a);
  assert(g.component(seatedSetter, C.Exec_Var_Set.NAME));
  const userIdGetter = g.brick(g.one(g.outgoing(startupGuard,
    C.Exec_Branch.NAME, 'ExecOutA'), 'old gated user ID getter').z);
  assert(g.component(userIdGetter, C.Exec_PlayerState_GetUserId.NAME));
  const setUserId = g.brick(g.one(g.outgoing(userIdGetter,
    C.Exec_PlayerState_GetUserId.NAME, 'ExecOut'), 'user ID retained setter').z);
  assert(g.component(setUserId, C.Exec_Var_Set.NAME));
  g.one(g.removeInput(ownerMatch, C.Expr_CompareEqual.NAME, 'InputB'),
    'old seated PlayerState owner comparison');
  asString(ownerMatch, C.Expr_CompareEqual.NAME, 'InputA');
  asString(ownerMatch, C.Expr_CompareEqual.NAME, 'InputB');
  g.add(userIdGetter, C.Exec_PlayerState_GetUserId.NAME, 'UserId', ownerMatch,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.one(g.removeInput(userIdGetter, C.Exec_PlayerState_GetUserId.NAME, 'Exec'),
    'old post-authorization user ID execution');
  g.one(g.removeInput(startupGuard, C.Exec_Branch.NAME, 'Exec'),
    'old owner guard execution');
  g.one(g.removeInput(setUserId, C.Exec_Var_Set.NAME, 'Exec'),
    'old direct user ID retention');
  g.add(seatedSetter, C.Exec_Var_Set.NAME, 'ExecOut', userIdGetter,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec');
  g.add(userIdGetter, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', startupGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(startupGuard, C.Exec_Branch.NAME, 'ExecOutA', setUserId,
    C.Exec_Var_Set.NAME, 'Exec');
  g.relabel(ownerMatch, 'Seated user ID owns active vehicle');
  g.relabel(startupGuard, 'Authorize seated user ID before user data');

  const purchaseOwnerMatch = g.label('Purchase seated owner matches active vehicle');
  const purchaseOwnerGuard = g.label('Authorize owner before purchase reads');
  const purchaseGetPlayer = g.brick(g.one(g.incoming(purchaseOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputA'), 'purchase PlayerState identity source').a);
  assert(g.component(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME));
  const purchaseUserId = g.gate('Exec_PlayerState_GetUserId', terminalGrid,
    { UserId: '' }, 'purchase_owner_user_id', [235, 165, 65],
    'Resolve purchase player user ID');
  g.one(g.removeInput(purchaseOwnerMatch, C.Expr_CompareEqual.NAME, 'InputA'),
    'old purchase PlayerState owner comparison');
  g.one(g.removeInput(purchaseOwnerGuard, C.Exec_Branch.NAME, 'Exec'),
    'old direct purchase owner guard execution');
  asString(purchaseOwnerMatch, C.Expr_CompareEqual.NAME, 'InputA');
  asString(purchaseOwnerMatch, C.Expr_CompareEqual.NAME, 'InputB');
  g.add(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    purchaseUserId, C.Exec_PlayerState_GetUserId.NAME, 'PlayerState');
  g.add(purchaseGetPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut',
    purchaseUserId, C.Exec_PlayerState_GetUserId.NAME, 'Exec');
  g.add(purchaseUserId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', purchaseOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(purchaseUserId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', purchaseOwnerGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.relabel(purchaseOwnerMatch, 'Purchase user ID matches active vehicle owner ID');

  const freshOwnerMatch = g.label('Fresh seated owner matches active vehicle');
  const freshPlayer = g.brick(g.one(g.incoming(freshOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputA'), 'fresh PlayerState identity source').a);
  assert(g.component(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME));
  const finalMutation = g.label('Final authorized owner BUY guard');
  const freshUserId = g.gate('Exec_PlayerState_GetUserId', terminalGrid,
    { UserId: '' }, 'fresh_owner_user_id', [235, 165, 65],
    'Resolve final seated user ID');
  g.one(g.removeInput(freshOwnerMatch, C.Expr_CompareEqual.NAME, 'InputA'),
    'old fresh PlayerState owner comparison');
  g.one(g.removeInput(finalMutation, C.Exec_Branch.NAME, 'Exec'),
    'old direct final owner guard execution');
  asString(freshOwnerMatch, C.Expr_CompareEqual.NAME, 'InputA');
  asString(freshOwnerMatch, C.Expr_CompareEqual.NAME, 'InputB');
  g.add(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState',
    freshUserId, C.Exec_PlayerState_GetUserId.NAME, 'PlayerState');
  g.add(freshPlayer, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', freshUserId,
    C.Exec_PlayerState_GetUserId.NAME, 'Exec');
  g.add(freshUserId, C.Exec_PlayerState_GetUserId.NAME, 'UserId', freshOwnerMatch,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(freshUserId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', finalMutation,
    C.Exec_Branch.NAME, 'Exec');
  g.relabel(freshOwnerMatch, 'Final seated user ID matches active vehicle owner ID');

  const requestMerge = g.label('Vehicle entry, seated retry, or null-owner retry');
  const nullOwnerDelay = g.label('Retry request after a null owner reply');
  const requestDispatch = g.label('Normal owner request or post-sync recovery request');
  const retryAfterSync = g.label('Retry owner request after synchronization unlocks');
  const ownerConfirmed = g.label('Confirmed active owner matches seated player');
  const occupiedSupported = g.label('Occupied seat and supported active vehicle');
  const appearanceIdle = g.label('Appearance ready and synchronization idle');
  const ownerAndVehicle = g.label('Confirmed owner and active vehicle');
  const startupEligible = g.label('Seated owner startup eligible');
  const authorized = g.label('Terminal authorized');
  const sessionStartMerge = g.label('Seat entry or completed owner sync');
  const revalidateOccupied = g.label('Retry seated owner after sync completes');
  const authorizedCharacter = g.label('Authorized character input');
  const notOwnerMatch = g.label('Seated player is not the active owner');
  const wrongConfirmed = g.label('Confirmed owner differs from seated player');
  const wrongOccupied = g.label('Wrong-player check has seat and vehicle');
  const wrongAppearance = g.label('Wrong-player check is synchronized');
  const wrongLeft = g.label('Confirmed mismatch in occupied vehicle bay');
  const wrongPlayer = g.label('Wrong player in seat');
  const purchaseNonce = g.label('Purchase active-session nonce');
  const snapshotPurchaseNonce = g.label('Snapshot active session before purchase reads');
  const samePurchasePlayer = g.label('Purchase player remained in the seat');
  const samePurchaseNonce = g.label('Purchase active vehicle session is unchanged');
  const finalOwnerIdentity = g.label('Fresh owner and purchase player both match');
  const finalSessionIdentity = g.label('Final purchase identity and session match');

  rowAt([entryGet, entryNull, entryAvailable, entryGuard, clearVehicleArray,
    clearEntry, clearEntrySession, clearEntryOwner,
    exitGuard, clearExit, clearExitSession, clearExitOwner], 320, -145);
  rowAt([stagedOwner, stageOwner, activeOwner, ownerReady, ownerPresent,
    ownerBranch, commitOwner, commitOwnerReady], 320, -165);
  rowAt([requestMerge, nullOwnerDelay, requestDispatch, retryAfterSync,
    ownerMatch, ownerConfirmed, occupiedSupported, appearanceIdle,
    ownerAndVehicle, startupEligible, authorized], 320, -185);
  rowAt([startupGuard, sessionStartMerge, revalidateOccupied,
    authorizedCharacter, notOwnerMatch, wrongConfirmed, wrongOccupied,
    wrongAppearance, wrongLeft, wrongPlayer], 320, -205);
  rowAt([purchaseUserId, purchaseOwnerMatch, purchaseOwnerGuard, purchaseNonce,
    snapshotPurchaseNonce, freshPlayer, freshUserId, freshOwnerMatch,
    samePurchasePlayer, samePurchaseNonce, finalOwnerIdentity,
    finalSessionIdentity], 320, -225);

  const headers = g.all(C.TextDisplay.NAME, data => [
    'VEHICLE BAY\r\nLOCK', 'OWNER\r\nREPLY', 'OWNER\r\nAUTHORIZATION',
    'PURCHASE OWNER\r\nGUARDS',
  ].includes(data.Text));
  for (const { comp } of headers) {
    if (comp.data.Text === 'OWNER\r\nREPLY') comp.data.Text = 'OWNER ID\r\nREPLY';
    if (comp.data.Text === 'OWNER\r\nAUTHORIZATION') comp.data.Text = 'OWNER ID\r\nAUTHORIZATION';
    if (comp.data.Text === 'PURCHASE OWNER\r\nGUARDS') {
      comp.data.Text = 'PURCHASE OWNER ID\r\nGUARDS';
    }
  }
  fit(scene, terminalGrid);

  const metadata = {
    name: 'Scrap Runners - Color Terminal v20 Stable Owner ID',
    description: 'Uses stable user IDs for vehicle-owner authorization and recovers an empty bay from stale or destroyed vehicle references while preserving the first-vehicle lock.',
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
    vehicleLock: 'first live vehicle stays active; null/dead slot self-heals',
    ownerGate: 'stable vehicle owner user ID must match seated user ID',
    indicator: 'black off/unknown, green authorized, red wrong player',
    truck: 'pair with Truck1 v11',
  }, null, 2));
}
