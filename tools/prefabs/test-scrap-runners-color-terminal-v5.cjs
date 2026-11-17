'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_TERMINAL_INPUT = '/workspace/attachments/55e12922-f96f-4d2b-96ab-e49fedd82edb/Sound added and rearranged.brz';
const DEFAULT_TRUCK_INPUT = path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v3.brz');
const DEFAULT_TERMINAL_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v5.brz');
const DEFAULT_TRUCK_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v4.brz');

function api(scene) {
  const rows = scene.bricks.flatMap(brick => brick.comps.map(component => ({ brick, component })));
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(
    rows.filter(item => item.component.type === type && predicate(item.component.data, item.brick)), label,
  );
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  return { rows, bricks, one, row, incoming, outgoing };
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

function countAndValidateBrickHandles(scene, label) {
  const targets = new Set(scene.bricks.map(brick => brick.key));
  let count = 0;
  for (const brick of scene.bricks) for (const component of brick.comps) visitValues(component.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    assert(targets.has(key), `${label}: dangling stored BrickHandle ${key}`);
    count++;
  });
  return count;
}

function assertOwner(before, after, label) {
  const source = before.r.owners();
  const sourceIndex = source.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceIndex >= 0, `${label}: source owner`);
  const id = brdb.guidToUuid(source.UserIds[sourceIndex]).toLowerCase();
  const output = after.r.owners();
  const outputIndex = output.UserIds.map(brdb.guidToUuid).map(value => value.toLowerCase()).indexOf(id);
  assert(outputIndex >= 0, `${label}: source owner ID preserved`);
  assert.equal(output.UserNames[outputIndex], source.UserNames[sourceIndex], `${label}: username preserved`);
  assert.equal(output.DisplayNames[outputIndex], source.DisplayNames[sourceIndex], `${label}: display name preserved`);
  for (const grid of after.r.gridIds()) for (const chunk of after.r.brickChunkIndex(grid)) {
    const soa = after.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputIndex), `${label}: grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputIndex), `${label}: grid ${grid} original owner`);
  }
  assert([...after.r.entities()].every(entity => entity.ownerIndex === outputIndex), `${label}: entity owner`);
  assert([...after.r.entities()].every(entity => entity.originalOwnerIndex === outputIndex), `${label}: entity original owner`);
}

function assertIntegrity(scene, label) {
  const keys = new Set(scene.bricks.map(brick => brick.key));
  const targets = new Set();
  for (const edge of scene.edges) {
    assert(keys.has(edge.a), `${label}: dangling source ${edge.a}`);
    assert(keys.has(edge.z), `${label}: dangling target ${edge.z}`);
    const target = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(target), `${label}: duplicate driver ${target}`);
    targets.add(target);
  }
  for (const link of scene.links) assert(keys.has(link.key), `${label}: dangling microchip link`);
  for (const joint of scene.joints || []) assert(keys.has(joint.key), `${label}: dangling joint`);
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  if (brick.data.asset.startsWith('B_1x1_Gate_')) return [5, 5, 2];
  return [0, 0, 0];
}

function overlaps(first, second) {
  const a = halfSize(first);
  const b = halfSize(second);
  return [0, 1, 2].every(axis => Math.abs(first.data.position[axis] - second.data.position[axis]) < a[axis] + b[axis]);
}

function assertGridFitsPlane(scene, grid, label) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity?.data?.PlaneCenter && entity?.data?.PlaneExtent, `${label}: plane metadata`);
  for (const brick of scene.bricks.filter(candidate => candidate.g === grid)) {
    for (const [axis, coordinate] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
      const extent = halfSize(brick)[coordinate];
      assert(distance + extent <= entity.data.PlaneExtent[axis],
        `${label}: ${brick.key} outside ${axis} plane`);
    }
  }
}

function canonicalBrickRows(scene) {
  return scene.bricks.map(brick => ({ data: brick.data, comps: brick.comps }));
}

function canonicalEdges(scene) {
  const indices = new Map(scene.bricks.map((brick, index) => [brick.key, index]));
  return scene.edges.map(edge => ({
    a: indices.get(edge.a), at: edge.at, p: edge.p,
    z: indices.get(edge.z), zt: edge.zt, q: edge.q,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function test({
  terminalInput = DEFAULT_TERMINAL_INPUT,
  truckInput = DEFAULT_TRUCK_INPUT,
  terminalOutput = DEFAULT_TERMINAL_OUTPUT,
  truckOutput = DEFAULT_TRUCK_OUTPUT,
} = {}) {
  const sourceTerminal = read(fs.readFileSync(terminalInput));
  const sourceTruck = read(fs.readFileSync(truckInput));
  const terminal = read(fs.readFileSync(terminalOutput));
  const truck = read(fs.readFileSync(truckOutput));
  const s = api(sourceTerminal);
  const t = api(terminal);

  assertOwner(sourceTerminal, terminal, 'terminal');
  assertOwner(sourceTruck, truck, 'truck');
  assertIntegrity(terminal, 'terminal');
  assertIntegrity(truck, 'truck');
  assert.deepEqual(terminal.r.externalAssets(), sourceTerminal.r.externalAssets(), 'Terminal sound/font assets changed');
  assert.equal(countAndValidateBrickHandles(terminal, 'terminal'), 0, 'Terminal must contain no truck BrickHandles');
  assert.equal(countAndValidateBrickHandles(truck, 'truck'), 33, 'Truck must retain all 33 body/application BrickHandles');

  // The user-rearranged root geometry, enlarged zone, and all three added sound
  // emitters remain in place. Only the display LineHeight is intentionally
  // tightened to fit the expanded metadata.
  const sourceEmitters = s.rows.filter(item => item.component.type === C.OneShotAudioEmitter.NAME)
    .map(item => ({ position: item.brick.data.position, data: item.component.data }))
    .sort((a, b) => JSON.stringify(a.position).localeCompare(JSON.stringify(b.position)));
  const outputEmitters = t.rows.filter(item => item.component.type === C.OneShotAudioEmitter.NAME)
    .map(item => ({ position: item.brick.data.position, data: item.component.data }))
    .sort((a, b) => JSON.stringify(a.position).localeCompare(JSON.stringify(b.position)));
  assert.equal(sourceEmitters.length, 6, 'Source should contain the three root purchase sounds plus three core sounds');
  assert.deepEqual(outputEmitters, sourceEmitters, 'User-added/configured sounds changed');

  const sourceZone = s.row(C.AttachedZone.NAME, () => true, 'source vehicle zone');
  const outputZone = t.row(C.AttachedZone.NAME, () => true, 'output vehicle zone');
  assert.deepEqual(outputZone.brick.data.position, sourceZone.brick.data.position, 'User-rearranged zone position changed');
  assert.deepEqual(outputZone.brick.data.size, sourceZone.brick.data.size, 'User-enlarged zone size changed');

  const successfulBuy = t.row(C.MicrochipOutput.NAME, data => data.PortLabel === 'Successful Buy', 'Successful Buy output');
  const failedBuy = t.row(C.MicrochipOutput.NAME, data => data.PortLabel === 'Failed Buy', 'Failed Buy output');
  const successSounds = t.outgoing(successfulBuy.brick, C.MicrochipOutput.NAME, 'RER_Output')
    .map(edge => t.bricks.get(edge.z)).filter(brick => brick?.comps.some(component => component.type === C.OneShotAudioEmitter.NAME));
  const failedSounds = t.outgoing(failedBuy.brick, C.MicrochipOutput.NAME, 'RER_Output')
    .map(edge => t.bricks.get(edge.z)).filter(brick => brick?.comps.some(component => component.type === C.OneShotAudioEmitter.NAME));
  assert.equal(successSounds.length, 2, 'Successful Buy must retain both user-added sounds');
  assert.equal(failedSounds.length, 1, 'Failed Buy must retain its user-added sound');
  const failedSoundNote = t.row(C.Interact.NAME,
    data => data.Message === 'Wire Failed Buy into This sound effect', 'failed-buy sound annotation');
  assert.equal(failedSoundNote.component.data.bAllowNearbyInteraction, false, 'Editor sound note must not create a nearby prompt');
  assert.equal(failedSoundNote.component.data.bHiddenInteraction, true, 'Editor sound note must be hidden in play');

  // Requested screen hierarchy and exact price label.
  const sessionHeader = t.row(C.Expr_String_FormatText.NAME,
    data => /^PROCESS: COLOR_CUSTOMIZER\r\nSTATUS: RUNNING\r\nID: \{A\}/.test(data.FormatString), 'session header');
  assert.match(sessionHeader.component.data.FormatString, /USER: \{B\}/);
  assert.match(sessionHeader.component.data.FormatString, /SCRAP: \{C\}/);
  assert.match(sessionHeader.component.data.FormatString, /CURRENT VEHICLE IN ZONE: \{D\}/);
  assert.match(sessionHeader.component.data.FormatString, /CURRENT VEHICLE COLOR HEX: \{E\}/);
  assert.match(sessionHeader.component.data.FormatString, /NEW VEHICLE COLOR HEX: #\{F\}/);
  for (const port of ['InputA', 'InputB', 'InputC', 'InputD', 'InputE', 'InputF'])
    assert.equal(t.incoming(sessionHeader.brick, C.Expr_String_FormatText.NAME, port).length, 1, `Session header ${port}`);
  const completeMenu = t.row(C.Expr_String_FormatText.NAME,
    data => /^\{G\}\r\n\r\n\{A\}/.test(data.FormatString), 'complete menu');
  assert(t.incoming(completeMenu.brick, C.Expr_String_FormatText.NAME, 'InputG')
    .some(edge => edge.a === sessionHeader.brick.key), 'Session block must feed menu InputG');
  const price = t.row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === 'Price: 🔩Scrap {A}\r\n{B}', 'price and BUY formatter');
  assert(price, 'Requested Scrap price label');
  const displayEdge = t.one(t.outgoing(completeMenu.brick, C.Expr_String_FormatText.NAME, 'Output')
    .filter(edge => edge.zt === C.TextDisplay.NAME && edge.q === 'Text'), 'menu display');
  const display = t.bricks.get(displayEdge.z);
  assert.equal(display.comps.find(component => component.type === C.TextDisplay.NAME).data.LineHeight, Math.fround(0.65),
    'Expanded 20-line UI must retain fitted line height');

  const terminalGrid = t.row(C.EntityZoneEvent_Entered.NAME, () => true, 'zone entered').brick.g;
  const seat = t.row(C.Seat.NAME, () => true, 'terminal seat');
  const seatEdge = t.row(C.Expr_EdgeDetectorExec.NAME, (_data, brick) => brick.g === terminalGrid
    && t.incoming(brick, C.Expr_EdgeDetectorExec.NAME, 'Input').some(edge => edge.a === seat.brick.key && edge.p === 'bIsOccupied'), 'seat occupancy edge');
  assert(t.outgoing(seatEdge.brick, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge').length, 'Seat entry refresh missing');
  assert(t.outgoing(seatEdge.brick, C.Expr_EdgeDetectorExec.NAME, 'OnFallingEdge').length, 'Seat exit clear missing');

  const getUserId = t.row(C.Exec_PlayerState_GetUserId.NAME, (_data, brick) => brick.g === terminalGrid, 'Get User ID');
  const getUserName = t.row(C.Exec_PlayerState_GetUserName.NAME, (_data, brick) => brick.g === terminalGrid, 'Get Username');
  assert(t.outgoing(getUserId.brick, C.Exec_PlayerState_GetUserId.NAME, 'UserId').some(edge => edge.zt === C.Exec_Var_Set.NAME), 'User ID must be retained');
  assert(t.outgoing(getUserName.brick, C.Exec_PlayerState_GetUserName.NAME, 'UserName').some(edge => edge.zt === C.Exec_Var_Set.NAME), 'Username must be retained');
  const displayScrap = t.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === 'Scrap'
      && brick.data.position[0] === 384 && brick.data.position[1] === 792, 'display Scrap getter');
  const chargeScrap = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME, data => data.Key === 'Scrap', 'Scrap debit');
  assert(t.outgoing(chargeScrap.brick, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut')
    .some(edge => edge.zt === C.Exec_Branch.NAME), 'Purchase must refresh the displayed balance');
  assert(displayScrap, 'Displayed Scrap query');

  // Dynamic vehicle identity: exact array target -> both properties -> ready.
  const vehicleNameGet = t.row(C.Exec_Entity_GetCustomProperty.NAME,
    data => data.Key === 'VehicleName', 'VehicleName property getter');
  const colorKeyGet = t.row(C.Exec_Entity_GetCustomProperty.NAME,
    data => data.Key === 'ColorLeaderboardKey', 'ColorLeaderboardKey property getter');
  assert.equal(vehicleNameGet.brick.g, terminalGrid);
  assert.equal(colorKeyGet.brick.g, terminalGrid);
  const nameTarget = t.one(t.incoming(vehicleNameGet.brick, C.Exec_Entity_GetCustomProperty.NAME, 'Entity'), 'VehicleName target');
  const keyTarget = t.one(t.incoming(colorKeyGet.brick, C.Exec_Entity_GetCustomProperty.NAME, 'Entity'), 'Color key target');
  assert.equal(nameTarget.a, keyTarget.a, 'Vehicle metadata must come from one exact zone target');
  assert.equal(nameTarget.at, C.Exec_ArrayVar_Get.NAME, 'Vehicle metadata must use array index 0');
  const displayVehicleGet = t.bricks.get(nameTarget.a);
  assert.equal(displayVehicleGet.comps.find(component => component.type === C.Exec_ArrayVar_Get.NAME).data.Index, 0);

  const colorKeySetter = t.one(t.outgoing(colorKeyGet.brick, C.Exec_Entity_GetCustomProperty.NAME, 'Value')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'retained color key');
  const colorKeySet = t.bricks.get(colorKeySetter.z);
  const colorKeyVarEdge = t.one(t.incoming(colorKeySet, C.Exec_Var_Set.NAME, 'VarRef'), 'color key variable');
  const colorKeyVar = t.bricks.get(colorKeyVarEdge.a);
  const keyConsumers = t.outgoing(colorKeyVar, C.Var.NAME, 'Value')
    .filter(edge => edge.q === 'Key').map(edge => edge.zt).sort();
  assert.deepEqual(keyConsumers, [
    C.Exec_Gamemode_GetLeaderboardValue.NAME,
    C.Exec_Gamemode_GetLeaderboardValue.NAME,
    C.Exec_Gamemode_SetLeaderboardValue.NAME,
  ].sort(), 'Vehicle color key must drive purchase read/write and display read');

  const savedDisplayGet = t.row(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === ''
      && t.outgoing(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
        .some(edge => edge.zt === C.Expr_MathMax.NAME), 'dynamic saved-color display getter');
  assert(t.incoming(savedDisplayGet.brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState')
    .some(edge => edge.at === C.Var.NAME), 'Saved color display must use retained seated PlayerState');
  assert(t.rows.some(item => item.brick.g === terminalGrid && item.component.type === C.Expr_MakeColorSRGB.NAME), 'Packed score RGB decoder missing');
  assert(t.rows.some(item => item.brick.g === terminalGrid && item.component.type === C.Expr_ColorToHex.NAME), 'Saved color hex converter missing');

  // BUY requires selected row + complete seated session + supported vehicle.
  const splitter = t.row(C.InputSplitter.NAME, () => true, 'seat splitter');
  const space = t.one(t.outgoing(splitter.brick, C.InputSplitter.NAME, 'InputUp'), 'Space BUY guard');
  assert.equal(space.zt, C.Exec_Branch.NAME);
  const buyGuard = t.bricks.get(space.z);
  const buyCond = t.one(t.incoming(buyGuard, C.Exec_Branch.NAME, 'bCond'), 'BUY ready condition');
  assert.equal(buyCond.at, C.Expr_LogicalAND.NAME, 'BUY must use the combined readiness condition');
  const readyAnd = t.bricks.get(buyCond.a);
  const vehicleReadyEdge = t.one(t.incoming(readyAnd, C.Expr_LogicalAND.NAME, 'bInputB'), 'BUY vehicle readiness');
  assert.equal(vehicleReadyEdge.at, C.Var.NAME, 'BUY must require retained vehicle support');
  const firstAndEdge = t.one(t.incoming(readyAnd, C.Expr_LogicalAND.NAME, 'bInputA'), 'BUY selected/session readiness');
  assert.equal(firstAndEdge.at, C.Expr_LogicalAND.NAME);
  const firstAnd = t.bricks.get(firstAndEdge.a);
  const firstLeaves = [
    t.one(t.incoming(firstAnd, C.Expr_LogicalAND.NAME, 'bInputA'), 'BUY selected leaf'),
    t.one(t.incoming(firstAnd, C.Expr_LogicalAND.NAME, 'bInputB'), 'BUY session leaf'),
  ];
  assert(firstLeaves.some(edge => edge.at === C.Expr_CompareEqual.NAME), 'BUY must require selection index 5');
  assert(firstLeaves.some(edge => edge.at === C.Var.NAME), 'BUY must require a completed session');
  assert.equal(t.outgoing(buyGuard, C.Exec_Branch.NAME, 'ExecOutB').length, 0, 'Disabled BUY must be a no-op');

  // Added logic occupies only the newly expanded section and does not collide.
  const addedBricks = terminal.bricks.filter(brick => brick.g === terminalGrid && brick.data.position[1] >= 700);
  assert(addedBricks.length > 50, 'Expected complete organized session-data section');
  for (const brick of addedBricks) for (const candidate of terminal.bricks) {
    if (brick.key === candidate.key || brick.g !== candidate.g) continue;
    assert(!overlaps(brick, candidate), `Added session brick ${brick.key} overlaps ${candidate.key}`);
  }
  assertGridFitsPlane(terminal, terminalGrid, 'terminal session-data organization');

  // Truck v4 changes only the root custom-property contract. Every brick,
  // component, and wire from the already-working v3 vehicle is identical.
  assert.equal(truck.bricks.length, sourceTruck.bricks.length, 'Truck brick count changed');
  assert.equal(truck.edges.length, sourceTruck.edges.length, 'Truck wire count changed');
  assert.deepEqual(canonicalBrickRows(truck), canonicalBrickRows(sourceTruck), 'Truck brick/component logic changed');
  assert.deepEqual(canonicalEdges(truck), canonicalEdges(sourceTruck), 'Truck wire topology changed');
  const sourceVehicle = [...sourceTruck.r.entities()].find(entity => entity.data?.EntityTag === 'Vehicle');
  const outputVehicle = [...truck.r.entities()].find(entity => entity.data?.EntityTag === 'Vehicle');
  assert(sourceVehicle && outputVehicle, 'Tagged Truck1 vehicle root');
  assert.deepEqual(sourceVehicle.data.CustomProperties, { $map: [] }, 'Source Truck1 property baseline');
  assert.deepEqual(outputVehicle.data.CustomProperties, {
    $map: [
      ['VehicleName', { $variant: 'str', value: 'FlatbedTruck1' }],
      ['ColorLeaderboardKey', { $variant: 'str', value: 'Truck1Color' }],
    ],
  }, 'Truck1 terminal identity contract');
  assert.equal([...truck.r.entities()].filter(entity => entity.typeName.startsWith('Entity_Wheel_')).length, 4, 'Truck wheels changed');
  const protectedKeys = ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension', 'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1WheelDistance', 'Truck1Material'];
  for (const key of protectedKeys) assert.equal(truck.bricks.flatMap(brick => brick.comps)
    .filter(component => component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && component.data.Key === key).length, 1,
  `Protected truck getter ${key}`);

  console.log(JSON.stringify({
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    preservedSoundEmitters: outputEmitters.length,
    terminalBrickHandles: 0,
    truckOutput,
    truckBricks: truck.bricks.length,
    truckWires: truck.edges.length,
    truckBrickHandles: 33,
    vehicleName: 'FlatbedTruck1',
    colorLeaderboardKey: 'Truck1Color',
    checks: 'passed',
  }, null, 2));
  return { sourceTerminal, sourceTruck, terminal, truck };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_TERMINAL_INPUT,
  truckInput: process.argv[3] || DEFAULT_TRUCK_INPUT,
  terminalOutput: process.argv[4] || DEFAULT_TERMINAL_OUTPUT,
  truckOutput: process.argv[5] || DEFAULT_TRUCK_OUTPUT,
});

module.exports = test;
