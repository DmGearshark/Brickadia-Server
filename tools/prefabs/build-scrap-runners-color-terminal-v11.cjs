'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, B } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const TERMINAL_INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v10.brz'));
const TRUCK_INPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v5.brz'));
const TERMINAL_OUTPUT = path.resolve(process.argv[4]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v11.brz'));
const TRUCK_OUTPUT = path.resolve(process.argv[5]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v6.brz'));

const clone = structuredClone;
const I = value => ({ $variant: 'i64', value });
const O = value => ({ $variant: 'weak_object', value });
const X = () => ({ $variant: 'WireGraphExec', value: {} });
const L = (R = 0, G = 0, Bc = 0, A = 1) => ({
  $variant: 'LinearColor', value: { R, G, B: Bc, A },
});
const material = value => ({
  $variant: 'dynamic_enum', value: { $enum: 'EBrickMaterial', value },
});

function owner(scene) {
  const owners = scene.r.owners();
  const i = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(i >= 0, 'Prefab owner');
  return { id: brdb.guidToUuid(owners.UserIds[i]), name: owners.UserNames[i],
    display_name: owners.DisplayNames[i] };
}

function graph(scene, prefix) {
  let seq = 0;
  const component = (brick, type) => {
    const found = brick?.comps.find(c => c.type === type);
    assert(found, `Missing ${type}`);
    return found;
  };
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, pred = () => true) => rows().filter(x => x.comp.type === type
    && pred(x.comp.data, x.brick));
  const one = (items, label) => (assert.equal(items.length, 1,
    `${label}: expected 1, got ${items.length}`), items[0]);
  const row = (type, pred = () => true, label = type) => one(all(type, pred), label);
  const brick = key => one(scene.bricks.filter(b => b.key === key), `brick ${key}`);
  const incoming = (b, type, port) => scene.edges.filter(e => e.z === b.key
    && e.zt === type && (!port || e.q === port));
  const outgoing = (b, type, port) => scene.edges.filter(e => e.a === b.key
    && e.at === type && (!port || e.p === port));
  const add = (a, at, p, z, zt, q) => {
    assert(!scene.edges.some(e => e.z === z.key && e.zt === zt && e.q === q),
      `Duplicate driver ${z.key}.${q}`);
    scene.edges.push({ a: a.key, at, p, z: z.key, zt, q });
  };
  const removeInput = (b, type, port) => {
    const old = incoming(b, type, port);
    scene.edges = scene.edges.filter(e => !(e.z === b.key && e.zt === type && e.q === port));
    return old;
  };
  const remove = b => {
    scene.edges = scene.edges.filter(e => e.a !== b.key && e.z !== b.key);
    scene.links = scene.links.filter(link => link.key !== b.key);
    scene.joints = (scene.joints || []).filter(joint => joint.key !== b.key);
    scene.bricks = scene.bricks.filter(x => x !== b);
  };
  const base = clone(scene.bricks.find(b => b.data.asset.startsWith('B_1x1_Gate_')).data);
  const gate = (kind, grid, data, name, color = [70, 145, 205], label = name) => {
    const d = C[kind]; assert(d, kind);
    const brickData = clone(base);
    Object.assign(brickData, { asset: d.BRICK, position: [0, 0, 2], direction: 4,
      rotation: 0, size: [0, 0, 0], color, material_intensity: 5 });
    const comps = [{ type: d.NAME, data: clone(data) }];
    if (label) comps.push({ type: C.Interact.NAME, data: { InteractSound: 0,
      Message: label, ConsoleTag: '', bAllowNearbyInteraction: true,
      bHiddenInteraction: false, PromptCustomLabel: label } });
    const result = { key: `${prefix}:${grid}:${name}:${seq++}`, g: grid,
      data: brickData, comps };
    scene.bricks.push(result); return result;
  };
  return { component, rows, all, one, row, brick, incoming, outgoing, add,
    removeInput, remove, gate };
}

function halfSize(brick) {
  if (brick.data.size?.some(x => x > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}
function rowAt(bricks, x, y) {
  let edge = x;
  for (const brick of bricks) {
    const half = halfSize(brick); assert(half, brick.data.asset);
    brick.data.position = [edge + half[0], y, 2]; edge += half[0] * 2;
  }
}
function fit(scene, grid) {
  const entity = [...scene.r.entities()].find(e => e.persistentIndex === grid); assert(entity);
  const bricks = scene.bricks.filter(b => b.g === grid);
  const lo = [0, 1].map(a => Math.min(...bricks.map(b => b.data.position[a] - halfSize(b)[a])));
  const hi = [0, 1].map(a => Math.max(...bricks.map(b => b.data.position[a] + halfSize(b)[a])));
  const low = lo.map(Math.floor); const high = hi.map(Math.ceil);
  for (let axis = 0; axis < 2; axis++) if ((low[axis] + high[axis]) % 2) high[axis]++;
  const copy = clone(entity); copy.data = clone(entity.data); copy.data.bCollapsed = true;
  copy.data.PlaneCenter = { X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2, Z: 0 };
  copy.data.PlaneExtent = { X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10, Z: 0 };
  scene.entityOverrides.set(grid, copy);
}
function eventData(name, object, values) {
  return { EventName: name, bIsObjectEvent: object,
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) =>
      [`DataOut${i + 1}`, clone(values[i] || N(0))])) };
}
function sendData(name, values) {
  return { EventName: name, ...Object.fromEntries(Array.from({ length: 8 }, (_, i) =>
    [`DataIn${i + 1}`, clone(values[i] || N(0))])) };
}

function buildTerminal(input = TERMINAL_INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor); scene.entityOverrides = new Map();
  const g = graph(scene, 'v11t');
  const entered = g.row(C.EntityZoneEvent_Entered.NAME, () => true, 'zone entered').brick;
  const left = g.row(C.EntityZoneEvent_Left.NAME, () => true, 'zone left').brick;
  const terminalGrid = entered.g;
  g.component(entered, C.EntityZoneEvent_Entered.NAME).data.TagFilter = 'Vehicle';
  g.component(left, C.EntityZoneEvent_Left.NAME).data.TagFilter = 'Vehicle';
  const insert = g.row(C.Exec_ArrayVar_Insert.NAME,
    (_data, brick) => brick.g === terminalGrid, 'vehicle insert').brick;
  const insertDriver = g.one(g.removeInput(insert, C.Exec_ArrayVar_Insert.NAME, 'Exec'),
    'zone entered -> vehicle insert');
  assert.equal(insertDriver.a, entered.key);
  const vehicleArray = g.brick(g.one(g.incoming(insert, C.Exec_ArrayVar_Insert.NAME,
    'ArrayVarRef'), 'vehicle array').a);
  const preview = g.row(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'preview sender').brick;

  const scoreOut = g.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Vehicle Color Score' && brick.g === terminalGrid,
    'terminal score output').brick;
  const materialOut = g.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Vehicle Material' && brick.g === terminalGrid,
    'terminal material output').brick;
  const syncOut = g.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Appearance Sync' && brick.g === terminalGrid,
    'terminal sync output').brick;
  const settle = g.brick(g.one(g.incoming(syncOut, C.MicrochipOutput.NAME,
    'RER_Input'), 'sync settle').a);
  assert(g.component(settle, C.BufferTicks.NAME));
  g.removeInput(settle, C.BufferTicks.NAME, 'Input');

  // Delete the custom-property pull and its found guard. It can fail both from
  // entity identity and from properties not being published before zone entry.
  const oldGets = g.all('BrickComponentType_Exec_Entity_GetCustomProperty',
    data => ['CurrentColorScore', 'CurrentMaterialEnum'].includes(data.Key));
  assert.equal(oldGets.length, 2);
  const colorGet = oldGets.find(x => x.comp.data.Key === 'CurrentColorScore').brick;
  const materialGet = oldGets.find(x => x.comp.data.Key === 'CurrentMaterialEnum').brick;
  const oldGuard = g.brick(g.one(g.outgoing(materialGet,
    'BrickComponentType_Exec_Entity_GetCustomProperty', 'ExecOut'), 'old guard').z);
  const oldFound = g.brick(g.one(g.outgoing(colorGet,
    'BrickComponentType_Exec_Entity_GetCustomProperty', 'bFound'), 'old found').z);
  [colorGet, materialGet, oldGuard, oldFound].forEach(g.remove);

  // appearanceReady prevents picker defaults from being echoed to the truck
  // while the asynchronous request/reply initialization is still in flight.
  const ready = g.gate('Var', terminalGrid, { Value: B(false) }, 'appearance_ready',
    [70, 185, 225], 'Appearance ready (blocks preview until synchronized)');
  const readyEntryOff = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'ready_entry_off', [70, 185, 225],
    'Reset appearance ready on entry');
  const readyExitOff = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(false) }, 'ready_exit_off', [70, 185, 225],
    'Reset appearance ready on exit');
  const readyOn = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: B(true) }, 'ready_on', [70, 185, 225],
    'Set ready after every sync setter completes');
  for (const setter of [readyEntryOff, readyExitOff, readyOn])
    g.add(ready, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(entered, C.EntityZoneEvent_Entered.NAME, 'Exec', readyEntryOff,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(readyEntryOff, C.Exec_Var_Set.NAME, 'ExecOut', insert,
    C.Exec_ArrayVar_Insert.NAME, 'Exec');
  g.add(left, C.EntityZoneEvent_Left.NAME, 'Exec', readyExitOff,
    C.Exec_Var_Set.NAME, 'Exec');
  const previewDriver = g.one(g.removeInput(preview,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'), 'preview driver');
  const readyGuard = g.gate('Exec_Branch', terminalGrid, {}, 'preview_ready_guard',
    [70, 185, 225], 'Send preview only after live appearance sync');
  g.add(g.brick(previewDriver.a), previewDriver.at, previewDriver.p, readyGuard,
    C.Exec_Branch.NAME, 'Exec');
  g.add(ready, C.Var.NAME, 'Value', readyGuard, C.Exec_Branch.NAME, 'bCond');
  g.add(readyGuard, C.Exec_Branch.NAME, 'ExecOutA', preview,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');

  // Entry request and nonce invalidation.
  const nonce = g.gate('Var', terminalGrid, { Value: I(0) }, 'appearance_nonce',
    [70, 185, 225], 'Appearance request nonce');
  const nonceNext = g.gate('Expr_MathAdd', terminalGrid,
    { InputA: I(0), InputB: I(1) }, 'nonce_next', [70, 185, 225], 'Next nonce');
  const entryNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(1) }, 'entry_nonce', [70, 185, 225],
    'Commit entry nonce');
  const exitNonce = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(1) }, 'exit_nonce', [70, 185, 225],
    'Invalidate late reply on exit');
  const request = g.gate('Exec_SendCustomEventGlobal', terminalGrid,
    sendData('SR.Appearance.Request', [O(null), I(0)]), 'appearance_request',
    [70, 185, 225], 'Targeted live appearance request');
  g.add(nonce, C.Var.NAME, 'Value', nonceNext, C.Expr_MathAdd.NAME, 'InputA');
  for (const setter of [entryNonce, exitNonce]) {
    g.add(nonce, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    g.add(nonceNext, C.Expr_MathAdd.NAME, 'Output', setter, C.Exec_Var_Set.NAME, 'Value');
  }
  g.add(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut', entryNonce,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(entryNonce, C.Exec_Var_Set.NAME, 'ExecOut', request,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  for (const port of ['Target', 'DataIn1']) g.add(entered,
    C.EntityZoneEvent_Entered.NAME, 'Entity', request, C.Exec_SendCustomEventGlobal.NAME, port);
  g.add(nonceNext, C.Expr_MathAdd.NAME, 'Output', request,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');
  g.add(left, C.EntityZoneEvent_Left.NAME, 'Exec', exitNonce, C.Exec_Var_Set.NAME, 'Exec');

  // Global reply is safe because both the echoed vehicle and nonce must match.
  const reply = g.gate('Event_CustomGlobal', terminalGrid,
    eventData('SR.Appearance.Reply', false, [O(null), I(0), I(0), N(0), N(128)]),
    'appearance_reply', [70, 185, 225], 'Live appearance reply');
  const current = g.gate('Exec_ArrayVar_Get', terminalGrid,
    { Index: 0, Value: O(null), bOutOfBounds: true }, 'reply_vehicle',
    [70, 185, 225], 'Read current vehicle');
  const hasVehicle = g.gate('Expr_LogicalNOT', terminalGrid, { bInput: true },
    'reply_has_vehicle', [70, 185, 225], 'Current vehicle exists');
  const sameVehicle = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: O(null), InputB: O(null) }, 'reply_same_vehicle',
    [70, 185, 225], 'Echoed vehicle matches');
  const sameNonce = g.gate('Expr_CompareEqual', terminalGrid,
    { InputA: I(0), InputB: I(0) }, 'reply_same_nonce',
    [70, 185, 225], 'Echoed nonce matches');
  const validEntity = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid_entity',
    [70, 185, 225], 'Vehicle exists and matches');
  const validReply = g.gate('Expr_LogicalAND', terminalGrid, {}, 'reply_valid',
    [70, 185, 225], 'Vehicle and nonce match');
  const replyGuard = g.gate('Exec_Branch', terminalGrid, {}, 'reply_guard',
    [70, 185, 225], 'Accept only current reply');
  g.add(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', current,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  g.add(reply, C.Event_CustomGlobal.NAME, 'ExecOut', current, C.Exec_ArrayVar_Get.NAME, 'Exec');
  g.add(current, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', hasVehicle,
    C.Expr_LogicalNOT.NAME, 'bInput');
  g.add(current, C.Exec_ArrayVar_Get.NAME, 'Value', sameVehicle,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(reply, C.Event_CustomGlobal.NAME, 'DataOut1', sameVehicle,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(nonce, C.Var.NAME, 'Value', sameNonce, C.Expr_CompareEqual.NAME, 'InputA');
  g.add(reply, C.Event_CustomGlobal.NAME, 'DataOut2', sameNonce,
    C.Expr_CompareEqual.NAME, 'InputB');
  g.add(hasVehicle, C.Expr_LogicalNOT.NAME, 'bOutput', validEntity,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(sameVehicle, C.Expr_CompareEqual.NAME, 'bOutput', validEntity,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(validEntity, C.Expr_LogicalAND.NAME, 'bOutput', validReply,
    C.Expr_LogicalAND.NAME, 'bInputA');
  g.add(sameNonce, C.Expr_CompareEqual.NAME, 'bOutput', validReply,
    C.Expr_LogicalAND.NAME, 'bInputB');
  g.add(current, C.Exec_ArrayVar_Get.NAME, 'ExecOut', replyGuard, C.Exec_Branch.NAME, 'Exec');
  g.add(validReply, C.Expr_LogicalAND.NAME, 'bOutput', replyGuard, C.Exec_Branch.NAME, 'bCond');

  const scoreState = g.gate('Var', terminalGrid, { Value: I(0) }, 'reply_score',
    [145, 95, 215], 'Live packed color snapshot');
  const materialState = g.gate('Var', terminalGrid, { Value: N(0) }, 'reply_material',
    [165, 105, 220], 'Live material snapshot');
  const intensityState = g.gate('Var', terminalGrid, { Value: N(128) }, 'reply_intensity',
    [220, 165, 65], 'Live intensity snapshot');
  const states = [scoreState, materialState, intensityState];
  const setters = states.map((state, i) => g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: [I(0), N(0), N(128)][i] },
    ['set_reply_score', 'set_reply_material', 'set_reply_intensity'][i],
    [[145, 95, 215], [165, 105, 220], [220, 165, 65]][i],
    ['Snapshot color', 'Snapshot material', 'Snapshot intensity'][i]));
  states.forEach((state, i) => {
    g.add(state, C.Var.NAME, 'VarRef', setters[i], C.Exec_Var_Set.NAME, 'VarRef');
    g.add(reply, C.Event_CustomGlobal.NAME, `DataOut${i + 3}`, setters[i],
      C.Exec_Var_Set.NAME, 'Value');
    if (i) g.add(setters[i - 1], C.Exec_Var_Set.NAME, 'ExecOut', setters[i],
      C.Exec_Var_Set.NAME, 'Exec');
  });
  g.add(replyGuard, C.Exec_Branch.NAME, 'ExecOutA', setters[0], C.Exec_Var_Set.NAME, 'Exec');
  g.add(setters[2], C.Exec_Var_Set.NAME, 'ExecOut', settle, C.BufferTicks.NAME, 'Input');
  for (const [output, state] of [[scoreOut, scoreState], [materialOut, materialState]]) {
    g.removeInput(output, C.MicrochipOutput.NAME, 'RER_Input');
    g.add(state, C.Var.NAME, 'Value', output, C.MicrochipOutput.NAME, 'RER_Input');
  }

  // Resolve the config/core chips through the existing score bridge.
  const scoreInputs = g.all(C.MicrochipInput.NAME,
    data => data.PortLabel === 'Vehicle Color Score');
  assert.equal(scoreInputs.length, 2);
  const coreScore = scoreInputs.find(({ brick }) => g.outgoing(brick,
    C.MicrochipInput.NAME, 'RER_Output').some(e => e.zt === C.Expr_MathMax.NAME)).brick;
  const configScore = scoreInputs.find(({ brick }) => brick !== coreScore).brick;
  const coreGrid = coreScore.g; const configGrid = configScore.g;
  const vehicleIntensityOut = g.gate('MicrochipOutput', terminalGrid, {
    PortLabel: 'Vehicle Intensity', PortOrder: 5,
    CallableDefault: N(128), CallableResult: N(128),
  }, 'vehicle_intensity_out', [220, 165, 65], 'Vehicle intensity output');
  const configIntensityIn = g.gate('MicrochipInput', configGrid, {
    PortLabel: 'Vehicle Intensity', PortOrder: 5,
    CallableDefault: N(128), CallableMirror: N(128),
  }, 'config_intensity_in', [220, 165, 65], 'Vehicle intensity bridge');
  const coreIntensityIn = g.gate('MicrochipInput', coreGrid, {
    PortLabel: 'Vehicle Intensity', PortOrder: 13,
    CallableDefault: N(128), CallableMirror: N(128),
  }, 'core_intensity_in', [220, 165, 65], 'Vehicle intensity sync input');
  g.add(intensityState, C.Var.NAME, 'Value', vehicleIntensityOut,
    C.MicrochipOutput.NAME, 'RER_Input');
  g.add(vehicleIntensityOut, C.MicrochipOutput.NAME, 'RER_Output', configIntensityIn,
    C.MicrochipInput.NAME, 'RER_Input');
  g.add(configIntensityIn, C.MicrochipInput.NAME, 'RER_Output', coreIntensityIn,
    C.MicrochipInput.NAME, 'RER_Input');

  // Locate the authoritative 0..10 intensity Var from its existing 0..255 output.
  const publicIntensity = g.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Material Intensity' && brick.g === configGrid,
    'public intensity output').brick;
  g.add(publicIntensity, C.MicrochipOutput.NAME, 'RER_Output', preview,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3');
  const coreIntensityOut = g.row(C.MicrochipOutput.NAME,
    (data, brick) => data.PortLabel === 'Material Intensity' && brick.g === coreGrid,
    'core intensity output').brick;
  const roundRaw = g.brick(g.one(g.incoming(coreIntensityOut,
    C.MicrochipOutput.NAME, 'RER_Input'), 'intensity round').a);
  const multiplyRaw = g.brick(g.one(g.incoming(roundRaw, C.Expr_Round.NAME, 'Input'),
    'intensity multiply').a);
  const intensityVar = g.brick(g.one(g.incoming(multiplyRaw,
    C.Expr_MathMultiply.NAME, 'InputA'), 'intensity Var').a);
  const userIntensitySetters = g.outgoing(intensityVar, C.Var.NAME, 'VarRef')
    .filter(e => e.zt === C.Exec_Var_Set.NAME).map(e => g.brick(e.z));
  assert.equal(userIntensitySetters.length, 4, 'four intensity user setters');

  const rawLow = g.gate('Expr_MathMax', coreGrid,
    { InputA: N(128), InputB: N(0) }, 'sync_intensity_low', [220, 165, 65],
    'Clamp raw intensity >= 0');
  const rawHigh = g.gate('Expr_MathMin', coreGrid,
    { InputA: N(128), InputB: N(255) }, 'sync_intensity_high', [220, 165, 65],
    'Clamp raw intensity <= 255');
  const toLevel = g.gate('Expr_MathDivide', coreGrid,
    { InputA: N(128), InputB: N(25.5) }, 'sync_intensity_level', [220, 165, 65],
    'Convert 0..255 to 0..10');
  const roundLevel = g.gate('Expr_Round', coreGrid, { Input: 5 },
    'sync_intensity_round', [220, 165, 65], 'Round to terminal intensity step');
  const levelLow = g.gate('Expr_MathMax', coreGrid,
    { InputA: N(5), InputB: N(0) }, 'sync_level_low', [220, 165, 65],
    'Clamp intensity level >= 0');
  const levelHigh = g.gate('Expr_MathMin', coreGrid,
    { InputA: N(5), InputB: N(10) }, 'sync_level_high', [220, 165, 65],
    'Clamp intensity level <= 10');
  const syncIntensity = g.gate('Exec_Var_Set', coreGrid,
    { bChangeType: false, Value: N(5) }, 'sync_intensity_set', [220, 165, 65],
    'Initialize intensity without preview');
  g.add(coreIntensityIn, C.MicrochipInput.NAME, 'RER_Output', rawLow,
    C.Expr_MathMax.NAME, 'InputA');
  g.add(rawLow, C.Expr_MathMax.NAME, 'Output', rawHigh, C.Expr_MathMin.NAME, 'InputA');
  g.add(rawHigh, C.Expr_MathMin.NAME, 'Output', toLevel, C.Expr_MathDivide.NAME, 'InputA');
  g.add(toLevel, C.Expr_MathDivide.NAME, 'Output', roundLevel, C.Expr_Round.NAME, 'Input');
  g.add(roundLevel, C.Expr_Round.NAME, 'Output', levelLow, C.Expr_MathMax.NAME, 'InputA');
  g.add(levelLow, C.Expr_MathMax.NAME, 'Output', levelHigh, C.Expr_MathMin.NAME, 'InputA');
  g.add(intensityVar, C.Var.NAME, 'VarRef', syncIntensity, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(levelHigh, C.Expr_MathMin.NAME, 'Output', syncIntensity, C.Exec_Var_Set.NAME, 'Value');
  const coreSync = g.row(C.MicrochipInput.NAME,
    (data, brick) => data.PortLabel === 'Appearance Sync' && brick.g === coreGrid,
    'core sync input').brick;
  let tail = g.brick(g.one(g.outgoing(coreSync, C.MicrochipInput.NAME,
    'RER_Output'), 'sync chain start').z);
  while (true) {
    const next = g.outgoing(tail, C.Exec_Var_Set.NAME, 'ExecOut')
      .filter(e => e.zt === C.Exec_Var_Set.NAME);
    if (!next.length) break;
    tail = g.brick(g.one(next, 'sync chain next').z);
  }
  g.add(tail, C.Exec_Var_Set.NAME, 'ExecOut', syncIntensity, C.Exec_Var_Set.NAME, 'Exec');
  g.add(syncIntensity, C.Exec_Var_Set.NAME, 'ExecOut', readyOn, C.Exec_Var_Set.NAME, 'Exec');

  // Include all four intensity edits in the same coalesced preview pulse.
  const previewDelay = g.one(g.all(C.BufferTicks.NAME,
    (_data, brick) => brick.g === coreGrid && g.outgoing(brick, C.BufferTicks.NAME, 'Output')
      .some(e => g.brick(e.z).g === terminalGrid)), 'preview delay').brick;
  let driver = g.one(g.removeInput(previewDelay, C.BufferTicks.NAME, 'Input'),
    'preview aggregation');
  const unions = userIntensitySetters.map((setter, i) => {
    const union = g.gate('Exec_Union', coreGrid, {}, `intensity_preview_${i}`,
      [220, 165, 65], `Intensity preview pulse ${i + 1}`);
    g.add(g.brick(driver.a), driver.at, driver.p, union, C.Exec_Union.NAME, 'ExecA');
    g.add(setter, C.Exec_Var_Set.NAME, 'ExecOut', union, C.Exec_Union.NAME, 'ExecB');
    driver = { a: union.key, at: C.Exec_Union.NAME, p: 'ExecOut' };
    return union;
  });
  g.add(g.brick(driver.a), driver.at, driver.p, previewDelay, C.BufferTicks.NAME, 'Input');

  // New cards sit to the right of the preserved v10 labeled layout.
  rowAt([ready, readyEntryOff, readyExitOff, readyOn, readyGuard], 240, -25);
  rowAt([nonce, nonceNext, entryNonce, request, exitNonce], 240, -45);
  rowAt([reply, current, hasVehicle, sameVehicle, sameNonce,
    validEntity, validReply, replyGuard], 240, -65);
  rowAt([scoreState, setters[0], materialState, setters[1], intensityState,
    setters[2], vehicleIntensityOut], 240, -85);
  rowAt([configIntensityIn], 220, -45);
  rowAt([coreIntensityIn, rawLow, rawHigh, toLevel, roundLevel,
    levelLow, levelHigh, syncIntensity], 505, -25);
  rowAt(unions, 505, -45);
  [terminalGrid, configGrid, coreGrid].forEach(grid => fit(scene, grid));
  const metadata = { name: 'Scrap Runners - Color Terminal v11 Live Appearance Handshake',
    description: 'v10 layout with nonce-filtered vehicle appearance request/reply, preview readiness, and live color/material/intensity synchronization.',
    owner: owner(scene) };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, grids: { terminalGrid, configGrid, coreGrid } };
}

function isHandle(v) {
  return v && typeof v === 'object' && Number.isInteger(v.GridPersistentIndex)
    && v.ChunkIndex && Number.isInteger(v.ChunkIndex.X) && Number.isInteger(v.ChunkIndex.Y)
    && Number.isInteger(v.ChunkIndex.Z) && Number.isInteger(v.BrickIndexInChunk);
}
function walk(v, fn) {
  if (!v || typeof v !== 'object') return;
  fn(v);
  (Array.isArray(v) ? v : Object.values(v)).forEach(child => walk(child, fn));
}
// A normal write renumbers bricks. Re-map every stored BrickHandle through the
// first-pass output so the body reference array and SetBrickProperty defaults
// cannot silently point at the wrong bricks.
function writeTruck(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const beforeEntities = [...scene.r.entities()]; const afterEntities = [...first.r.entities()];
  assert.equal(beforeEntities.length, afterEntities.length);
  const gridMap = new Map([[1, 1]]);
  beforeEntities.forEach((e, i) => gridMap.set(e.persistentIndex, afterEntities[i].persistentIndex));
  const keyMap = new Map();
  for (const grid of new Set(scene.bricks.map(b => b.g))) {
    const before = scene.bricks.filter(b => b.g === grid);
    const after = first.bricks.filter(b => b.g === gridMap.get(grid));
    assert.equal(after.length, before.length, `grid ${grid} count`);
    before.forEach((b, i) => keyMap.set(b.key, after[i].key));
  }
  let remapped = 0;
  for (const brick of first.bricks) for (const saved of brick.comps) walk(saved.data, v => {
    if (!isHandle(v) || !v.GridPersistentIndex || v.BrickIndexInChunk === 0xffffffff) return;
    const old = JSON.stringify([v.GridPersistentIndex, v.ChunkIndex.X, v.ChunkIndex.Y,
      v.ChunkIndex.Z, v.BrickIndexInChunk]);
    const replacement = keyMap.get(old); assert(replacement, `Lost BrickHandle ${old}`);
    const [GridPersistentIndex, Xc, Yc, Zc, BrickIndexInChunk] = JSON.parse(replacement);
    Object.assign(v, { GridPersistentIndex, ChunkIndex: { X: Xc, Y: Yc, Z: Zc },
      BrickIndexInChunk }); remapped++;
  });
  const bytes = write(first, metadata).bytes;
  const final = read(bytes); const valid = new Set(final.bricks.map(b => b.key)); let checked = 0;
  for (const brick of final.bricks) for (const saved of brick.comps) walk(saved.data, v => {
    if (!isHandle(v) || !v.GridPersistentIndex || v.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([v.GridPersistentIndex, v.ChunkIndex.X, v.ChunkIndex.Y,
      v.ChunkIndex.Z, v.BrickIndexInChunk]);
    assert(valid.has(key), `Dangling BrickHandle ${key}`); checked++;
  });
  assert.equal(checked, remapped);
  return { bytes, remapped };
}

function buildTruck(input = TRUCK_INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor); scene.entityOverrides = new Map();
  const g = graph(scene, 'v11v');
  const preview = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle', 'preview receiver').brick;
  const restore = g.row(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color', 'restore receiver').brick;
  const statsGrid = preview.g;
  const colorOut = g.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Color', 'live color output').brick;
  const materialOut = g.row(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Material', 'live material output').brick;
  const colorVar = g.brick(g.one(g.incoming(colorOut, C.MicrochipOutput.NAME,
    'RER_Input'), 'color state').a);
  const materialVar = g.brick(g.one(g.incoming(materialOut, C.MicrochipOutput.NAME,
    'RER_Input'), 'material state').a);
  const colorGrid = colorVar.g;

  // Fix the pre-existing nested boundary metadata. The actual wires carried
  // LinearColor and EBrickMaterial, but the saved ports claimed f64/LinearColor.
  Object.assign(g.component(colorOut, C.MicrochipOutput.NAME).data,
    { CallableDefault: L(), CallableResult: L() });
  Object.assign(g.component(materialOut, C.MicrochipOutput.NAME).data,
    { CallableDefault: material(0), CallableResult: material(0) });
  const functionInputs = g.all(C.MicrochipInput.NAME, data => data.PortLabel === 'Input');
  const grouped = new Map();
  functionInputs.forEach(x => grouped.set(x.brick.g, [...(grouped.get(x.brick.g) || []), x]));
  const [bodyGrid, bodyRows] = g.one([...grouped].filter(([, rows]) => rows.length === 2),
    'body foreach input grid');
  const bodyInputs = bodyRows.sort((a, b) => a.comp.data.PortOrder - b.comp.data.PortOrder);
  const bodyColor = bodyInputs[0].brick; const bodyMaterial = bodyInputs[1].brick;
  Object.assign(g.component(bodyColor, C.MicrochipInput.NAME).data,
    { CallableDefault: L(), CallableMirror: L() });
  Object.assign(g.component(bodyMaterial, C.MicrochipInput.NAME).data,
    { CallableDefault: material(0), CallableMirror: material(0) });
  const existingBodySetters = g.all(C.Exec_SetBrickProperty.NAME,
    (_data, brick) => brick.g === bodyGrid);
  const bodyColorSetter = g.one(existingBodySetters.filter(({ comp }) =>
    comp.data.Property === 1), 'body Color setter');
  const bodyMaterialSetter = g.one(existingBodySetters.filter(({ comp }) =>
    comp.data.Property === 2), 'body Material setter');
  bodyColorSetter.comp.data.Value = L();
  bodyMaterialSetter.comp.data.Value = material(0);

  // MaterialOpacity is raw 0..255. Every referenced source body brick is saved
  // at slider 5/10, so 128 is the common 50% baseline and exit restore value.
  const intensity = g.gate('Var', colorGrid, { Value: N(128) }, 'live_intensity',
    [220, 165, 65], 'Live material intensity 0..255');
  const previewIntensity = g.gate('Exec_Var_Set', colorGrid,
    { bChangeType: false, Value: N(128) }, 'preview_intensity', [220, 165, 65],
    'Set preview intensity');
  const restoreIntensity = g.gate('Exec_Var_Set', colorGrid,
    { bChangeType: false, Value: N(128) }, 'restore_intensity', [220, 165, 65],
    'Restore intensity to 50%');
  for (const setter of [previewIntensity, restoreIntensity])
    g.add(intensity, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
  g.add(preview, C.Event_CustomGlobal.NAME, 'ExecOut', previewIntensity,
    C.Exec_Var_Set.NAME, 'Exec');
  g.add(preview, C.Event_CustomGlobal.NAME, 'DataOut3', previewIntensity,
    C.Exec_Var_Set.NAME, 'Value');
  g.add(restore, C.Event_CustomGlobal.NAME, 'ExecOut', restoreIntensity,
    C.Exec_Var_Set.NAME, 'Exec');

  const intensityOut = g.gate('MicrochipOutput', statsGrid, {
    PortLabel: 'Output Truck1Intensity', PortOrder: 12,
    CallableDefault: N(128), CallableResult: N(128),
  }, 'intensity_output', [220, 165, 65], 'Output Truck1Intensity');
  g.add(intensity, C.Var.NAME, 'Value', intensityOut, C.MicrochipOutput.NAME, 'RER_Input');
  const bodyIntensity = g.gate('MicrochipInput', bodyGrid, {
    PortLabel: 'Input', PortOrder: 3, CallableDefault: N(128), CallableMirror: N(128),
  }, 'body_intensity_input', [220, 165, 65], 'Body MaterialOpacity input');
  g.add(intensityOut, C.MicrochipOutput.NAME, 'RER_Output', bodyIntensity,
    C.MicrochipInput.NAME, 'RER_Input');
  const bodyEntry = g.row(C.CallableEntry_ForEachArray.NAME,
    (_data, brick) => brick.g === bodyGrid, 'body foreach entry').brick;
  const intensityProperty = g.gate('Exec_SetBrickProperty', bodyGrid, {
    Value: N(128), Brick: { GridPersistentIndex: 0, ChunkIndex: { X: 0, Y: 0, Z: 0 },
      BrickIndexInChunk: 0xffffffff }, Property: 3,
  }, 'set_body_intensity', [220, 165, 65], 'Set body MaterialOpacity');
  g.add(bodyIntensity, C.MicrochipInput.NAME, 'RER_Output', intensityProperty,
    C.Exec_SetBrickProperty.NAME, 'Value');
  g.add(bodyEntry, C.CallableEntry_ForEachArray.NAME, 'Body', intensityProperty,
    C.Exec_SetBrickProperty.NAME, 'Exec');
  g.add(bodyEntry, C.CallableEntry_ForEachArray.NAME, 'Value', intensityProperty,
    C.Exec_SetBrickProperty.NAME, 'Brick');

  // Coalesce color/material/intensity changes into the existing one-tick body pass.
  const refresh = g.row(C.BufferTicks.NAME,
    (_data, brick) => brick.g === colorGrid && g.outgoing(brick, C.BufferTicks.NAME, 'Output')
      .some(e => e.zt === C.Microchip_ForEachArray.NAME), 'appearance refresh').brick;
  const oldRefresh = g.one(g.removeInput(refresh, C.BufferTicks.NAME, 'Input'),
    'color/material refresh');
  const intensityChanged = g.gate('Expr_ChangeDetector', colorGrid,
    { Input: N(128), InputLast: N(128), bSeeded: true }, 'intensity_changed',
    [220, 165, 65], 'Intensity change detector');
  const anyAppearance = g.gate('Exec_Union', colorGrid, {}, 'any_appearance',
    [220, 165, 65], 'Color/material/intensity refresh');
  const previewOrChange = g.gate('Exec_Union', colorGrid, {}, 'preview_or_change',
    [220, 165, 65], 'Explicit preview event or detected change');
  g.add(intensity, C.Var.NAME, 'Value', intensityChanged,
    C.Expr_ChangeDetector.NAME, 'Input');
  g.add(g.brick(oldRefresh.a), oldRefresh.at, oldRefresh.p, anyAppearance,
    C.Exec_Union.NAME, 'ExecA');
  g.add(intensityChanged, C.Expr_ChangeDetector.NAME, 'bPulseOnChange', anyAppearance,
    C.Exec_Union.NAME, 'ExecB');
  g.add(anyAppearance, C.Exec_Union.NAME, 'ExecOut', previewOrChange,
    C.Exec_Union.NAME, 'ExecA');
  g.add(preview, C.Event_CustomGlobal.NAME, 'ExecOut', previewOrChange,
    C.Exec_Union.NAME, 'ExecB');
  g.add(previewOrChange, C.Exec_Union.NAME, 'ExecOut', refresh,
    C.BufferTicks.NAME, 'Input');

  // Targeted request, global reply. Data3 is the live rendered color packed by
  // the same SplitColorSRGB math already proven by the terminal's BUY path.
  const request = g.gate('Event_CustomGlobal', statsGrid,
    eventData('SR.Appearance.Request', true, [O(null), I(0)]), 'appearance_request',
    [70, 185, 225], 'Targeted appearance request receiver');
  const split = g.gate('Expr_SplitColorSRGB', statsGrid,
    { Input: { R: 0, G: 0, B: 0, A: 1 } }, 'reply_split_color',
    [145, 95, 215], 'Live color to sRGB bytes');
  const red = g.gate('Expr_MathMultiply', statsGrid,
    { InputA: I(0), InputB: I(65536) }, 'reply_red', [235, 100, 65], 'R * 65536');
  const green = g.gate('Expr_MathMultiply', statsGrid,
    { InputA: I(0), InputB: I(256) }, 'reply_green', [80, 190, 105], 'G * 256');
  const rg = g.gate('Expr_MathAdd', statsGrid,
    { InputA: I(0), InputB: I(0) }, 'reply_rg', [145, 95, 215], 'Packed R + G');
  const packed = g.gate('Expr_MathAdd', statsGrid,
    { InputA: I(0), InputB: I(0) }, 'reply_rgb', [145, 95, 215], 'Packed 0xRRGGBB');
  const isMetal = g.gate('Expr_CompareEqual', statsGrid,
    { InputA: material(0), InputB: material(4) }, 'reply_is_metal',
    [165, 105, 220], 'Live material is Metal');
  const materialNumber = g.gate('Expr_Select', statsGrid,
    { bSelectB: false, InputA: N(0), InputB: N(4) }, 'reply_material',
    [165, 105, 220], 'Reply Plastic 0 / Metal 4');
  const reply = g.gate('Exec_SendCustomEventGlobal', statsGrid,
    sendData('SR.Appearance.Reply', [O(null), I(0), I(0), N(0), N(128)]),
    'appearance_reply', [70, 185, 225], 'Broadcast live appearance reply');
  g.add(colorOut, C.MicrochipOutput.NAME, 'RER_Output', split,
    C.Expr_SplitColorSRGB.NAME, 'Input');
  g.add(split, C.Expr_SplitColorSRGB.NAME, 'R', red, C.Expr_MathMultiply.NAME, 'InputA');
  g.add(split, C.Expr_SplitColorSRGB.NAME, 'G', green, C.Expr_MathMultiply.NAME, 'InputA');
  g.add(red, C.Expr_MathMultiply.NAME, 'Output', rg, C.Expr_MathAdd.NAME, 'InputA');
  g.add(green, C.Expr_MathMultiply.NAME, 'Output', rg, C.Expr_MathAdd.NAME, 'InputB');
  g.add(rg, C.Expr_MathAdd.NAME, 'Output', packed, C.Expr_MathAdd.NAME, 'InputA');
  g.add(split, C.Expr_SplitColorSRGB.NAME, 'B', packed, C.Expr_MathAdd.NAME, 'InputB');
  g.add(materialOut, C.MicrochipOutput.NAME, 'RER_Output', isMetal,
    C.Expr_CompareEqual.NAME, 'InputA');
  g.add(isMetal, C.Expr_CompareEqual.NAME, 'bOutput', materialNumber,
    C.Expr_Select.NAME, 'bSelectB');
  g.add(request, C.Event_CustomGlobal.NAME, 'ExecOut', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  g.add(request, C.Event_CustomGlobal.NAME, 'DataOut1', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn1');
  g.add(request, C.Event_CustomGlobal.NAME, 'DataOut2', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');
  g.add(packed, C.Expr_MathAdd.NAME, 'Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3');
  g.add(materialNumber, C.Expr_Select.NAME, 'Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn4');
  g.add(intensityOut, C.MicrochipOutput.NAME, 'RER_Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn5');

  // Organized cards to the right; the tiny foreach child stays exact-fit/touching.
  rowAt([request, split, red, green, rg, packed], 180, 65);
  rowAt([isMetal, materialNumber, reply, intensityOut], 180, 45);
  rowAt([intensity, previewIntensity, restoreIntensity, intensityChanged,
    anyAppearance, previewOrChange], 255, 90);
  bodyEntry.data.position = [5, -35, 2];
  [bodyColor, bodyMaterial, bodyIntensity].forEach((b, i) => { b.data.position = [-15, -25 + i * 10, 2]; });
  const bodySetters = g.all(C.Exec_SetBrickProperty.NAME,
    (_data, brick) => brick.g === bodyGrid).map(x => x.brick)
    .sort((a, b) => g.component(a, C.Exec_SetBrickProperty.NAME).data.Property
      - g.component(b, C.Exec_SetBrickProperty.NAME).data.Property);
  bodySetters.forEach((b, i) => { b.data.position = [5, -25 + i * 10, 2]; });
  [statsGrid, colorGrid, bodyGrid].forEach(grid => fit(scene, grid));
  const metadata = { name: 'Scrap Runners - Truck1 Appearance Handshake v6',
    description: 'Truck1 v5 with live appearance reply, corrected typed body ports, and real color/material/intensity preview plus exit restoration.',
    owner: owner(scene) };
  const written = writeTruck(scene, metadata);
  return { bytes: repack(written.bytes, donor, metadata), scene,
    remappedBrickHandles: written.remapped };
}

function finite(value, pathName) {
  if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite ${pathName}`);
  else if (Array.isArray(value)) value.forEach((x, i) => finite(x, `${pathName}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value)
    .forEach(([k, x]) => finite(x, `${pathName}.${k}`));
}
function buildAll() {
  const terminal = buildTerminal(); const truck = buildTruck();
  terminal.scene.bricks.forEach((b, i) => finite(b, `terminal[${i}]`));
  truck.scene.bricks.forEach((b, i) => finite(b, `truck[${i}]`));
  return { terminal, truck };
}

module.exports = Object.assign(buildAll, { buildTerminal, buildTruck });
if (require.main === module) {
  const result = buildAll();
  fs.mkdirSync(path.dirname(TERMINAL_OUTPUT), { recursive: true });
  fs.writeFileSync(TERMINAL_OUTPUT, result.terminal.bytes);
  fs.writeFileSync(TRUCK_OUTPUT, result.truck.bytes);
  console.log(JSON.stringify({
    terminal: { output: TERMINAL_OUTPUT, bricks: result.terminal.scene.bricks.length,
      wires: result.terminal.scene.edges.length },
    truck: { output: TRUCK_OUTPUT, bricks: result.truck.scene.bricks.length,
      wires: result.truck.scene.edges.length,
      remappedBrickHandles: result.truck.remappedBrickHandles },
    events: ['SR.Appearance.Request', 'SR.Appearance.Reply'],
  }, null, 2));
}



