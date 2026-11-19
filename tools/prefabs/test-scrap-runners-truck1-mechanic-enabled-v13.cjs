'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const testV12 = require('./test-scrap-runners-truck1-color-enabled-v12.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');
const { VEHICLES, CATEGORIES, PARTS, ENGINE_PROFILES, validate: validateCatalog } =
  require('./mechanic-shop-catalog-v1.cjs');

const OUTPUT = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-mechanic-enabled-v13.brz');
const BUILDER = path.join(__dirname,
  'build-scrap-runners-truck1-mechanic-enabled-v13.cjs');

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(row =>
    row.comp.type === type && predicate(row.comp.data, row.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0].brick || items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge =>
    edge.z === brick.key && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge =>
    edge.a === brick.key && edge.at === type && (!port || edge.p === port));
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  return { scene, bricks, rows, all, one, incoming, outgoing, label };
}

function assertEdge(t, source, sourceType, sourcePort, target, targetType, targetPort,
  label) {
  const matches = t.scene.edges.filter(edge => edge.a === source.key && edge.at === sourceType
    && edge.p === sourcePort && edge.z === target.key && edge.zt === targetType
    && edge.q === targetPort);
  assert.equal(matches.length, 1, `${label}: exact edge`);
}

const EXEC_PORTS = new Set(['ExecOut', 'ExecOutA', 'ExecOutB', 'Output', 'Pulse',
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

function isExecEdge(edge) {
  if (['ExecOut', 'ExecOutA', 'ExecOutB', 'Completed', 'Pulse',
    'OnChanged', 'OnRisingEdge', 'OnFallingEdge', 'bPulseOnChange'].includes(edge.p))
    return true;
  return edge.p === 'Output' && edge.at === C.BufferTicks.NAME;
}

function countExecPaths(scene, start, startPort, goal) {
  const first = scene.edges.filter(edge => edge.a === start.key && edge.p === startPort);
  const visit = (key, active) => {
    if (key === goal.key) return 1;
    assert(!active.has(key), `unexpected execution cycle through ${key}`);
    const nextActive = new Set(active).add(key);
    return scene.edges.filter(edge => edge.a === key && isExecEdge(edge))
      .reduce((sum, edge) => sum + visit(edge.z, nextActive), 0);
  };
  return first.reduce((sum, edge) => sum + visit(edge.z, new Set([start.key])), 0);
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

function assertTouchingRow(bricks, label) {
  const sorted = [...bricks].sort((a, b) =>
    a.data.position[0] - b.data.position[0]);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const previousRight = previous.data.position[0] + halfSize(previous)[0];
    const currentLeft = current.data.position[0] - halfSize(current)[0];
    assert.equal(currentLeft, previousRight,
      `${label}: ${previous.key} touches ${current.key}`);
  }
}

function isHandle(value) {
  return value && typeof value === 'object'
    && Number.isInteger(value.GridPersistentIndex)
    && value.ChunkIndex
    && Number.isInteger(value.ChunkIndex.X)
    && Number.isInteger(value.ChunkIndex.Y)
    && Number.isInteger(value.ChunkIndex.Z)
    && Number.isInteger(value.BrickIndexInChunk);
}

function walk(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  (Array.isArray(value) ? value : Object.values(value)).forEach(child => walk(child, fn));
}

function assertStoredHandles(scene) {
  const valid = new Set(scene.bricks.map(brick => brick.key));
  let count = 0;
  for (const brick of scene.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    assert(valid.has(key), `stored BrickHandle resolves: ${key}`);
    count++;
  });
  assert.equal(count, 33, 'all 33 stored Truck1 body BrickHandles remain valid');
  return count;
}

function variant(data, field, expected, label) {
  assert.equal(data[field].$variant, expected, `${label} ${field} variant`);
  return data[field].value;
}

function catalogConsistency(t, arrays) {
  const validated = validateCatalog();
  assert.equal(VEHICLES.length, 1, 'one vehicle catalog');
  assert.equal(CATEGORIES.length, 6, 'six Truck1 categories');
  assert.equal(PARTS.length, 28, 'twenty-eight Truck1 parts');
  assert(validated.vehicles.has('Truck1'), 'Truck1 is a validated catalog vehicle');

  const byCategory = new Map([
    ['Engine', arrays.engine],
    ['FuelTank', arrays.fuel],
    ['Suspension', arrays.suspension],
    ['WheelSpacing', arrays.wheel],
    ['SteerAngle', arrays.angle],
    ['SteerTurnSpeed', arrays.turnSpeed],
  ]);
  const scalarStat = new Map([
    ['FuelTank', 0], ['Suspension', 0], ['WheelSpacing', 0],
    ['SteerAngle', 0], ['SteerTurnSpeed', 0],
  ]);

  for (const [, record] of CATEGORIES) {
    const [categoryId, , , countText] = record.split('|');
    const array = byCategory.get(categoryId);
    assert(array, `truck array exists for ${categoryId}`);
    assert.equal(array.length, Number(countText), `${categoryId} catalog/array length`);
    const categoryParts = PARTS.filter(([key]) => key.startsWith(`Truck1.${categoryId}.`));
    assert.equal(categoryParts.length, array.length, `${categoryId} part rows`);
    const savedValues = [];
    categoryParts.forEach(([key, partRecord]) => {
      const fields = partRecord.split('|');
      const saved = Number(fields[1]);
      savedValues.push(saved);
      if (categoryId === 'Engine') {
        const profile = array[saved];
        assert.deepEqual(fields.slice(4).map(Number),
          [profile.X, profile.Y, profile.Z, profile.W], `${key} engine quaternion stats`);
      } else {
        assert.equal(Number(fields[4 + scalarStat.get(categoryId)]), array[saved],
          `${key} scalar stat matches truck array`);
      }
    });
    assert.deepEqual(savedValues.slice().sort((a, b) => a - b),
      Array.from({ length: array.length }, (_value, index) => index),
    `${categoryId} display rows preserve every saved array index`);
  }
}

function test({ output = OUTPUT, builder = BUILDER } = {}) {
  testV12();
  const bytes = fs.readFileSync(output);
  const scene = read(bytes);
  const t = api(scene);
  const placement = validatePlacement(bytes);
  assert(placement.strictOk, 'Truck1 v13 passes strict placement');
  assert.equal(scene.bricks.length, 302, 'optimized v13 expected brick count');
  assert.equal(scene.edges.length, 248, 'optimized v13 expected wire count');
  const storedHandles = assertStoredHandles(scene);

  const mechanicShell = t.one(t.all(C.TextDisplay.NAME,
    data => data.Text === 'MECHANIC\r\nINTERFACE'), 'mechanic interface shell');
  const ownerShell = t.one(t.all(C.TextDisplay.NAME,
    data => data.Text === 'OWNER /\r\nPLAYERSTATE'), 'owner shell');
  const appearanceShell = t.one(t.all(C.TextDisplay.NAME,
    data => data.Text === 'COLOR + MATERIAL\r\nCONTROLLER'), 'appearance shell');
  assert.equal(mechanicShell.g, ownerShell.g, 'mechanic and owner shells share green board');
  assert.equal(mechanicShell.g, appearanceShell.g,
    'mechanic and appearance shells share green board');
  const board = mechanicShell.g;
  const mechanicLink = scene.links.filter(link => link.key === mechanicShell.key);
  assert.equal(mechanicLink.length, 1, 'mechanic shell has one child link');
  const mechanicGrid = mechanicLink[0].grid;
  const appearanceLink = scene.links.filter(link => link.key === appearanceShell.key);
  assert.equal(appearanceLink.length, 1, 'appearance shell has one child link');
  const appearanceGrid = appearanceLink[0].grid;
  assert.deepEqual([appearanceShell, ownerShell, mechanicShell].map(brick =>
    brick.data.position), [[35, 5, 2], [45, 5, 2], [55, 5, 2]],
  'three controller shells form one touching on-grid row');
  assertTouchingRow([appearanceShell, ownerShell, mechanicShell], 'outer controller row');

  const headers = ['REQUEST + REPLY', 'RELOAD GUARDS', 'SAVED PROFILE LOAD',
    'SAFE PROFILE FALLBACKS'];
  for (const text of headers) assert.equal(t.all(C.TextDisplay.NAME,
    (data, brick) => brick.g === mechanicGrid && data.Text === text).length, 1,
  `${text} header exists once`);
  const mechanicGates = scene.bricks.filter(brick => brick.g === mechanicGrid
    && brick.comps.some(saved => saved.type.startsWith('BrickComponentType_')));
  const rows = new Map([5, -35, -75, -115].map(y => [y,
    mechanicGates.filter(brick => brick.data.position[1] === y)]));
  assert(rows.get(5).length >= 10, 'request/reply row is populated');
  assert(rows.get(-35).length >= 10, 'reload-guard row is populated');
  assert.equal(rows.get(-75).length, 2, 'saved-profile row contains buffer and union');
  assert.equal(rows.get(-115).length, 6, 'safe-profile row contains six typed fallbacks');
  assert.equal(mechanicGates.length,
    [...rows.values()].reduce((sum, row) => sum + row.length, 0),
  'every mechanic gate belongs to one labeled row');
  for (const [y, row] of rows) {
    assert(row.every(brick => brick.data.position[0] % 5 === 0
      && brick.data.position[2] === 2), `row ${y} is on-grid`);
    assertTouchingRow(row, `mechanic row ${y}`);
  }

  const request = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === mechanicGrid && data.EventName === 'SR.Mechanic.Request'),
  'mechanic request');
  const reply = t.one(t.all(C.Exec_SendCustomEventGlobal.NAME,
    (data, brick) => brick.g === mechanicGrid && data.EventName === 'SR.Mechanic.Reply'),
  'mechanic reply');
  const reload = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === mechanicGrid && data.EventName === 'SR.Mechanic.Reload'),
  'mechanic reload');
  const requestData = component(request, C.Event_CustomGlobal.NAME).data;
  const replyData = component(reply, C.Exec_SendCustomEventGlobal.NAME).data;
  const reloadData = component(reload, C.Event_CustomGlobal.NAME).data;
  assert.equal(requestData.bIsObjectEvent, true, 'request is a targeted object event');
  assert.equal(reloadData.bIsObjectEvent, true, 'reload is a targeted object event');
  variant(requestData, 'DataOut1', 'weak_object', 'request');
  variant(requestData, 'DataOut2', 'f64', 'request');
  assert.equal(variant(requestData, 'DataOut3', 'f64', 'request'), 0,
    'request protocol port is numeric');
  variant(replyData, 'DataIn1', 'weak_object', 'reply');
  variant(replyData, 'DataIn2', 'f64', 'reply');
  assert.equal(variant(replyData, 'DataIn3', 'str', 'reply'), 'Truck1',
    'reply catalog ID');
  assert.equal(variant(replyData, 'DataIn4', 'f64', 'reply'), 1,
    'reply profile revision');
  assert.equal(variant(replyData, 'DataIn5', 'f64', 'reply'), 1,
    'reply protocol revision');
  variant(replyData, 'DataIn6', 'str', 'reply');
  assert.deepEqual(['weak_object', 'f64', 'str', 'str', 'f64', 'str', 'f64', 'f64'],
    Array.from({ length: 8 }, (_, index) =>
      reloadData[`DataOut${index + 1}`].$variant), 'reload field types');

  const vehicleInput = t.one(t.all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === mechanicGrid && data.PortLabel === 'Vehicle Grid'),
  'mechanic vehicle input');
  const ownerInput = t.one(t.all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === mechanicGrid && data.PortLabel === 'Owner User ID'),
  'mechanic owner input');
  const ownerPlayerState = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'owner PlayerState output');
  const ownerUserId = t.one(t.all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'owner user-ID output');
  const vehicleGrid = t.one(t.all(C.ReadBrickGrid.NAME,
    (_data, brick) => t.outgoing(brick, C.ReadBrickGrid.NAME, 'BrickGrid')
      .some(edge => edge.z === vehicleInput.key)), 'vehicle-grid source');
  assertEdge(t, vehicleGrid, C.ReadBrickGrid.NAME, 'BrickGrid', vehicleInput,
    C.MicrochipInput.NAME, 'RER_Input', 'vehicle identity enters mechanic interface');
  assertEdge(t, ownerUserId, C.MicrochipOutput.NAME, 'RER_Output', ownerInput,
    C.MicrochipInput.NAME, 'RER_Input', 'stable owner ID enters mechanic interface');
  assertEdge(t, request, C.Event_CustomGlobal.NAME, 'DataOut1', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn1', 'reply echoes requested vehicle');
  assertEdge(t, request, C.Event_CustomGlobal.NAME, 'DataOut2', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2', 'reply echoes request nonce');
  assertEdge(t, ownerInput, C.MicrochipInput.NAME, 'RER_Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6', 'reply publishes stable owner ID');

  const requestBranch = t.label('Accept valid mechanic request');
  for (const text of ['Request targets this vehicle', 'Request protocol is version 1',
    'Stable owner ID is ready']) {
    assert(dataDependsOn(scene, requestBranch, t.label(text), 'bCond'),
      `${text} participates in request guard`);
  }
  const storeNonce = t.label('Store mechanic session nonce');
  assertEdge(t, request, C.Event_CustomGlobal.NAME, 'DataOut2', storeNonce,
    C.Exec_Var_Set.NAME, 'Value', 'accepted request stores terminal nonce');
  assert(execReachable(scene, requestBranch, 'ExecOutA', reply),
    'only accepted request reaches reply');

  const reloadBranch = t.label('Reload only an authorized saved profile');
  for (const text of ['Reload targets this vehicle',
    'Reload belongs to active terminal session', 'Reload catalog ID is Truck1',
    'Reload owner matches truck owner', 'Reload protocol is version 1']) {
    assert(dataDependsOn(scene, reloadBranch, t.label(text), 'bCond'),
      `${text} participates in reload guard`);
  }

  const keyOrder = ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension',
    'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1Wheelspacing'];
  const getters = keyOrder.map(key => t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === key), `${key} getter`));
  assert(getters.every(getter => getter.g === board),
    'all six mechanical getters remain on green board');
  for (const getter of getters) {
    const playerEdges = t.incoming(getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
    assert.equal(playerEdges.length, 1, `${component(getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key} has one PlayerState source`);
    assert.equal(playerEdges[0].a, ownerPlayerState.key,
      'retained owner PlayerState is the sole mechanical lookup authority');
    assertEdge(t, ownerPlayerState, C.MicrochipOutput.NAME, 'RER_Output', getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState',
      `${component(getter, C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key} owner input`);
  }

  const arrayGetByKey = new Map(keyOrder.map((key, index) => {
    const edges = t.outgoing(getters[index],
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value').filter(edge =>
      edge.zt === C.Exec_ArrayVar_Get.NAME && edge.q === 'Index');
    assert.equal(edges.length, 1, `${key} indexes exactly one profile array`);
    return [key, t.bricks.get(edges[0].z)];
  }));
  assert.equal(t.all(C.Exec_ArrayVar_Get.NAME).length, 6,
    'exactly the six mechanical profile Array Gets exist');
  const fallbackSpecs = [
    ['Truck1Engine', 'Engine stock fallback', 'Quat',
      ENGINE_PROFILES[0], C.Expr_SplitQuaternion.NAME, 'Input', null],
    ['Truck1Fueltank', 'Fuel tank stock fallback', 'i64', 20000,
      C.MicrochipOutput.NAME, 'RER_Input', 'Output Truck1Fueltank'],
    ['Truck1Suspension', 'Suspension stock fallback', 'i64', 500,
      C.MicrochipOutput.NAME, 'RER_Input', 'Output Truck1Suspension'],
    ['Truck1Steerangle', 'Steer angle stock fallback', 'i64', 30,
      C.MicrochipOutput.NAME, 'RER_Input', 'Output Truck1Steerangle'],
    ['Truck1Steerturnspeed', 'Steer turn speed stock fallback', 'f64', 0.05,
      C.MicrochipOutput.NAME, 'RER_Input', 'Output Truck1Steerturnspeed'],
    ['Truck1Wheelspacing', 'Wheel spacing stock fallback', 'f64', 0,
      C.MicrochipOutput.NAME, 'RER_Input', 'Output Truck1Wheelspacing'],
  ];
  for (const [key, fallbackLabel, type, stock, consumerType, consumerPort,
    consumerLabel] of fallbackSpecs) {
    const arrayGet = arrayGetByKey.get(key);
    const arrayGetData = component(arrayGet, C.Exec_ArrayVar_Get.NAME).data;
    const expected = { $variant: type, value: stock };
    assert.equal(arrayGetData.Index, 0, `${key} saved snapshot index is normalized`);
    assert.deepEqual(arrayGetData.Value, expected,
      `${key} saved snapshot value is its typed stock default`);
    assert.equal(arrayGetData.bOutOfBounds, false,
      `${key} saved snapshot begins in bounds`);

    const fallback = t.label(fallbackLabel);
    assert.equal(fallback.g, mechanicGrid, `${fallbackLabel} is contained by mechanic chip`);
    const fallbackData = component(fallback, C.Expr_Select.NAME).data;
    assert(fallbackData, `${fallbackLabel} is an Expr Select`);
    assert.equal(fallbackData.bSelectB, false, `${fallbackLabel} saved selector state`);
    assert.deepEqual(fallbackData.InputA, expected, `${fallbackLabel} typed live input`);
    assert.deepEqual(fallbackData.InputB, expected, `${fallbackLabel} exact stock fallback`);

    const rawValueEdges = t.outgoing(arrayGet, C.Exec_ArrayVar_Get.NAME, 'Value');
    const outOfBoundsEdges = t.outgoing(arrayGet,
      C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds');
    assert.equal(rawValueEdges.length, 1,
      `${key} raw Array Get Value has no direct vehicle consumer`);
    assert.equal(outOfBoundsEdges.length, 1,
      `${key} bOutOfBounds drives exactly one fallback selector`);
    assertEdge(t, arrayGet, C.Exec_ArrayVar_Get.NAME, 'Value', fallback,
      C.Expr_Select.NAME, 'InputA', `${key} live value enters selector`);
    assertEdge(t, arrayGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', fallback,
      C.Expr_Select.NAME, 'bSelectB', `${key} out-of-bounds chooses stock`);

    const safeEdges = t.outgoing(fallback, C.Expr_Select.NAME, 'Output');
    assert.equal(safeEdges.length, 1, `${key} has one safe vehicle consumer`);
    assert.equal(safeEdges[0].zt, consumerType, `${key} safe consumer type`);
    assert.equal(safeEdges[0].q, consumerPort, `${key} safe consumer port`);
    if (consumerLabel) assert.equal(component(t.bricks.get(safeEdges[0].z),
      C.MicrochipOutput.NAME).data.PortLabel, consumerLabel,
    `${key} safe value reaches its labeled vehicle output`);
    assert(!scene.edges.some(edge => edge.a === arrayGet.key && edge.p === 'Value'
      && edge.z === safeEdges[0].z), `${key} vehicle consumer cannot bypass fallback`);
  }

  const updateCar = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === board && data.EventName === 'UpdateCar'),
  'mechanical UpdateCar');
  assert(getters.every(getter => !scene.edges.some(edge => edge.a === updateCar.key
    && edge.p === 'DataOut1' && edge.z === getter.key && edge.q === 'PlayerState')),
  'UpdateCar Character never feeds a mechanical PlayerState port');
  const spawnBuffer = t.label('Wait for owner PlayerState resolution on spawn');
  assert.equal(component(spawnBuffer, C.BufferTicks.NAME).data.TicksToWait, 2,
    'spawn waits two ticks for owner resolution');
  assertEdge(t, updateCar, C.Event_CustomGlobal.NAME, 'ExecOut', spawnBuffer,
    C.BufferTicks.NAME, 'Input', 'UpdateCar enters owner-settle buffer');
  const loadUnion = t.label('Spawn or mechanic reload');
  assertEdge(t, spawnBuffer, C.BufferTicks.NAME, 'Output', loadUnion,
    C.Exec_Union.NAME, 'ExecA', 'settled spawn enters mechanical load union');
  assertEdge(t, reloadBranch, C.Exec_Branch.NAME, 'ExecOutA', loadUnion,
    C.Exec_Union.NAME, 'ExecB', 'authorized reload enters mechanical load union');
  for (const getter of getters) {
    assertEdge(t, loadUnion, C.Exec_Union.NAME, 'ExecOut', getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec', 'load union reaches getter');
    assert(execReachable(scene, reloadBranch, 'ExecOutA', getter),
      'valid reload reaches every mechanical getter');
  }
  for (const key of ['Truck1Color', 'Truck1Material']) {
    const appearanceGetter = t.one(t.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
      data => data.Key === key), `${key} getter`);
    assert(!execReachable(scene, reloadBranch, 'ExecOutA', appearanceGetter),
      `mechanic reload does not touch ${key}`);
  }
  const ownerResolver = t.label('Resolve spawning Character to Owner PlayerState');
  assert(!execReachable(scene, reloadBranch, 'ExecOutA', ownerResolver),
    'mechanic reload never restarts owner resolution');

  // The only inherited continuous loop was a 0.01-second dashboard-speed
  // Stopwatch. The optimized truck uses one occupancy-gated 0.1-second Clock
  // and the same vehicle-grid source already used by the mechanic protocol.
  assert.equal(t.all(C.Stopwatch.NAME).length, 0,
    'optimized Truck1 has no self-restarting Stopwatch');
  const speedGetter = t.one(t.all(C.Exec_Entity_GetSpeed.NAME), 'dashboard speed getter');
  const speedPulse = t.incoming(speedGetter, C.Exec_Entity_GetSpeed.NAME, 'Exec');
  assert.equal(speedPulse.length, 1, 'dashboard speed getter has one pulse source');
  const speedClock = t.bricks.get(speedPulse[0].a);
  const speedClockData = component(speedClock, C.Clock.NAME).data;
  assert(speedClockData, 'dashboard speed source is a Clock');
  assert.equal(speedPulse[0].p, 'Pulse', 'Clock pulse samples dashboard speed');
  assert.equal(speedClockData.IntervalSeconds, 0.1,
    'dashboard speed samples at ten hertz');
  const clockEnable = t.incoming(speedClock, C.Clock.NAME, 'bEnabled');
  assert.equal(clockEnable.length, 1, 'speed Clock has one enabled source');
  const occupiedInput = t.bricks.get(clockEnable[0].a);
  assert(component(occupiedInput, C.MicrochipInput.NAME),
    'speed Clock is enabled through a controller input');
  const occupiedDriver = t.incoming(occupiedInput, C.MicrochipInput.NAME, 'RER_Input');
  assert.equal(occupiedDriver.length, 1, 'occupied input has one physical source');
  assert.equal(occupiedDriver[0].p, 'bIsOccupied',
    'seat occupancy directly enables the speed Clock');
  assert(component(t.bricks.get(occupiedDriver[0].a), C.Seat.NAME),
    'speed Clock occupancy comes from the physical seat');
  assert(!scene.edges.some(edge => edge.a === speedClock.key && edge.z === speedClock.key),
    'speed Clock has no self-loop');
  const speedEntity = t.incoming(speedGetter, C.Exec_Entity_GetSpeed.NAME, 'Entity');
  assert.equal(speedEntity.length, 1, 'speed getter has one vehicle source');
  assert.equal(speedEntity[0].a, vehicleGrid.key,
    'speed and mechanic protocols reuse one Read Brick Grid');
  assert.equal(t.all(C.ReadBrickGrid.NAME,
    (_data, brick) => brick.g === speedGetter.g).length, 1,
  'drive controller contains one vehicle-grid reader');
  assert.equal(t.all(C.Rerouter.NAME,
    (_data, brick) => brick.g === speedGetter.g).length, 0,
  'drive controller has no pure forwarding rerouter');

  // Current color terminals use the request/reply protocol, so the legacy
  // custom-property publication path and its vehicle-grid port are gone.
  assert.equal(t.all(C.Exec_Entity_SetCustomProperty.NAME,
    data => ['CurrentColorScore', 'CurrentMaterialEnum'].includes(data.Key)).length, 0,
  'obsolete appearance custom properties are not published');
  assert.equal(t.all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Vehicle Grid').length, 0,
  'appearance controller has no unused vehicle-grid input');

  const colorClamps = t.all(C.Expr_MathClamp.NAME,
    (_data, brick) => brick.g === appearanceGrid);
  assert.equal(colorClamps.length, 1, 'saved RGB score uses one native clamp');
  const colorClamp = colorClamps[0].brick;
  const colorClampData = colorClamps[0].comp.data;
  assert.equal(variant(colorClampData, 'Min', 'i64', 'saved color clamp'), 0,
    'saved color clamp minimum');
  assert.equal(variant(colorClampData, 'Max', 'i64', 'saved color clamp'), 16777215,
    'saved color clamp maximum');
  assert.equal(t.outgoing(colorClamp, C.Expr_MathClamp.NAME, 'Output').length, 3,
    'one clamped RGB score feeds all three byte decoders');
  assert.equal(t.all(C.Expr_MathMin.NAME,
    (_data, brick) => brick.g === appearanceGrid).length, 0,
  'appearance controller has no redundant color minimum');
  assert.equal(t.all(C.Expr_MathMax.NAME,
    (_data, brick) => brick.g === appearanceGrid).length, 0,
  'appearance controller has no redundant color maximum');

  const materialSelects = t.all(C.Expr_Select.NAME, (data, brick) =>
    brick.g === appearanceGrid
      && data.InputA?.$variant === 'dynamic_enum'
      && data.InputB?.$variant === 'dynamic_enum'
      && data.InputA.value?.value === 0
      && data.InputB.value?.value === 4);
  assert.equal(materialSelects.length, 2,
    'saved and preview material each use one typed Select');
  for (const { brick: select } of materialSelects) {
    const condition = t.incoming(select, C.Expr_Select.NAME, 'bSelectB');
    const value = t.outgoing(select, C.Expr_Select.NAME, 'Output');
    assert.equal(condition.length, 1, 'material Select has one comparison condition');
    assert(component(t.bricks.get(condition[0].a), C.Expr_CompareEqual.NAME),
      'material Select condition is an equality comparison');
    assert.equal(value.length, 1, 'material Select has one retained setter');
    assert.equal(value[0].zt, C.Exec_Var_Set.NAME, 'material Select drives a Var setter');
    assert.equal(value[0].q, 'Value', 'material Select drives the setter value');
  }
  assert.equal(t.all(C.Exec_Branch.NAME,
    (_data, brick) => brick.g === appearanceGrid).length, 0,
  'appearance material decoding has no duplicate setter branches');

  // One event/load now produces exactly one callable body pass. The callable
  // contains 31 handles and three property setters: 93 writes per pass.
  assert.equal(t.all(C.Expr_ChangeDetector.NAME,
    (_data, brick) => brick.g === appearanceGrid).length, 0,
  'appearance controller has no duplicate change-detector refreshes');
  const bodyLoop = t.one(t.all(C.Microchip_ForEachArray.NAME,
    (_data, brick) => brick.g === appearanceGrid), 'appearance body loop');
  const bodyArrayEdge = t.incoming(bodyLoop, C.Microchip_ForEachArray.NAME, 'ArrayVarRef');
  assert.equal(bodyArrayEdge.length, 1, 'body loop has one BrickHandle array');
  const bodyArray = t.bricks.get(bodyArrayEdge[0].a);
  const handles = component(bodyArray, C.ArrayVar.NAME).data.Value.$array;
  assert.equal(handles.length, 31, 'appearance body loop has thirty-one handles');
  const bodyLink = scene.links.filter(link => link.key === bodyLoop.key);
  assert.equal(bodyLink.length, 1, 'appearance body loop has one callable body');
  const bodySetters = t.all(C.Exec_SetBrickProperty.NAME,
    (_data, brick) => brick.g === bodyLink[0].grid);
  assert.equal(bodySetters.length, 3,
    'appearance callable writes color, material, and intensity once per handle');
  assert.deepEqual(bodySetters.map(row => row.comp.data.Property).sort((a, b) => a - b),
    [1, 2, 3], 'appearance callable property set is unchanged');
  assert.equal(handles.length * bodySetters.length, 93,
    'one appearance body pass performs exactly ninety-three property writes');
  const bodyExec = t.incoming(bodyLoop, C.Microchip_ForEachArray.NAME, 'Exec');
  assert.equal(bodyExec.length, 1, 'appearance body loop has one buffered trigger');
  const bodyBuffer = t.bricks.get(bodyExec[0].a);
  assert.equal(component(bodyBuffer, C.BufferTicks.NAME).data.TicksToWait, 1,
    'appearance variables settle one tick before the body pass');
  const bodyBufferExec = t.incoming(bodyBuffer, C.BufferTicks.NAME, 'Input');
  assert.equal(bodyBufferExec.length, 1, 'body settle buffer has one convergence source');
  const bodyUnion = t.bricks.get(bodyBufferExec[0].a);
  assert(component(bodyUnion, C.Exec_Union.NAME),
    'saved and preview chains converge through one union');
  const bodyUnionInputs = t.incoming(bodyUnion, C.Exec_Union.NAME);
  assert.equal(bodyUnionInputs.length, 2, 'body union has one saved and one preview tail');
  assert(bodyUnionInputs.every(edge => component(t.bricks.get(edge.a), C.Exec_Var_Set.NAME)),
    'both body-union inputs come from completed intensity setters');

  const interfaceEvent = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === appearanceGrid
      && data.EventName === 'Interface with Vehicle'), 'appearance preview event');
  const restoreEvent = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === appearanceGrid
      && data.EventName === 'Restore Truck1Color'), 'appearance restore event');
  const appearanceRequest = t.one(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === appearanceGrid
      && data.EventName === 'SR.Appearance.Request'), 'appearance request event');
  assert.equal(countExecPaths(scene, interfaceEvent, 'ExecOut', bodyLoop), 1,
    'one preview event reaches exactly one body pass');
  assert.equal(countExecPaths(scene, restoreEvent, 'ExecOut', bodyLoop), 1,
    'one restore event reaches exactly one body pass');
  assert.equal(countExecPaths(scene, updateCar, 'ExecOut', bodyLoop), 1,
    'one spawn event reaches exactly one body pass');
  assert.equal(countExecPaths(scene, appearanceRequest, 'ExecOut', bodyLoop), 0,
    'read-only appearance requests never rewrite body bricks');

  const arraysByKey = new Map(t.all(C.ArrayVar.NAME,
    (_data, brick) => brick.g === board).map(({ brick, comp }) => [brick.key, comp.data.Value.$array]));
  const array = key => {
    const getArray = arrayGetByKey.get(key);
    const arrayEdge = t.incoming(getArray, C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
    assert.equal(arrayEdge.length, 1, `${key} array getter has one array source`);
    return arraysByKey.get(arrayEdge[0].a);
  };
  const arrays = {
    engine: array('Truck1Engine'),
    fuel: array('Truck1Fueltank'),
    suspension: array('Truck1Suspension'),
    angle: array('Truck1Steerangle'),
    turnSpeed: array('Truck1Steerturnspeed'),
    wheel: array('Truck1Wheelspacing'),
  };
  assert.deepEqual(arrays.engine, ENGINE_PROFILES, 'engine profiles');
  assert.deepEqual(arrays.fuel, [20000, 25000, 30000], 'fuel profiles');
  assert.deepEqual(arrays.suspension, [500, 1000, 1500, 2000, 2500],
    'suspension profiles');
  assert.deepEqual(arrays.wheel, [0, 2.5, 5, 7.5, 10], 'wheel-spacing profiles');
  assert.deepEqual(arrays.angle, [30, 35, 40, 45, 50, 55, 60],
    'steering-angle profiles');
  assert.deepEqual(arrays.turnSpeed, [0.05, 0.1, 0.2],
    'steering-turn-speed profiles');
  catalogConsistency(t, arrays);

  assert.equal(t.all(C.Event_CustomGlobal.NAME,
    data => /^SR\.Mechanic\./.test(data.EventName || '')).length, 2,
  'only request and reload mechanic receivers exist');
  assert.equal(t.all(C.Exec_SendCustomEventGlobal.NAME,
    data => /^SR\.Mechanic\./.test(data.EventName || '')).length, 1,
  'only mechanic reply sender exists');
  assert(t.all(C.Event_CustomGlobal.NAME,
    (data, brick) => /^SR\.Mechanic\./.test(data.EventName || '')
      && brick.g !== mechanicGrid).length === 0,
  'all mechanic receivers are contained in the mechanic interface');

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v13 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), bytes, 'checked output matches fresh build');
  assert.equal(first.remappedBrickHandles, 33, 'builder remaps all stored BrickHandles');

  const result = {
    output,
    bricks: scene.bricks.length,
    wires: scene.edges.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    storedBrickHandles: storedHandles,
    mechanicProtocol: 'targeted request + guarded targeted reload',
    safeProfileFallbacks: fallbackSpecs.length,
    catalogProfiles: { vehicles: VEHICLES.length, categories: CATEGORIES.length, parts: PARTS.length },
    strictPlacement: true,
    deterministic: true,
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) test();
module.exports = test;
