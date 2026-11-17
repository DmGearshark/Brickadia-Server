'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, S, B, O } = require('./loadboard-lib.cjs');

const TERMINAL_INPUT = path.resolve(process.argv[2]
  || '/workspace/attachments/55e12922-f96f-4d2b-96ab-e49fedd82edb/Sound added and rearranged.brz');
const TRUCK_INPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v3.brz'));
const TERMINAL_OUTPUT = path.resolve(process.argv[4]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v5.brz'));
const TRUCK_OUTPUT = path.resolve(process.argv[5]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v4.brz'));

const clone = value => structuredClone(value);
const I = value => ({ $variant: 'i64', value });
const colorValue = (R = 1, G = 1, Bv = 1, A = 1) => ({ R, G, B: Bv, A });

function ownerFrom(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  if (index < 0) return undefined;
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function isBrickHandle(value) {
  return value && typeof value === 'object'
    && Number.isInteger(value.GridPersistentIndex)
    && value.ChunkIndex && Number.isInteger(value.ChunkIndex.X)
    && Number.isInteger(value.ChunkIndex.Y) && Number.isInteger(value.ChunkIndex.Z)
    && Number.isInteger(value.BrickIndexInChunk);
}

function visitValues(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) for (const child of value) visitValues(child, callback);
  else for (const child of Object.values(value)) visitValues(child, callback);
}

// Rewriting the truck changes serialized grid/brick addresses. Resolve the
// opaque body-array BrickHandles after a first memory-only serialization.
function writeWithRemappedBrickHandles(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const sourceEntities = [...scene.r.entities()];
  const firstEntities = [...first.r.entities()];
  assert.equal(firstEntities.length, sourceEntities.length, 'Truck entity count changed');

  const gridMap = new Map([[1, 1]]);
  for (let index = 0; index < sourceEntities.length; index++)
    gridMap.set(sourceEntities[index].persistentIndex, firstEntities[index].persistentIndex);

  const targetMap = new Map();
  for (const sourceGrid of new Set(scene.bricks.map(brick => brick.g))) {
    const outputGrid = gridMap.get(sourceGrid);
    assert(outputGrid != null, `No truck grid mapping for ${sourceGrid}`);
    const sourceBricks = scene.bricks.filter(brick => brick.g === sourceGrid);
    const outputBricks = first.bricks.filter(brick => brick.g === outputGrid);
    assert.equal(outputBricks.length, sourceBricks.length, `Truck brick count changed on grid ${sourceGrid}`);
    for (let index = 0; index < sourceBricks.length; index++)
      targetMap.set(sourceBricks[index].key, outputBricks[index].key);
  }

  let remapped = 0;
  for (const brick of first.bricks) for (const savedComponent of brick.comps) visitValues(savedComponent.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const oldKey = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    const newKey = targetMap.get(oldKey);
    assert(newKey, `Stored Truck1 BrickHandle target disappeared: ${oldKey}`);
    const [grid, x, y, z, index] = JSON.parse(newKey);
    value.GridPersistentIndex = grid;
    value.ChunkIndex = { X: x, Y: y, Z: z };
    value.BrickIndexInChunk = index;
    remapped++;
  });

  const bytes = write(first, metadata).bytes;
  const final = read(bytes);
  const validTargets = new Set(final.bricks.map(brick => brick.key));
  let validated = 0;
  for (const brick of final.bricks) for (const savedComponent of brick.comps) visitValues(savedComponent.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    assert(validTargets.has(key), `Final Truck1 BrickHandle is dangling: ${key}`);
    validated++;
  });
  assert.equal(validated, remapped, 'Truck1 BrickHandle validation count changed');
  return { bytes, remappedBrickHandles: remapped };
}

function buildTerminal(input) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  const owner = ownerFrom(scene);
  let sequence = 0;

  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(savedComponent => ({ brick, savedComponent })));
  const component = (brick, type) => {
    const result = brick.comps.find(savedComponent => savedComponent.type === type);
    assert(result, `Missing ${type} on ${brick.key}`);
    return result;
  };
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(
    rows().filter(item => item.savedComponent.type === type
      && predicate(item.savedComponent.data, item.brick)), label,
  );
  const typeOf = brick => {
    const savedComponent = brick.comps.find(item => item.type.startsWith('BrickComponentType_'))
      || brick.comps.find(item => item.type.startsWith('Component_Internal_'))
      || brick.comps[0];
    assert(savedComponent, `Brick ${brick.key} has no component`);
    return savedComponent.type;
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const brickFor = key => {
    const result = scene.bricks.find(brick => brick.key === key);
    assert(result, `Missing brick ${key}`);
    return result;
  };

  const completeMenu = row(C.Expr_String_FormatText.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.FormatString), 'complete menu formatter').brick;
  const configGrid = completeMenu.g;
  const sessionHeaderEdge = one(incoming(completeMenu, C.Expr_String_FormatText.NAME, 'InputG'), 'menu session block');
  const sessionHeader = brickFor(sessionHeaderEdge.a);
  assert.equal(sessionHeaderEdge.at, C.Expr_String_FormatText.NAME, 'Menu InputG must come from the current-hex formatter');
  const previewHexEdge = one(incoming(sessionHeader, C.Expr_String_FormatText.NAME, 'InputA'), 'existing preview hex');
  const previewHex = brickFor(previewHexEdge.a);
  const coreGrid = previewHex.g;
  const priceAndBuy = row(C.Expr_String_FormatText.NAME,
    data => /^PRICE /.test(data.FormatString), 'price and BUY formatter').brick;
  const terminalGrid = row(C.EntityZoneEvent_Entered.NAME, () => true, 'vehicle zone entered').brick.g;
  const seat = row(C.Seat.NAME, () => true, 'terminal seat').brick;
  const inputSplitter = row(C.InputSplitter.NAME, () => true, 'seat input splitter').brick;
  const zoneEntered = row(C.EntityZoneEvent_Entered.NAME, (_data, brick) => brick.g === terminalGrid, 'vehicle zone entered').brick;
  const zoneLeft = row(C.EntityZoneEvent_Left.NAME, (_data, brick) => brick.g === terminalGrid, 'vehicle zone left').brick;
  const insertEdge = one(outgoing(zoneEntered, typeOf(zoneEntered), 'Exec')
    .filter(edge => edge.zt === C.Exec_ArrayVar_Insert.NAME), 'zone insert');
  const insert = brickFor(insertEdge.z);
  const removeAt = row(C.Exec_ArrayVar_RemoveAtIndex.NAME,
    (_data, brick) => brick.g === terminalGrid, 'zone array remove').brick;
  const arrayEdge = one(incoming(insert, C.Exec_ArrayVar_Insert.NAME, 'ArrayVarRef'), 'vehicle array');
  const vehicleArray = brickFor(arrayEdge.a);
  const chargeScrap = row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'purchase Scrap debit').brick;
  const purchaseScrapGet = row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Scrap', 'purchase Scrap getter').brick;
  const purchaseColorGet = row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Truck1Color', 'purchase saved-color getter').brick;
  const purchaseColorSet = row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Truck1Color', 'purchase saved-color setter').brick;
  const buyGuardEdge = one(outgoing(inputSplitter, C.InputSplitter.NAME, 'InputUp'), 'Space activation');
  assert.equal(buyGuardEdge.zt, C.Exec_Branch.NAME, 'Space must still enter the v4 BUY guard');
  const buyGuard = brickFor(buyGuardEdge.z);
  const selectedEdge = one(incoming(buyGuard, C.Exec_Branch.NAME, 'bCond'), 'v4 BUY selection condition');
  const buySelected = brickFor(selectedEdge.a);
  const failedSoundNote = row(C.Interact.NAME,
    data => data.Message === 'Wire Failed Buy into This sound effect', 'failed-buy sound annotation');
  failedSoundNote.savedComponent.data.bAllowNearbyInteraction = false;
  failedSoundNote.savedComponent.data.bHiddenInteraction = true;

  const baseGate = clone(scene.bricks.find(brick => brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const baseLabel = row(C.TextDisplay.NAME,
    (data, brick) => brick.g === terminalGrid && /^1\. ZONE VEHICLE TRACKING/.test(data.Text), 'terminal organization label').brick;

  function gate(kind, position, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate ${kind}`);
    const brickData = clone(baseGate);
    brickData.asset = definition.BRICK;
    brickData.position = position;
    brickData.direction = options.direction ?? 4;
    brickData.rotation = options.rotation ?? 0;
    brickData.size = [0, 0, 0];
    brickData.color = options.color || [67, 122, 163];
    brickData.material_intensity = options.materialIntensity ?? 5;
    const brick = {
      key: `v5:${terminalGrid}:${options.name || kind}:${sequence++}`,
      g: terminalGrid,
      data: brickData,
      comps: [{ type: definition.NAME, data: clone(data) }],
    };
    scene.bricks.push(brick);
    return brick;
  }

  function label(position, text, options = {}) {
    const brick = clone(baseLabel);
    brick.key = `v5:${terminalGrid}:${options.name || 'label'}:${sequence++}`;
    brick.g = terminalGrid;
    brick.data.position = position;
    brick.data.size = options.size || [300, 10, 2];
    brick.data.color = options.brickColor || [35, 35, 35];
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = text;
    display.data.LineHeight = options.lineHeight ?? 1.35;
    display.data.WidthScale = options.widthScale ?? 1;
    display.data.Color = options.textColor || { B: 255, G: 220, R: 110, A: 255 };
    display.data.Anchor = { X: 0, Y: 0.5 };
    display.data.Offset = { X: 1, Y: 0, Z: 0 };
    scene.bricks.push(brick);
    return brick;
  }

  function addEdge(source, sourceType, sourcePort, target, targetType, targetPort) {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType && edge.q === targetPort),
      `Duplicate driver for ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  }

  function removeIncoming(target, targetType, targetPort) {
    const removed = incoming(target, targetType, targetPort);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key && edge.zt === targetType && edge.q === targetPort));
    return removed;
  }

  function makeSetter(variable, value, position, name, source) {
    const setter = gate('Exec_Var_Set', position, { bChangeType: false, Value: clone(value) }, { name });
    addEdge(variable, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    if (source) addEdge(source.brick, source.type, source.port, setter, C.Exec_Var_Set.NAME, 'Value');
    return setter;
  }

  // Keep the user's collapsed/rearranged chip, but enlarge its internal plane
  // downward for a clearly separated session-data section.
  scene.entityOverrides = new Map();
  const terminalEntity = [...scene.r.entities()].find(entity => entity.persistentIndex === terminalGrid);
  assert(terminalEntity, 'Missing terminal microchip entity');
  const terminalOverride = clone(terminalEntity);
  terminalOverride.data = clone(terminalEntity.data);
  terminalOverride.data.PlaneCenter = { X: 330, Y: 500, Z: 2 };
  terminalOverride.data.PlaneExtent = { X: 380, Y: 600, Z: 8 };
  scene.entityOverrides.set(terminalGrid, terminalOverride);

  label([300, 700, 2], '5. SESSION + VEHICLE DISPLAY DATA\r\nSeat identity, Scrap, vehicle metadata, saved color, and BUY eligibility.', {
    name: 'session_data_label',
    size: [300, 10, 2],
  });

  // Persistent display state. Ready flags prevent retained values from the
  // previous seat occupant or vehicle flashing during an asynchronous refresh.
  const sessionReady = gate('Var', [0, 744, 2], { Value: B(false) }, { name: 'session_ready', color: [75, 210, 125] });
  const userIdVar = gate('Var', [48, 744, 2], { Value: S('NONE') }, { name: 'session_user_id', color: [75, 210, 125] });
  const userNameVar = gate('Var', [96, 744, 2], { Value: S('NONE') }, { name: 'session_user_name', color: [75, 210, 125] });
  const scrapVar = gate('Var', [144, 744, 2], { Value: I(0) }, { name: 'session_scrap', color: [75, 210, 125] });
  const playerStateVar = gate('Var', [192, 744, 2], { Value: O(null) }, { name: 'session_playerstate', color: [75, 210, 125] });
  const vehicleNameVar = gate('Var', [240, 744, 2], { Value: S('NONE') }, { name: 'vehicle_name', color: [70, 190, 255] });
  const colorKeyVar = gate('Var', [288, 744, 2], { Value: S('') }, { name: 'vehicle_color_key', color: [70, 190, 255] });
  const vehicleSupported = gate('Var', [336, 744, 2], { Value: B(false) }, { name: 'vehicle_supported', color: [70, 190, 255] });
  const savedColorReady = gate('Var', [384, 744, 2], { Value: B(false) }, { name: 'saved_color_ready', color: [215, 85, 255] });

  // Seat entry/exit refreshes the active user's ID, username, and Scrap.
  const seatEdge = gate('Expr_EdgeDetectorExec', [432, 744, 2], {
    Input: B(false), InputLast: B(false), bSeeded: true,
  }, { name: 'seat_occupied_edges', color: [75, 210, 125] });
  const seatActivity = gate('Exec_Union', [480, 744, 2], {}, { name: 'seat_activity_union', color: [75, 210, 125] });
  const userRefreshBranch = gate('Exec_Branch', [528, 744, 2], { bCond: false }, { name: 'seat_user_guard', color: [75, 210, 125] });
  addEdge(seat, C.Seat.NAME, 'bIsOccupied', seatEdge, C.Expr_EdgeDetectorExec.NAME, 'Input');
  addEdge(seatEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', seatActivity, C.Exec_Union.NAME, 'ExecA');
  addEdge(seatEdge, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge', seatActivity, C.Exec_Union.NAME, 'ExecB');
  addEdge(seatActivity, C.Exec_Union.NAME, 'ExecOut', userRefreshBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(seat, C.Seat.NAME, 'bIsOccupied', userRefreshBranch, C.Exec_Branch.NAME, 'bCond');

  const setSessionFalse = makeSetter(sessionReady, B(false), [0, 792, 2], 'session_refresh_begin');
  const getPlayerState = gate('Exec_PlayerState_GetFromEntity', [48, 792, 2], {}, { name: 'display_playerstate_get', color: [75, 210, 125] });
  const setPlayerState = makeSetter(playerStateVar, O(null), [96, 792, 2], 'display_playerstate_set', {
    brick: getPlayerState, type: C.Exec_PlayerState_GetFromEntity.NAME, port: 'PlayerState',
  });
  const getUserId = gate('Exec_PlayerState_GetUserId', [144, 792, 2], { UserId: '' }, { name: 'display_user_id_get', color: [75, 210, 125] });
  const setUserId = makeSetter(userIdVar, S(''), [192, 792, 2], 'display_user_id_set', {
    brick: getUserId, type: C.Exec_PlayerState_GetUserId.NAME, port: 'UserId',
  });
  const getUserName = gate('Exec_PlayerState_GetUserName', [240, 792, 2], { UserName: '' }, { name: 'display_user_name_get', color: [75, 210, 125] });
  const setUserName = makeSetter(userNameVar, S(''), [288, 792, 2], 'display_user_name_set', {
    brick: getUserName, type: C.Exec_PlayerState_GetUserName.NAME, port: 'UserName',
  });
  const scrapRefresh = gate('Exec_Union', [336, 792, 2], {}, { name: 'display_scrap_refresh', color: [75, 210, 125] });
  const getDisplayScrap = gate('Exec_Gamemode_GetLeaderboardValue', [384, 792, 2], { Key: 'Scrap', Value: 0 },
    { name: 'display_scrap_get', color: [75, 210, 125] });
  const setDisplayScrap = makeSetter(scrapVar, I(0), [432, 792, 2], 'display_scrap_set', {
    brick: getDisplayScrap, type: C.Exec_Gamemode_GetLeaderboardValue.NAME, port: 'Value',
  });
  const setSessionTrue = makeSetter(sessionReady, B(true), [480, 792, 2], 'session_refresh_complete');
  const sessionVehicleBranch = gate('Exec_Branch', [528, 792, 2], { bCond: false },
    { name: 'session_has_supported_vehicle', color: [75, 210, 125] });

  addEdge(userRefreshBranch, C.Exec_Branch.NAME, 'ExecOutA', setSessionFalse, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setSessionFalse, C.Exec_Var_Set.NAME, 'ExecOut', getPlayerState, C.Exec_PlayerState_GetFromEntity.NAME, 'Exec');
  addEdge(seat, C.Seat.NAME, 'SittingCharacter', getPlayerState, C.Exec_PlayerState_GetFromEntity.NAME, 'Entity');
  addEdge(getPlayerState, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', setPlayerState, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setPlayerState, C.Exec_Var_Set.NAME, 'ExecOut', getUserId, C.Exec_PlayerState_GetUserId.NAME, 'Exec');
  addEdge(playerStateVar, C.Var.NAME, 'Value', getUserId, C.Exec_PlayerState_GetUserId.NAME, 'PlayerState');
  addEdge(getUserId, C.Exec_PlayerState_GetUserId.NAME, 'ExecOut', setUserId, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setUserId, C.Exec_Var_Set.NAME, 'ExecOut', getUserName, C.Exec_PlayerState_GetUserName.NAME, 'Exec');
  addEdge(playerStateVar, C.Var.NAME, 'Value', getUserName, C.Exec_PlayerState_GetUserName.NAME, 'PlayerState');
  addEdge(getUserName, C.Exec_PlayerState_GetUserName.NAME, 'ExecOut', setUserName, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setUserName, C.Exec_Var_Set.NAME, 'ExecOut', scrapRefresh, C.Exec_Union.NAME, 'ExecA');
  addEdge(scrapRefresh, C.Exec_Union.NAME, 'ExecOut', getDisplayScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  addEdge(playerStateVar, C.Var.NAME, 'Value', getDisplayScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  addEdge(getDisplayScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', setDisplayScrap, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setDisplayScrap, C.Exec_Var_Set.NAME, 'ExecOut', setSessionTrue, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setSessionTrue, C.Exec_Var_Set.NAME, 'ExecOut', sessionVehicleBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(vehicleSupported, C.Var.NAME, 'Value', sessionVehicleBranch, C.Exec_Branch.NAME, 'bCond');

  const clearSession = makeSetter(sessionReady, B(false), [0, 840, 2], 'session_clear_ready');
  const clearUserId = makeSetter(userIdVar, S('NONE'), [48, 840, 2], 'session_clear_id');
  const clearUserName = makeSetter(userNameVar, S('NONE'), [96, 840, 2], 'session_clear_name');
  const clearScrap = makeSetter(scrapVar, I(0), [144, 840, 2], 'session_clear_scrap');
  const clearPlayerState = makeSetter(playerStateVar, O(null), [192, 840, 2], 'session_clear_playerstate');
  const retainAttemptScrap = makeSetter(scrapVar, I(0), [240, 840, 2], 'purchase_scrap_display_set', {
    brick: purchaseScrapGet, type: C.Exec_Gamemode_GetLeaderboardValue.NAME, port: 'Value',
  });
  addEdge(userRefreshBranch, C.Exec_Branch.NAME, 'ExecOutB', clearSession, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(clearSession, C.Exec_Var_Set.NAME, 'ExecOut', clearUserId, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(clearUserId, C.Exec_Var_Set.NAME, 'ExecOut', clearUserName, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(clearUserName, C.Exec_Var_Set.NAME, 'ExecOut', clearScrap, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(clearScrap, C.Exec_Var_Set.NAME, 'ExecOut', clearPlayerState, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(purchaseScrapGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', retainAttemptScrap, C.Exec_Var_Set.NAME, 'Exec');

  // Refresh the exact first vehicle targeted by the existing preview/purchase
  // logic. Both required custom properties must exist before BUY is enabled.
  const vehicleRefresh = gate('Exec_Union', [0, 888, 2], {}, { name: 'vehicle_display_refresh', color: [70, 190, 255] });
  const setVehicleUnsupported = makeSetter(vehicleSupported, B(false), [48, 888, 2], 'vehicle_refresh_begin');
  const setVehicleNone = makeSetter(vehicleNameVar, S('NONE'), [96, 888, 2], 'vehicle_name_clear');
  const setColorKeyEmpty = makeSetter(colorKeyVar, S(''), [144, 888, 2], 'vehicle_color_key_clear');
  const displayVehicleGet = gate('Exec_ArrayVar_Get', [192, 888, 2], { Index: 0, Value: O(null), bOutOfBounds: true },
    { name: 'display_vehicle_get', color: [70, 190, 255] });
  const vehicleValid = gate('Expr_LogicalNOT', [240, 888, 2], { bInput: true },
    { name: 'display_vehicle_valid', color: [70, 190, 255] });
  const vehicleValidBranch = gate('Exec_Branch', [288, 888, 2], { bCond: false },
    { name: 'display_vehicle_valid_branch', color: [70, 190, 255] });
  const getVehicleName = gate('Exec_Entity_GetCustomProperty', [336, 888, 2], {
    Key: 'VehicleName', Value: S(''), bFound: false,
  }, { name: 'vehicle_name_get', color: [70, 190, 255] });
  const getVehicleColorKey = gate('Exec_Entity_GetCustomProperty', [384, 888, 2], {
    Key: 'ColorLeaderboardKey', Value: S(''), bFound: false,
  }, { name: 'vehicle_color_key_get', color: [70, 190, 255] });
  const vehicleMetadataFound = gate('Expr_LogicalAND', [432, 888, 2], { bInputA: false, bInputB: false },
    { name: 'vehicle_metadata_found', color: [70, 190, 255] });
  const vehicleMetadataBranch = gate('Exec_Branch', [480, 888, 2], { bCond: false },
    { name: 'vehicle_metadata_branch', color: [70, 190, 255] });
  const setVehicleName = makeSetter(vehicleNameVar, S(''), [528, 888, 2], 'vehicle_name_set', {
    brick: getVehicleName, type: C.Exec_Entity_GetCustomProperty.NAME, port: 'Value',
  });
  const setVehicleColorKey = makeSetter(colorKeyVar, S(''), [576, 888, 2], 'vehicle_color_key_set', {
    brick: getVehicleColorKey, type: C.Exec_Entity_GetCustomProperty.NAME, port: 'Value',
  });
  const setVehicleSupported = makeSetter(vehicleSupported, B(true), [624, 888, 2], 'vehicle_refresh_complete');
  const vehicleSessionBranch = gate('Exec_Branch', [672, 888, 2], { bCond: false },
    { name: 'vehicle_has_session', color: [70, 190, 255] });

  addEdge(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut', vehicleRefresh, C.Exec_Union.NAME, 'ExecA');
  addEdge(removeAt, C.Exec_ArrayVar_RemoveAtIndex.NAME, 'ExecOut', vehicleRefresh, C.Exec_Union.NAME, 'ExecB');
  addEdge(vehicleRefresh, C.Exec_Union.NAME, 'ExecOut', setVehicleUnsupported, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setVehicleUnsupported, C.Exec_Var_Set.NAME, 'ExecOut', setVehicleNone, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setVehicleNone, C.Exec_Var_Set.NAME, 'ExecOut', setColorKeyEmpty, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setColorKeyEmpty, C.Exec_Var_Set.NAME, 'ExecOut', displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'Exec');
  addEdge(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  addEdge(displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', vehicleValid, C.Expr_LogicalNOT.NAME, 'bInput');
  addEdge(displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'ExecOut', vehicleValidBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(vehicleValid, C.Expr_LogicalNOT.NAME, 'bOutput', vehicleValidBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(vehicleValidBranch, C.Exec_Branch.NAME, 'ExecOutA', getVehicleName, C.Exec_Entity_GetCustomProperty.NAME, 'Exec');
  addEdge(displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'Value', getVehicleName, C.Exec_Entity_GetCustomProperty.NAME, 'Entity');
  addEdge(getVehicleName, C.Exec_Entity_GetCustomProperty.NAME, 'ExecOut', getVehicleColorKey, C.Exec_Entity_GetCustomProperty.NAME, 'Exec');
  addEdge(displayVehicleGet, C.Exec_ArrayVar_Get.NAME, 'Value', getVehicleColorKey, C.Exec_Entity_GetCustomProperty.NAME, 'Entity');
  addEdge(getVehicleName, C.Exec_Entity_GetCustomProperty.NAME, 'bFound', vehicleMetadataFound, C.Expr_LogicalAND.NAME, 'bInputA');
  addEdge(getVehicleColorKey, C.Exec_Entity_GetCustomProperty.NAME, 'bFound', vehicleMetadataFound, C.Expr_LogicalAND.NAME, 'bInputB');
  addEdge(getVehicleColorKey, C.Exec_Entity_GetCustomProperty.NAME, 'ExecOut', vehicleMetadataBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(vehicleMetadataFound, C.Expr_LogicalAND.NAME, 'bOutput', vehicleMetadataBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(vehicleMetadataBranch, C.Exec_Branch.NAME, 'ExecOutA', setVehicleName, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setVehicleName, C.Exec_Var_Set.NAME, 'ExecOut', setVehicleColorKey, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setVehicleColorKey, C.Exec_Var_Set.NAME, 'ExecOut', setVehicleSupported, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setVehicleSupported, C.Exec_Var_Set.NAME, 'ExecOut', vehicleSessionBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(sessionReady, C.Var.NAME, 'Value', vehicleSessionBranch, C.Exec_Branch.NAME, 'bCond');

  // One saved-color query is shared by session completion, vehicle completion,
  // and the post-purchase balance refresh.
  const savedColorRefresh = gate('Exec_Union', [0, 936, 2], {}, { name: 'saved_color_refresh', color: [215, 85, 255] });
  const setSavedColorNotReady = makeSetter(savedColorReady, B(false), [48, 936, 2], 'saved_color_refresh_begin');
  const getDisplaySavedColor = gate('Exec_Gamemode_GetLeaderboardValue', [96, 936, 2], { Key: '', Value: 0 },
    { name: 'display_saved_color_get', color: [215, 85, 255] });
  const setSavedColorReady = makeSetter(savedColorReady, B(true), [144, 936, 2], 'saved_color_refresh_complete');
  addEdge(sessionVehicleBranch, C.Exec_Branch.NAME, 'ExecOutA', savedColorRefresh, C.Exec_Union.NAME, 'ExecA');
  addEdge(vehicleSessionBranch, C.Exec_Branch.NAME, 'ExecOutA', savedColorRefresh, C.Exec_Union.NAME, 'ExecB');
  addEdge(savedColorRefresh, C.Exec_Union.NAME, 'ExecOut', setSavedColorNotReady, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(setSavedColorNotReady, C.Exec_Var_Set.NAME, 'ExecOut', getDisplaySavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  addEdge(playerStateVar, C.Var.NAME, 'Value', getDisplaySavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  addEdge(colorKeyVar, C.Var.NAME, 'Value', getDisplaySavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Key');
  addEdge(getDisplaySavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', setSavedColorReady, C.Exec_Var_Set.NAME, 'Exec');

  // Post-purchase refresh does not blank identity; it updates balance, then the
  // chain above updates the newly saved color.
  const postPurchaseGuard = gate('Exec_Branch', [192, 936, 2], { bCond: false },
    { name: 'post_purchase_session_guard', color: [75, 210, 125] });
  addEdge(chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut', postPurchaseGuard, C.Exec_Branch.NAME, 'Exec');
  addEdge(sessionReady, C.Var.NAME, 'Value', postPurchaseGuard, C.Exec_Branch.NAME, 'bCond');
  addEdge(postPurchaseGuard, C.Exec_Branch.NAME, 'ExecOutA', scrapRefresh, C.Exec_Union.NAME, 'ExecB');

  // Decode the seated user's saved packed RGB score to the same normalized
  // six-digit uppercase hex representation used by the live preview.
  const scoreMax = gate('Expr_MathMax', [240, 936, 2], { InputA: I(0), InputB: I(0) },
    { name: 'saved_color_floor', color: [215, 85, 255] });
  const scoreMin = gate('Expr_MathMin', [288, 936, 2], { InputA: I(0), InputB: I(16777215) },
    { name: 'saved_color_ceiling', color: [215, 85, 255] });
  const scoreRed = gate('Expr_MathDivide', [336, 936, 2], { InputA: I(0), InputB: I(65536) },
    { name: 'saved_color_red', color: [255, 90, 90] });
  const scoreGreenBase = gate('Expr_MathDivide', [384, 936, 2], { InputA: I(0), InputB: I(256) },
    { name: 'saved_color_green_base', color: [90, 255, 110] });
  const scoreGreen = gate('Expr_MathModulo', [432, 936, 2], { InputA: I(0), InputB: I(256) },
    { name: 'saved_color_green', color: [90, 255, 110] });
  const scoreBlue = gate('Expr_MathModulo', [480, 936, 2], { InputA: I(0), InputB: I(256) },
    { name: 'saved_color_blue', color: [90, 150, 255] });
  const savedColor = gate('Expr_MakeColorSRGB', [528, 936, 2], { R: 0, G: 0, B: 0, A: 255 },
    { name: 'saved_color_make', color: [215, 85, 255] });
  const savedToHex = gate('Expr_ColorToHex', [576, 936, 2], { Input: colorValue(0, 0, 0, 1) },
    { name: 'saved_color_to_hex', color: [215, 85, 255] });
  const savedUpper = gate('Expr_String_ToUpper', [624, 936, 2], { Input: '000000' },
    { name: 'saved_hex_upper', color: [215, 85, 255] });
  const savedStartsHash = gate('Expr_String_StartsWith', [672, 936, 2], {
    Input: '000000', Prefix: '#', bCaseSensitive: true,
  }, { name: 'saved_hex_has_hash', color: [215, 85, 255] });

  addEdge(getDisplaySavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', scoreMax, C.Expr_MathMax.NAME, 'InputA');
  addEdge(scoreMax, C.Expr_MathMax.NAME, 'Output', scoreMin, C.Expr_MathMin.NAME, 'InputA');
  addEdge(scoreMin, C.Expr_MathMin.NAME, 'Output', scoreRed, C.Expr_MathDivide.NAME, 'InputA');
  addEdge(scoreMin, C.Expr_MathMin.NAME, 'Output', scoreGreenBase, C.Expr_MathDivide.NAME, 'InputA');
  addEdge(scoreMin, C.Expr_MathMin.NAME, 'Output', scoreBlue, C.Expr_MathModulo.NAME, 'InputA');
  addEdge(scoreGreenBase, C.Expr_MathDivide.NAME, 'Output', scoreGreen, C.Expr_MathModulo.NAME, 'InputA');
  addEdge(scoreRed, C.Expr_MathDivide.NAME, 'Output', savedColor, C.Expr_MakeColorSRGB.NAME, 'R');
  addEdge(scoreGreen, C.Expr_MathModulo.NAME, 'Output', savedColor, C.Expr_MakeColorSRGB.NAME, 'G');
  addEdge(scoreBlue, C.Expr_MathModulo.NAME, 'Output', savedColor, C.Expr_MakeColorSRGB.NAME, 'B');
  addEdge(savedColor, C.Expr_MakeColorSRGB.NAME, 'Output', savedToHex, C.Expr_ColorToHex.NAME, 'Input');
  addEdge(savedToHex, C.Expr_ColorToHex.NAME, 'Hex', savedUpper, C.Expr_String_ToUpper.NAME, 'Input');
  addEdge(savedUpper, C.Expr_String_ToUpper.NAME, 'Output', savedStartsHash, C.Expr_String_StartsWith.NAME, 'Input');

  const savedWithoutHash = gate('Expr_String_Substring', [0, 984, 2], { Input: '000000', Start: 1, Length: 1024 },
    { name: 'saved_hex_without_hash', color: [215, 85, 255] });
  const savedHashSelect = gate('Expr_Select', [48, 984, 2], {
    bSelectB: false, InputA: S('000000'), InputB: S('000000'),
  }, { name: 'saved_hex_normalize_hash', color: [215, 85, 255] });
  const savedSixDigits = gate('Expr_String_Substring', [96, 984, 2], { Input: '000000', Start: 0, Length: 6 },
    { name: 'saved_hex_six_digits', color: [215, 85, 255] });
  const savedHexFormatted = gate('Expr_String_FormatText', [144, 984, 2], {
    FormatString: '#{A}', InputA: S('000000'), InputB: N(0), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'saved_hex_formatted', color: [215, 85, 255] });
  addEdge(savedUpper, C.Expr_String_ToUpper.NAME, 'Output', savedWithoutHash, C.Expr_String_Substring.NAME, 'Input');
  addEdge(savedUpper, C.Expr_String_ToUpper.NAME, 'Output', savedHashSelect, C.Expr_Select.NAME, 'InputA');
  addEdge(savedWithoutHash, C.Expr_String_Substring.NAME, 'Output', savedHashSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(savedStartsHash, C.Expr_String_StartsWith.NAME, 'Output', savedHashSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(savedHashSelect, C.Expr_Select.NAME, 'Output', savedSixDigits, C.Expr_String_Substring.NAME, 'Input');
  addEdge(savedSixDigits, C.Expr_String_Substring.NAME, 'Output', savedHexFormatted, C.Expr_String_FormatText.NAME, 'InputA');

  // Selectors guarantee the monitor never shows retained data from a previous
  // occupant or unsupported vehicle.
  const sessionAndVehicle = gate('Expr_LogicalAND', [192, 984, 2], { bInputA: false, bInputB: false },
    { name: 'current_color_session_vehicle', color: [215, 85, 255] });
  const currentColorReady = gate('Expr_LogicalAND', [240, 984, 2], { bInputA: false, bInputB: false },
    { name: 'current_color_ready', color: [215, 85, 255] });
  const currentHexSelect = gate('Expr_Select', [288, 984, 2], {
    bSelectB: false, InputA: S('N/A'), InputB: S('#000000'),
  }, { name: 'current_hex_display_select', color: [215, 85, 255] });
  const idSelect = gate('Expr_Select', [336, 984, 2], {
    bSelectB: false, InputA: S('NONE'), InputB: S('NONE'),
  }, { name: 'user_id_display_select', color: [75, 210, 125] });
  const nameSelect = gate('Expr_Select', [384, 984, 2], {
    bSelectB: false, InputA: S('NONE'), InputB: S('NONE'),
  }, { name: 'user_name_display_select', color: [75, 210, 125] });
  const scrapSelect = gate('Expr_Select', [432, 984, 2], {
    bSelectB: false, InputA: I(0), InputB: I(0),
  }, { name: 'scrap_display_select', color: [75, 210, 125] });
  const vehicleSelect = gate('Expr_Select', [480, 984, 2], {
    bSelectB: false, InputA: S('NONE'), InputB: S('NONE'),
  }, { name: 'vehicle_display_select', color: [70, 190, 255] });
  const buyReadyA = gate('Expr_LogicalAND', [528, 984, 2], { bInputA: false, bInputB: false },
    { name: 'buy_selected_session_ready', color: [75, 210, 125] });
  const buyReadyB = gate('Expr_LogicalAND', [576, 984, 2], { bInputA: false, bInputB: false },
    { name: 'buy_supported_vehicle_ready', color: [75, 210, 125] });

  addEdge(sessionReady, C.Var.NAME, 'Value', sessionAndVehicle, C.Expr_LogicalAND.NAME, 'bInputA');
  addEdge(vehicleSupported, C.Var.NAME, 'Value', sessionAndVehicle, C.Expr_LogicalAND.NAME, 'bInputB');
  addEdge(sessionAndVehicle, C.Expr_LogicalAND.NAME, 'bOutput', currentColorReady, C.Expr_LogicalAND.NAME, 'bInputA');
  addEdge(savedColorReady, C.Var.NAME, 'Value', currentColorReady, C.Expr_LogicalAND.NAME, 'bInputB');
  addEdge(currentColorReady, C.Expr_LogicalAND.NAME, 'bOutput', currentHexSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(savedHexFormatted, C.Expr_String_FormatText.NAME, 'Output', currentHexSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(sessionReady, C.Var.NAME, 'Value', idSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(userIdVar, C.Var.NAME, 'Value', idSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(sessionReady, C.Var.NAME, 'Value', nameSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(userNameVar, C.Var.NAME, 'Value', nameSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(sessionReady, C.Var.NAME, 'Value', scrapSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(scrapVar, C.Var.NAME, 'Value', scrapSelect, C.Expr_Select.NAME, 'InputB');
  addEdge(vehicleSupported, C.Var.NAME, 'Value', vehicleSelect, C.Expr_Select.NAME, 'bSelectB');
  addEdge(vehicleNameVar, C.Var.NAME, 'Value', vehicleSelect, C.Expr_Select.NAME, 'InputB');

  removeIncoming(buyGuard, C.Exec_Branch.NAME, 'bCond');
  addEdge(buySelected, selectedEdge.at, selectedEdge.p, buyReadyA, C.Expr_LogicalAND.NAME, 'bInputA');
  addEdge(sessionReady, C.Var.NAME, 'Value', buyReadyA, C.Expr_LogicalAND.NAME, 'bInputB');
  addEdge(buyReadyA, C.Expr_LogicalAND.NAME, 'bOutput', buyReadyB, C.Expr_LogicalAND.NAME, 'bInputA');
  addEdge(vehicleSupported, C.Var.NAME, 'Value', buyReadyB, C.Expr_LogicalAND.NAME, 'bInputB');
  addEdge(buyReadyB, C.Expr_LogicalAND.NAME, 'bOutput', buyGuard, C.Exec_Branch.NAME, 'bCond');

  // The selected vehicle supplies its own color score key. This removes the
  // terminal's hard-coded Truck1Color dependency without changing the spawner.
  addEdge(colorKeyVar, C.Var.NAME, 'Value', purchaseColorGet, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Key');
  addEdge(colorKeyVar, C.Var.NAME, 'Value', purchaseColorSet, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Key');

  // Repurpose the old CURRENT HEX formatter as the compact session block.
  removeIncoming(sessionHeader, C.Expr_String_FormatText.NAME, 'InputA');
  const headerData = component(sessionHeader, C.Expr_String_FormatText.NAME).data;
  headerData.FormatString = 'PROCESS: COLOR_CUSTOMIZER\r\nSTATUS: RUNNING\r\nID: {A}\r\nUSER: {B}\r\nSCRAP: {C}\r\nCURRENT VEHICLE IN ZONE: {D}\r\nCURRENT VEHICLE COLOR HEX: {E}\r\nNEW VEHICLE COLOR HEX: #{F}';
  addEdge(idSelect, C.Expr_Select.NAME, 'Output', sessionHeader, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(nameSelect, C.Expr_Select.NAME, 'Output', sessionHeader, C.Expr_String_FormatText.NAME, 'InputB');
  addEdge(scrapSelect, C.Expr_Select.NAME, 'Output', sessionHeader, C.Expr_String_FormatText.NAME, 'InputC');
  addEdge(vehicleSelect, C.Expr_Select.NAME, 'Output', sessionHeader, C.Expr_String_FormatText.NAME, 'InputD');
  addEdge(currentHexSelect, C.Expr_Select.NAME, 'Output', sessionHeader, C.Expr_String_FormatText.NAME, 'InputE');
  addEdge(previewHex, previewHexEdge.at, previewHexEdge.p, sessionHeader, C.Expr_String_FormatText.NAME, 'InputF');

  component(completeMenu, C.Expr_String_FormatText.NAME).data.FormatString = '{G}\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n{E}\r\n\r\n{F}\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nC ENTER HEX   SPACE ACTIVATE';
  component(priceAndBuy, C.Expr_String_FormatText.NAME).data.FormatString = 'Price: 🔩Scrap {A}\r\n{B}';

  const displayEdge = one(outgoing(completeMenu, C.Expr_String_FormatText.NAME, 'Output')
    .filter(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'Text'), 'main monitor display');
  const display = brickFor(displayEdge.z);
  component(display, C.TextDisplay.NAME).data.LineHeight = Math.fround(0.65);

  const terminalName = 'Scrap Runners - Color Terminal v5';
  const terminalDescription = 'User-rearranged color terminal with preserved success/failure sounds, seated user ID/name/Scrap, dynamic vehicle identity and color-key metadata, saved/new hex comparison, selectable BUY, and targeted preview/restore behavior. The editor-only failed-sound note is hidden during play.';
  const generated = write(scene, { name: terminalName, description: terminalDescription, owner }).bytes;
  const bytes = repack(generated, inputBytes, { name: terminalName, description: terminalDescription });
  return {
    bytes,
    scene,
    input,
    grids: { config: configGrid, core: coreGrid, terminal: terminalGrid },
    added: {
      sessionReady, userIdVar, userNameVar, scrapVar, playerStateVar,
      vehicleNameVar, colorKeyVar, vehicleSupported, savedColorReady,
      sessionHeader, completeMenu, priceAndBuy, display,
    },
  };
}

function buildTruck(input) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  const owner = ownerFrom(scene);
  const vehicle = [...scene.r.entities()].find(entity => entity.data?.EntityTag === 'Vehicle');
  assert(vehicle, 'Truck1 prefab has no tagged Vehicle root');
  assert.deepEqual(vehicle.data.CustomProperties, { $map: [] }, 'Truck1 already has unexpected custom properties');
  const override = clone(vehicle);
  override.data = clone(vehicle.data);
  override.data.CustomProperties = {
    $map: [
      ['VehicleName', S('FlatbedTruck1')],
      ['ColorLeaderboardKey', S('Truck1Color')],
    ],
  };
  scene.entityOverrides = new Map([[vehicle.persistentIndex, override]]);

  const name = 'Scrap Runners - Truck1 Color Enabled v4';
  const description = 'Truck1 color-enabled vehicle for the existing spawner. Adds static VehicleName and ColorLeaderboardKey properties for terminal discovery; all v3 preview, save, restore, owner, body-array, and non-color logic remains unchanged.';
  const result = writeWithRemappedBrickHandles(scene, { name, description, owner });
  const bytes = repack(result.bytes, inputBytes, { name, description });
  return { bytes, scene, vehicle, remappedBrickHandles: result.remappedBrickHandles };
}

function build({ terminalInput = TERMINAL_INPUT, truckInput = TRUCK_INPUT } = {}) {
  return {
    terminal: buildTerminal(terminalInput),
    truck: buildTruck(truckInput),
    terminalInput,
    truckInput,
  };
}

if (require.main === module) {
  const context = build();
  fs.mkdirSync(path.dirname(TERMINAL_OUTPUT), { recursive: true });
  fs.mkdirSync(path.dirname(TRUCK_OUTPUT), { recursive: true });
  fs.writeFileSync(TERMINAL_OUTPUT, context.terminal.bytes);
  fs.writeFileSync(TRUCK_OUTPUT, context.truck.bytes);
  require('./test-scrap-runners-color-terminal-v5.cjs')({
    terminalInput: TERMINAL_INPUT,
    truckInput: TRUCK_INPUT,
    terminalOutput: TERMINAL_OUTPUT,
    truckOutput: TRUCK_OUTPUT,
  });
  console.log(JSON.stringify({
    terminalInput: TERMINAL_INPUT,
    terminalOutput: TERMINAL_OUTPUT,
    terminalBytes: context.terminal.bytes.length,
    truckInput: TRUCK_INPUT,
    truckOutput: TRUCK_OUTPUT,
    truckBytes: context.truck.bytes.length,
    truckRemappedBrickHandles: context.truck.remappedBrickHandles,
  }, null, 2));
}

module.exports = build;
