'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V10_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v10.brz');
const DEFAULT_V5_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v5.brz');
const DEFAULT_V11_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v11.brz');
const DEFAULT_V6_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v6.brz');
const DEFAULT_V11_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v11.cjs');

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

function assertFiniteScalars(value, location = 'root', seen = new Set()) {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${location} must be finite, got ${value}`);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) =>
    assertFiniteScalars(item, `${location}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value))
    assertFiniteScalars(item, `${location}.${key}`, seen);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function collectBrickHandles(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (Number.isInteger(value.GridPersistentIndex) && value.ChunkIndex
    && Number.isInteger(value.ChunkIndex.X) && Number.isInteger(value.ChunkIndex.Y)
    && Number.isInteger(value.ChunkIndex.Z) && Number.isInteger(value.BrickIndexInChunk)
    && value.BrickIndexInChunk !== 0xffffffff) {
    result.push(JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]));
  }
  if (Array.isArray(value)) value.forEach(child => collectBrickHandles(child, result));
  else Object.values(value).forEach(child => collectBrickHandles(child, result));
  return result;
}

function execReachable(scene, start, target, limit = 4000) {
  const t = api(scene);
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    for (const edge of scene.edges) {
      if (edge.a !== key || !isExecPort(t, t.source(edge), edge.at, edge.p)
        || !isExecPort(t, t.target(edge), edge.zt, edge.q)) continue;
      if (!seen.has(edge.z)) {
        seen.add(edge.z);
        queue.push(edge.z);
      }
    }
  }
  return seen.has(target.key);
}

function isExecPort(t, brick, type, port) {
  const saved = component(brick, type);
  if (saved?.data?.[port]?.$variant === 'WireGraphExec') return true;
  if (type === C.BufferTicks.NAME && ['Input', 'Output'].includes(port)) return true;
  if (/^(?:Exec|Pulse|Expired|OnRisingEdge|OnFallingEdge|bPulseOnChange)/.test(port)) return true;
  // Microchip executable ports are identified by their saved callable variant.
  if (/^RER_/.test(port)) {
    const fields = ['CallableDefault', 'CallableMirror', 'CallableResult'];
    return fields.some(field => saved?.data?.[field]?.$variant === 'WireGraphExec');
  }
  return false;
}

function dataReachableFromPort(t, start, type, port, target, limit = 4000) {
  const initial = t.outgoing(start, type, port).filter(edge =>
    !isExecPort(t, t.source(edge), edge.at, edge.p)
    && !isExecPort(t, t.target(edge), edge.zt, edge.q));
  const queue = initial.map(edge => edge.z);
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || isExecPort(t, brick, edge.at, edge.p)
        || isExecPort(t, t.target(edge), edge.zt, edge.q)) continue;
      if (!seen.has(edge.z)) {
        seen.add(edge.z);
        queue.push(edge.z);
      }
    }
  }
  return seen.has(target.key);
}

function dataReachableOnly(t, start, target, limit = 4000) {
  const initial = t.scene.edges.filter(edge => edge.a === start.key
    && !isExecPort(t, start, edge.at, edge.p)
    && !isExecPort(t, t.target(edge), edge.zt, edge.q));
  const queue = initial.map(edge => edge.z);
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    const brick = t.bricks.get(key);
    for (const edge of t.scene.edges) {
      if (edge.a !== key || isExecPort(t, brick, edge.at, edge.p)
        || isExecPort(t, t.target(edge), edge.zt, edge.q)) continue;
      if (!seen.has(edge.z)) {
        seen.add(edge.z);
        queue.push(edge.z);
      }
    }
  }
  return seen.has(target.key);
}

function dataReachable(scene, start, target, limit = 4000) {
  const queue = [start.key];
  const seen = new Set(queue);
  for (let steps = 0; queue.length && steps < limit; steps++) {
    const key = queue.shift();
    if (key === target.key) return true;
    for (const edge of scene.edges) if (edge.a === key && !seen.has(edge.z)) {
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return seen.has(target.key);
}

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  return { edge, brick: t.source(edge), comp: component(t.source(edge), edge.at) };
}

function rowStateVariable(t, formatterLabel) {
  const formatter = t.row(C.Expr_String_FormatText.NAME,
    data => new RegExp(`^\\{A\\}${formatterLabel}`).test(data.FormatString),
    `${formatterLabel} formatter`);
  const rounded = sourceOf(t, formatter.brick, C.Expr_String_FormatText.NAME,
    'InputB', `${formatterLabel} rounded display value`);
  assert.equal(rounded.comp?.type, C.Expr_Round.NAME,
    `${formatterLabel} display value is rounded`);
  const variable = sourceOf(t, rounded.brick, C.Expr_Round.NAME,
    'Input', `${formatterLabel} state variable`);
  assert.equal(variable.comp?.type, C.Var.NAME, `${formatterLabel} state uses a Var`);
  return variable.brick;
}

function assertReplyComparison(t, reply, port, label) {
  const outgoing = t.outgoing(reply, C.Event_CustomGlobal.NAME, port)
    .filter(edge => edge.zt === C.Expr_CompareEqual.NAME);
  assert.equal(outgoing.length, 1, `${label} has one equality check`);
  const compare = t.target(outgoing[0]);
  assert.equal(t.incoming(compare, C.Expr_CompareEqual.NAME).length, 2,
    `${label} compare has reply and current-state operands`);
  return compare;
}

function assertRequestEntitySource(t, entered, request) {
  const target = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'Target', 'appearance request Target');
  const echoed = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn1', 'appearance request entity token');
  assert.equal(target.brick.key, echoed.brick.key,
    'Request target and echoed identity use the same current vehicle source');
  if (target.brick.key === entered.key) {
    assert.equal(target.edge.p, 'Entity', 'Request targets the literal entered entity');
    return target.brick;
  }
  if (target.comp?.type === C.Exec_ArrayVar_Get.NAME) {
    assert.equal(target.edge.p, 'Value', 'Request targets the retained vehicle array value');
    assert.equal(echoed.edge.p, 'Value', 'Request echoes the retained vehicle array value');
    assert.equal(valueOf(target.comp.data.Index), 0,
      'Request reads the current vehicle from array index zero');
    const array = sourceOf(t, target.brick, C.Exec_ArrayVar_Get.NAME,
      'ArrayVarRef', 'appearance request vehicle array');
    assert.equal(array.comp?.type, C.ArrayVar.NAME,
      'Delayed request reads the terminal vehicle Array Var');
    const inserts = t.outgoing(array.brick, C.ArrayVar.NAME, 'ArrayVarRef')
      .filter(edge => edge.zt === C.Exec_ArrayVar_Insert.NAME)
      .map(edge => t.target(edge))
      .filter(insert => t.incoming(insert, C.Exec_ArrayVar_Insert.NAME, 'Value')
        .some(edge => edge.a === entered.key && edge.p === 'Entity'));
    assert.equal(inserts.length, 1,
      'Vehicle array is populated from the literal ZoneEntered.Entity');
    assert(execReachable(t.scene, entered, inserts[0]),
      'ZoneEntered execution inserts the current vehicle');
    assert(execReachable(t.scene, inserts[0], target.brick),
      'Vehicle insertion completes before the delayed request reads index zero');
    return target.brick;
  }
  assert.equal(target.comp?.type, C.Var.NAME,
    'Request target is ZoneEntered.Entity, the stored vehicle Var, or its retained array value');
  const setters = t.outgoing(target.brick, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge))
    .filter(setter => t.incoming(setter, C.Exec_Var_Set.NAME, 'Value')
      .some(edge => edge.a === entered.key && edge.p === 'Entity'));
  assert.equal(setters.length, 1, 'Current vehicle Var is written from ZoneEntered.Entity');
  assert(execReachable(t.scene, entered, setters[0]),
    'ZoneEntered execution stores current vehicle before requesting appearance');
  return target.brick;
}

function assertVisibleLayoutPreserved(v10, v11) {
  const oldT = api(v10);
  const newT = api(v11);
  const oldScreen = oldT.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v10 physical screen');
  const newScreen = newT.row(C.TextDisplay.NAME,
    data => /PROCESS: COLOR_CUSTOMIZER/.test(data.Text || ''), 'v11 physical screen');
  assert.deepEqual(newScreen.brick.data, oldScreen.brick.data,
    'v11 preserves the physical screen brick layout');
  assert.deepEqual(newScreen.comp.data, oldScreen.comp.data,
    'v11 preserves the physical screen fallback presentation');
}

function test({
  terminalInput = DEFAULT_V10_TERMINAL,
  truckInput = DEFAULT_V5_TRUCK,
  terminalOutput = DEFAULT_V11_TERMINAL,
  truckOutput = DEFAULT_V6_TRUCK,
  builder = DEFAULT_V11_BUILDER,
} = {}) {
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);
  const baselineTerminal = read(fs.readFileSync(terminalInput));
  const baselineTruck = read(fs.readFileSync(truckInput));
  const t = api(terminal);
  const v = api(truck);

  assert(validate(terminalBytes).strictOk, 'v11 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'v6 truck passes strict placement');
  assertFiniteScalars(terminal.bricks, 'terminal.bricks');
  assertFiniteScalars(terminal.edges, 'terminal.edges');
  assertFiniteScalars(truck.bricks, 'truck.bricks');
  assertFiniteScalars(truck.edges, 'truck.edges');
  assertVisibleLayoutPreserved(baselineTerminal, terminal);

  // Appearance work must not alter Truck1's physical build or any of its
  // existing vehicle-stat leaderboard gates. Stored body references are
  // especially important because prefab rewrites renumber brick handles.
  const canonicalLeaderboard = scene => scene.bricks.flatMap(brick => brick.comps)
    .filter(comp => /Leaderboard/i.test(comp.type))
    .map(comp => JSON.stringify([comp.type, canonical(comp.data)])).sort();
  assert.deepEqual(canonicalLeaderboard(truck), canonicalLeaderboard(baselineTruck),
    'All pre-existing Truck1 leaderboard gates remain unchanged');
  const canonicalPhysical = scene => scene.bricks.filter(brick => brick.g <= 10)
    .map(brick => JSON.stringify([brick.g, brick.data.asset, brick.data.position,
      brick.data.size, brick.data.color, brick.data.material,
      brick.comps.map(comp => [comp.type, canonical(comp.data)])])).sort();
  assert.deepEqual(canonicalPhysical(truck), canonicalPhysical(baselineTruck),
    'Truck1 physical body and attached components remain unchanged');
  const handles = truck.bricks.flatMap(brick => brick.comps)
    .flatMap(comp => collectBrickHandles(comp.data));
  const baselineHandles = baselineTruck.bricks.flatMap(brick => brick.comps)
    .flatMap(comp => collectBrickHandles(comp.data));
  assert.equal(handles.length, baselineHandles.length, 'Stored body BrickHandle count');
  assert.equal(handles.length, 33, 'Truck1 retains all 33 stored BrickHandles');
  const validHandleTargets = new Set(truck.bricks.map(brick => brick.key));
  handles.forEach(handle => assert(validHandleTargets.has(handle),
    `Stored BrickHandle resolves after rewrite: ${handle}`));

  const entered = t.row(C.EntityZoneEvent_Entered.NAME, () => true, 'vehicle zone entered').brick;
  const left = t.row(C.EntityZoneEvent_Left.NAME, () => true, 'vehicle zone left').brick;
  assert.equal(component(entered, C.EntityZoneEvent_Entered.NAME).data.TagFilter, 'Vehicle',
    'ZoneEntered accepts only the tagged vehicle root');
  assert.equal(component(left, C.EntityZoneEvent_Left.NAME).data.TagFilter, 'Vehicle',
    'ZoneLeft accepts only the tagged vehicle root');

  // The old custom-property pull was the failed architecture. v11 must ask the
  // exact entered entity and accept only its correlated response.
  assert.equal(t.all(C.Exec_Entity_GetCustomProperty.NAME,
    data => ['CurrentColorScore', 'CurrentMaterialEnum'].includes(data.Key)).length, 0,
  'v11 no longer relies on pre-published vehicle appearance properties');
  const request = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request', 'appearance request sender').brick;
  const currentVehicle = assertRequestEntitySource(t, entered, request);
  assert(execReachable(terminal, entered, request), 'ZoneEntered sends the appearance request');
  const requestNonce = sourceOf(t, request, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn2', 'appearance request nonce');
  assert(['i64', undefined].includes(requestNonce.comp?.data?.Value?.$variant),
    'Appearance request nonce is an integer state or integer expression');

  const reply = t.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'appearance reply receiver').brick;
  assert.equal(component(reply, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, false,
    'Appearance reply is global and filtered explicitly');
  assert.equal(component(reply, C.Event_CustomGlobal.NAME).data.DataOut1?.$variant, 'weak_object',
    'Reply Data1 carries the echoed vehicle entity');
  assert.equal(component(reply, C.Event_CustomGlobal.NAME).data.DataOut2?.$variant, 'i64',
    'Reply Data2 carries the request nonce');
  assert.equal(component(reply, C.Event_CustomGlobal.NAME).data.DataOut3?.$variant, 'i64',
    'Reply Data3 carries the live rendered color packed as an RGB score');
  assert(['f64', 'i64'].includes(component(reply, C.Event_CustomGlobal.NAME)
    .data.DataOut4?.$variant), 'Reply Data4 carries actual material enum 0/4');
  assert(['f64', 'i64'].includes(component(reply, C.Event_CustomGlobal.NAME)
    .data.DataOut5?.$variant), 'Reply Data5 carries raw material intensity 0..255');

  const identityCompare = assertReplyComparison(t, reply, 'DataOut1', 'reply identity');
  const nonceCompare = assertReplyComparison(t, reply, 'DataOut2', 'reply nonce');
  const nonceStateEdge = t.one(t.incoming(nonceCompare, C.Expr_CompareEqual.NAME)
    .filter(edge => edge.a !== reply.key), 'current nonce compare operand');
  const nonceState = t.source(nonceStateEdge);
  assert.equal(component(nonceState, C.Var.NAME)?.data.Value?.$variant, 'i64',
    'Reply validation uses the retained i64 nonce Var');
  assert(dataReachable(terminal, nonceState, requestNonce.brick)
    || requestNonce.brick.key === nonceState.key,
  'Request nonce is derived from the retained nonce state');
  const identityStateEdge = t.one(t.incoming(identityCompare, C.Expr_CompareEqual.NAME)
    .filter(edge => edge.a !== reply.key), 'current vehicle compare operand');
  const identityState = t.source(identityStateEdge);
  if (identityState.key !== currentVehicle.key) {
    assert.equal(component(identityState, C.Exec_ArrayVar_Get.NAME)?.type,
      C.Exec_ArrayVar_Get.NAME,
      'Reply identity is read from the current vehicle array');
    const identityArray = sourceOf(t, identityState, C.Exec_ArrayVar_Get.NAME,
      'ArrayVarRef', 'reply current vehicle array');
    const insert = t.row(C.Exec_ArrayVar_Insert.NAME,
      (_data, brick) => t.incoming(brick, C.Exec_ArrayVar_Insert.NAME, 'Value')
        .some(edge => edge.a === entered.key && edge.p === 'Entity'),
    'entered vehicle array insert').brick;
    const insertArray = sourceOf(t, insert, C.Exec_ArrayVar_Insert.NAME,
      'ArrayVarRef', 'entered vehicle array');
    assert.equal(identityArray.brick.key, insertArray.brick.key,
      'Reply identity reads the same array that stores ZoneEntered.Entity');
  }
  assert(dataReachable(terminal, nonceState, nonceCompare),
    'Reply nonce is compared with the current request nonce');
  const replyGuard = t.row(C.Exec_Branch.NAME, (_data, brick) => {
    if (!execReachable(terminal, reply, brick)) return false;
    const condition = t.incoming(brick, C.Exec_Branch.NAME, 'bCond');
    if (condition.length !== 1) return false;
    const root = t.source(condition[0]);
    return dataReachable(terminal, identityCompare, root)
      && dataReachable(terminal, nonceCompare, root);
  }, 'appearance reply guard').brick;

  const replySnapshot = (port, variant, label) => {
    const setters = t.outgoing(reply, C.Event_CustomGlobal.NAME, port)
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value')
      .map(edge => t.target(edge));
    assert.equal(setters.length, 1, `${label} has one reply snapshot setter`);
    assert(execReachable(terminal, replyGuard, setters[0]),
      `${label} snapshot executes only after reply validation`);
    const state = sourceOf(t, setters[0], C.Exec_Var_Set.NAME,
      'VarRef', `${label} snapshot Var`).brick;
    assert.equal(component(state, C.Var.NAME)?.data.Value?.$variant, variant,
      `${label} snapshot type`);
    return { setter: setters[0], state };
  };
  const colorSnapshot = replySnapshot('DataOut3', 'i64', 'Live color score');
  const materialSnapshot = replySnapshot('DataOut4', 'f64', 'Live material');
  const intensitySnapshot = replySnapshot('DataOut5', 'f64', 'Live intensity');

  const syncOutput = t.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Appearance Sync', 'terminal Appearance Sync output').brick;
  const syncBuffer = sourceOf(t, syncOutput, C.MicrochipOutput.NAME,
    'RER_Input', 'buffered reply synchronization');
  assert.equal(syncBuffer.comp?.type, C.BufferTicks.NAME,
    'Accepted appearance reply settles through BufferTicks');
  assert.equal(valueOf(syncBuffer.comp.data.TicksToWait), 1,
    'Accepted appearance reply settles for exactly one tick');
  const bufferInput = sourceOf(t, syncBuffer.brick, C.BufferTicks.NAME,
    'Input', 'appearance reply settle input');
  assert(execReachable(terminal, replyGuard, bufferInput.brick),
    'Only the correlated reply snapshot chain starts synchronization');
  assert(execReachable(terminal, colorSnapshot.setter, syncBuffer.brick)
    && execReachable(terminal, materialSnapshot.setter, syncBuffer.brick)
    && execReachable(terminal, intensitySnapshot.setter, syncBuffer.brick),
  'Color, material, and intensity are snapshotted before the one-tick settle');

  const splitter = t.row(C.InputSplitter.NAME, () => true, 'terminal InputSplitter');
  const coreGrid = splitter.brick.g;
  const coreSync = t.row(C.MicrochipInput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Appearance Sync',
    'core Appearance Sync input').brick;
  const hue = rowStateVariable(t, 'HUE');
  const saturation = rowStateVariable(t, 'SATURATION');
  const brightness = rowStateVariable(t, 'BRIGHTNESS');
  const hsvSetters = [hue, saturation, brightness].map((variable, index) => {
    const setters = t.outgoing(variable, C.Var.NAME, 'VarRef')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
      .map(edge => t.target(edge))
      .filter(setter => execReachable(terminal, coreSync, setter)
        && dataReachableOnly(t, colorSnapshot.state, setter));
    assert.equal(setters.length, 1,
      `Live reply color has one synchronized HSV setter ${index}`);
    return setters[0];
  });
  assert(hsvSetters.every((setter, index) => index === 0
    || execReachable(terminal, hsvSetters[index - 1], setter)),
  'Live color initialization writes H/S/B as one ordered transaction');

  const materialOutput = t.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Material',
    'core Material output').brick;
  const materialSource = sourceOf(t, materialOutput, C.MicrochipOutput.NAME,
    'RER_Input', 'core material state').brick;
  const materialSetters = t.outgoing(materialSource, component(materialSource, C.Var.NAME)
    ? C.Var.NAME : component(materialSource, C.Expr_Select.NAME)?.type, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge))
    .filter(setter => execReachable(terminal, coreSync, setter)
      && dataReachableFromPort(t, reply, C.Event_CustomGlobal.NAME, 'DataOut4', setter));
  // If the public output is mapped by a Select, locate the authoritative Var
  // through the synchronized setter rather than depending on the formatter.
  const fallbackMaterialSetters = t.all(C.Exec_Var_Set.NAME,
    (_data, brick) => brick.g === coreGrid
      && execReachable(terminal, coreSync, brick)
      && dataReachableOnly(t, materialSnapshot.state, brick));
  const syncedMaterial = materialSetters.length ? materialSetters
    : fallbackMaterialSetters.map(item => item.brick);
  assert.equal(syncedMaterial.length, 1,
    'Live reply material has one synchronized Material setter');

  const intensityOutput = t.row(C.MicrochipOutput.NAME,
    (data, brick) => brick.g === coreGrid && data.PortLabel === 'Material Intensity',
    'core Material Intensity output').brick;
  const intensityStates = t.all(C.Var.NAME, (data, brick) => brick.g === coreGrid
    && data.Value?.$variant === 'f64' && dataReachableOnly(t, brick, intensityOutput));
  assert.equal(intensityStates.length, 1,
    'One authoritative core Var stores the 0..10 intensity step');
  const intensityState = intensityStates[0].brick;
  const intensitySyncSetters = t.outgoing(intensityState, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge))
    .filter(setter => execReachable(terminal, coreSync, setter)
      && dataReachableOnly(t, intensitySnapshot.state, setter));
  assert.equal(intensitySyncSetters.length, 1,
    'Live reply intensity has one synchronized intensity-step setter');
  const intensitySyncSetter = intensitySyncSetters[0];
  const replyIntensityChain = type => t.all(type, (_data, brick) =>
    dataReachableOnly(t, intensitySnapshot.state, brick)
      && dataReachableOnly(t, brick, intensitySyncSetter));
  const rawToStep = replyIntensityChain(C.Expr_MathDivide.NAME).filter(({ comp }) =>
    [valueOf(comp.data.InputA), valueOf(comp.data.InputB)].includes(25.5));
  assert.equal(rawToStep.length, 1,
    'Reply raw intensity converts to a 0..10 step with division by 25.5');
  assert.equal(replyIntensityChain(C.Expr_Round.NAME).length, 1,
    'Reply intensity step is rounded');
  assert(replyIntensityChain(C.Expr_MathMax.NAME).some(({ comp }) =>
    [valueOf(comp.data.InputA), valueOf(comp.data.InputB)].includes(0)),
  'Reply intensity step has a lower clamp at zero');
  assert(replyIntensityChain(C.Expr_MathMin.NAME).some(({ comp }) =>
    [valueOf(comp.data.InputA), valueOf(comp.data.InputB)].includes(10)),
  'Reply intensity step has an upper clamp at ten');

  // appearanceReady prevents the picker defaults from being pushed while the
  // request is outstanding. Entry and exit reset it; only the final accepted
  // sync transaction sets it true.
  const readyCandidates = t.all(C.Var.NAME, data => data.Value?.$variant === 'Bool'
    && valueOf(data.Value) === false).map(item => item.brick).filter(variable => {
    const setters = t.outgoing(variable, C.Var.NAME, 'VarRef')
      .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => t.target(edge));
    const falseEntry = setters.some(setter => valueOf(component(setter,
      C.Exec_Var_Set.NAME).data.Value) === false && execReachable(terminal, entered, setter));
    const falseExit = setters.some(setter => valueOf(component(setter,
      C.Exec_Var_Set.NAME).data.Value) === false && execReachable(terminal, left, setter));
    const trueAfterSync = setters.some(setter => valueOf(component(setter,
      C.Exec_Var_Set.NAME).data.Value) === true
      && execReachable(terminal, intensitySyncSetter, setter));
    return falseEntry && falseExit && trueAfterSync;
  });
  assert.equal(readyCandidates.length, 1,
    'One false-by-default appearanceReady Var brackets the handshake');
  const appearanceReady = readyCandidates[0];
  const readySetters = t.outgoing(appearanceReady, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => t.target(edge));
  const readyTrue = readySetters.filter(setter =>
    valueOf(component(setter, C.Exec_Var_Set.NAME).data.Value) === true);
  assert.equal(readyTrue.length, 1, 'Only one setter marks appearance synchronized');
  for (const setter of [...hsvSetters, syncedMaterial[0], intensitySyncSetter])
    assert(execReachable(terminal, setter, readyTrue[0]),
      'appearanceReady becomes true only after every appearance state is initialized');

  const preview = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'live vehicle preview sender').brick;
  assert(!execReachable(terminal, coreSync, preview),
    'Appearance initialization never echoes a preview back to the truck');
  const previewMaterial = sourceOf(t, preview, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn2', 'preview material');
  assert.equal(previewMaterial.comp?.type, C.MicrochipOutput.NAME,
    'Preview material comes from a public terminal output');
  assert.equal(previewMaterial.comp.data.PortLabel, 'Material',
    'Preview Data2 carries Material');
  const previewIntensity = sourceOf(t, preview, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn3', 'preview material intensity');
  assert.equal(previewIntensity.comp?.type, C.MicrochipOutput.NAME,
    'Preview intensity comes from a public terminal output');
  assert.equal(previewIntensity.comp.data.PortLabel, 'Material Intensity',
    'Preview Data3 carries Material Intensity');
  const previewExec = sourceOf(t, preview, C.Exec_SendCustomEventGlobal.NAME,
    'ExecIn', 'preview readiness guard');
  assert.equal(previewExec.comp?.type, C.Exec_Branch.NAME,
    'Live preview execution is gated by a branch');
  const previewCond = sourceOf(t, previewExec.brick, C.Exec_Branch.NAME,
    'bCond', 'preview readiness condition').brick;
  assert(dataReachable(terminal, appearanceReady, previewCond),
    'Live preview guard requires appearanceReady');

  const restore = t.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color', 'zone-exit appearance restore').brick;
  assert(t.incoming(restore, C.Exec_SendCustomEventGlobal.NAME, 'Target')
    .some(edge => edge.a === left.key && edge.p === 'Entity'),
  'Zone exit restores the literal leaving vehicle');
  assert(execReachable(terminal, left, restore), 'Zone exit triggers saved appearance restore');
  const nonceExitSetters = t.outgoing(nonceState, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.target(edge))
    .filter(setter => execReachable(terminal, left, setter));
  assert(nonceExitSetters.length >= 1,
    'Zone exit invalidates the request nonce so late replies cannot apply');

  // Truck side of the protocol: targeted request in, one global reply out.
  const truckRequest = v.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request', 'truck appearance request receiver').brick;
  assert.equal(component(truckRequest, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true,
    'Truck receives the request as a targeted object event');
  const truckReply = v.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply', 'truck appearance reply sender').brick;
  assert.equal(v.incoming(truckReply, C.Exec_SendCustomEventGlobal.NAME, 'Target').length, 0,
    'Truck reply is global; terminal filters it by entity and nonce');
  assert(execReachable(truck, truckRequest, truckReply),
    'Appearance request execution sends the reply');
  const echoedEntity = sourceOf(v, truckReply, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn1', 'truck reply entity echo');
  assert.equal(echoedEntity.brick.key, truckRequest.key);
  assert.equal(echoedEntity.edge.p, 'DataOut1', 'Truck echoes request entity token');
  const echoedNonce = sourceOf(v, truckReply, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn2', 'truck reply nonce echo');
  assert.equal(echoedNonce.brick.key, truckRequest.key);
  assert.equal(echoedNonce.edge.p, 'DataOut2', 'Truck echoes request nonce');

  const bodyColorSetter = v.row(C.Exec_SetBrickProperty.NAME,
    data => data.Property === 1, 'truck body color setter').brick;
  const bodyMaterialSetter = v.row(C.Exec_SetBrickProperty.NAME,
    data => data.Property === 2, 'truck body material setter').brick;
  const liveColor = v.row(C.Var.NAME,
    data => data.Value?.$variant === 'LinearColor', 'truck live rendered color Var').brick;
  const liveMaterial = v.row(C.Var.NAME,
    data => data.Value?.$variant === 'dynamic_enum'
      && data.Value.value?.$enum === 'EBrickMaterial',
    'truck live rendered material Var').brick;
  assert(dataReachable(truck, liveColor, bodyColorSetter),
    'Live Color Var reaches the body color property setter');
  assert(dataReachable(truck, liveMaterial, bodyMaterialSetter),
    'Live Material Var reaches the body material property setter');
  const packedColor = sourceOf(v, truckReply, C.Exec_SendCustomEventGlobal.NAME,
    'DataIn3', 'truck packed live color reply').brick;
  assert(component(packedColor, C.Expr_MathAdd.NAME),
    'Truck reply Data3 ends in RGB score addition');
  const colorSplit = v.row(C.Expr_SplitColorSRGB.NAME, (_data, brick) =>
    dataReachableOnly(v, liveColor, brick), 'live rendered color SRGB split').brick;
  const channelMultiplier = (port, constant) => {
    const edges = v.outgoing(colorSplit, C.Expr_SplitColorSRGB.NAME, port)
      .filter(edge => edge.zt === C.Expr_MathMultiply.NAME);
    assert.equal(edges.length, 1, `Live ${port} has one score multiplier`);
    const multiply = v.target(edges[0]);
    assert([valueOf(component(multiply, C.Expr_MathMultiply.NAME).data.InputA),
      valueOf(component(multiply, C.Expr_MathMultiply.NAME).data.InputB)].includes(constant),
    `Live ${port} score multiplier is ${constant}`);
    return multiply;
  };
  const redPacked = channelMultiplier('R', 65536);
  const greenPacked = channelMultiplier('G', 256);
  assert(dataReachableOnly(v, redPacked, packedColor),
    'Packed score includes R*65536');
  assert(dataReachableOnly(v, greenPacked, packedColor),
    'Packed score includes G*256');
  assert(v.outgoing(colorSplit, C.Expr_SplitColorSRGB.NAME, 'B')
    .some(edge => edge.zt === C.Expr_MathAdd.NAME),
  'Packed score adds the unscaled blue byte');
  for (const channel of ['R', 'G', 'B']) assert(
    dataReachableFromPort(v, colorSplit, C.Expr_SplitColorSRGB.NAME, channel, packedColor),
    `Packed live RGB score includes ${channel}`);
  assert(dataReachableOnly(v, liveColor, colorSplit),
    'Truck reply packs the same live color state rendered on the body');
  assert(dataReachable(truck, liveMaterial, truckReply),
    'Truck reply material is sourced from the same state rendered on the body');

  const interfaceEvent = v.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle' && data.bIsObjectEvent,
    'truck live-preview receiver').brick;
  const colorPreviewSetters = v.outgoing(liveColor, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => v.target(edge))
    .filter(setter => execReachable(truck, interfaceEvent, setter)
      && dataReachableFromPort(v, interfaceEvent, C.Event_CustomGlobal.NAME,
        'DataOut1', setter));
  assert.equal(colorPreviewSetters.length, 1,
    'Preview Data1 writes the live truck Color Var');
  const materialPreviewSetters = v.outgoing(liveMaterial, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => v.target(edge))
    .filter(setter => execReachable(truck, interfaceEvent, setter));
  assert.equal(materialPreviewSetters.length, 2,
    'Preview Data2 chooses one of Plastic/Metal setters');
  assert.deepEqual(materialPreviewSetters.map(setter =>
    component(setter, C.Exec_Var_Set.NAME).data.Value.value?.value).sort((a, b) => a - b),
  [0, 4], 'Preview material setter domain is exactly Plastic/Metal');
  const materialChoice = v.outgoing(interfaceEvent, C.Event_CustomGlobal.NAME, 'DataOut2')
    .filter(edge => edge.zt === C.Expr_CompareEqual.NAME)
    .map(edge => v.target(edge));
  assert.equal(materialChoice.length, 1,
    'Preview Data2 drives the Plastic/Metal branch comparison');
  const intensitySetters = v.all(C.Exec_Var_Set.NAME, (_data, brick) =>
    execReachable(truck, interfaceEvent, brick)
      && dataReachableFromPort(v, interfaceEvent, C.Event_CustomGlobal.NAME,
        'DataOut3', brick)).map(item => item.brick);
  assert.equal(intensitySetters.length, 1,
    'Preview Data3 writes one retained truck intensity state');
  assert(execReachable(truck, interfaceEvent, intensitySetters[0]),
    'Preview event executes the intensity write');
  const intensityVar = sourceOf(v, intensitySetters[0], C.Exec_Var_Set.NAME,
    'VarRef', 'truck intensity state').brick;
  assert.equal(component(intensityVar, C.Var.NAME)?.data.Value?.$variant, 'f64',
    'Truck intensity state is numeric');
  const bodyIntensity = v.row(C.Exec_SetBrickProperty.NAME,
    data => data.Property === 3, 'truck body intensity setter').brick;
  assert(dataReachable(truck, intensityVar, bodyIntensity),
    'Retained preview intensity reaches the body material-intensity setter');

  const assertBodyBoundaryType = (setter, expected, label) => {
    const setterData = component(setter, C.Exec_SetBrickProperty.NAME).data.Value;
    assert.equal(setterData?.$variant, expected, `${label} setter saved type`);
    const inputSource = sourceOf(v, setter, C.Exec_SetBrickProperty.NAME,
      'Value', `${label} body-loop input`);
    assert.equal(inputSource.comp?.type, C.MicrochipInput.NAME,
      `${label} setter is driven by the body-loop input`);
    assert.equal(inputSource.comp.data.CallableDefault?.$variant, expected,
      `${label} input default type`);
    assert.equal(inputSource.comp.data.CallableMirror?.$variant, expected,
      `${label} input mirror type`);
    const parentSource = sourceOf(v, inputSource.brick, C.MicrochipInput.NAME,
      'RER_Input', `${label} parent output`);
    assert.equal(parentSource.comp?.type, C.MicrochipOutput.NAME,
      `${label} body input is fed through a public output`);
    assert.equal(parentSource.comp.data.CallableDefault?.$variant, expected,
      `${label} output default type`);
    assert.equal(parentSource.comp.data.CallableResult?.$variant, expected,
      `${label} output result type`);
  };
  assertBodyBoundaryType(bodyColorSetter, 'LinearColor', 'Color');
  assertBodyBoundaryType(bodyMaterialSetter, 'dynamic_enum', 'Material');
  assertBodyBoundaryType(bodyIntensity, 'f64', 'Material intensity');

  const intensityChange = v.all(C.Expr_ChangeDetector.NAME, (_data, brick) =>
    v.incoming(brick, C.Expr_ChangeDetector.NAME, 'Input')
      .some(edge => edge.a === intensityVar.key));
  assert.equal(intensityChange.length, 1, 'Intensity has one body-refresh change detector');
  const bodyLoop = v.row(C.Microchip_ForEachArray.NAME, () => true, 'truck body foreach').brick;
  assert(execReachable(truck, intensityChange[0].brick, bodyLoop),
    'Intensity changes reapply the truck body foreach');
  assert(dataReachable(truck, intensityVar, truckReply),
    'Truck reply Data5 reports the same retained intensity used on the body');
  const truckRestore = v.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color' && data.bIsObjectEvent,
    'truck appearance restore receiver').brick;
  const intensityRestore = v.outgoing(intensityVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME).map(edge => v.target(edge))
    .filter(setter => execReachable(truck, truckRestore, setter)
      && valueOf(component(setter, C.Exec_Var_Set.NAME).data.Value) === 128);
  assert.equal(intensityRestore.length, 1,
    'Zone exit restores Truck1 material intensity to the 50% baseline (128)');
  assert(execReachable(truck, interfaceEvent, bodyLoop),
    'Every preview event unconditionally reaches the delayed body refresh');

  // v10 UI contract remains intact: selected text is orange, no left marker,
  // only the right marker blinks every quarter second while the session is active.
  const prefixes = t.all(C.Expr_Select.NAME, data => valueOf(data.InputA) === ''
    && valueOf(data.InputB) === '<color="ff8700">');
  const suffixes = t.all(C.Expr_Select.NAME, data => valueOf(data.InputA) === '  </>'
    && valueOf(data.InputB) === ' <</>');
  assert.equal(prefixes.length, 6, 'Six orange selected-row prefixes remain');
  assert.equal(suffixes.length, 6, 'Six right-marker blinking suffixes remain');
  const blinkClock = t.row(C.Clock.NAME,
    data => Math.abs(data.IntervalSeconds - 0.25) < 1e-9,
    '0.25-second selection blink clock');
  assert.equal(blinkClock.comp.data.bEnabled, false, 'Selection blink is saved idle');
  assert.equal(t.incoming(blinkClock.brick, C.Clock.NAME, 'bEnabled').length, 1,
    'Selection blink is enabled only by active session state');
  const literals = t.all(C.Expr_Select.NAME).flatMap(({ comp }) =>
    ['InputA', 'InputB'].map(field => valueOf(comp.data[field])))
    .filter(value => typeof value === 'string');
  assert(!literals.some(value => value.includes('> ')), 'No selector restores a left marker');

  // BUY remains color-only. Material and intensity are temporary appearance
  // previews and are restored with the vehicle's saved state on zone exit.
  assert.equal(t.all(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    data => /Material|Intensity/i.test(data.Key || '')).length, 0,
  'BUY does not save material or intensity');
  assert.equal(t.all(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => /Material|Intensity/i.test(data.Key || '')).length, 0,
  'BUY does not increment material or intensity scores');

  // If the builder exports the conventional build function, two independent
  // in-memory builds must be byte-identical. This catches unstable handles or
  // iteration order without writing scratch prefabs.
  let deterministic = 'not-run';
  if (fs.existsSync(builder)) {
    delete require.cache[require.resolve(builder)];
    const build = require(builder);
    if (typeof build === 'function') {
      const first = build({ terminalInput, truckInput });
      const second = build({ terminalInput, truckInput });
      const firstTerminal = first.terminal?.bytes || first.terminalBytes;
      const secondTerminal = second.terminal?.bytes || second.terminalBytes;
      const firstTruck = first.truck?.bytes || first.truckBytes;
      const secondTruck = second.truck?.bytes || second.truckBytes;
      if (firstTerminal && secondTerminal && firstTruck && secondTruck) {
        assert.deepEqual(firstTerminal, secondTerminal, 'v11 terminal build is deterministic');
        assert.deepEqual(firstTruck, secondTruck, 'v6 truck build is deterministic');
        assert.deepEqual(Buffer.from(firstTerminal), Buffer.from(terminalBytes),
          'checked-in v11 terminal output matches a fresh build');
        assert.deepEqual(Buffer.from(firstTruck), Buffer.from(truckBytes),
          'checked-in v6 truck output matches a fresh build');
        deterministic = 'passed';
      }
    }
  }

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
    protocol: 'targeted SR.Appearance.Request -> filtered global SR.Appearance.Reply',
    livePreview: ['Color', 'Material', 'Material Intensity'],
    strictPlacement: true,
    deterministic,
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_V10_TERMINAL,
  truckInput: process.argv[3] || DEFAULT_V5_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V11_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V6_TRUCK,
  builder: process.argv[6] || DEFAULT_V11_BUILDER,
});

module.exports = test;
