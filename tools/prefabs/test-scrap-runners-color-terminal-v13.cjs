'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const testV12 = require('./test-scrap-runners-color-terminal-v12.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V10_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v10.brz');
const DEFAULT_V5_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v5.brz');
const DEFAULT_V12_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v12.brz');
const DEFAULT_V7_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v7.brz');
const DEFAULT_V13_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v13.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V13_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v13.cjs');

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function rows(scene, type, predicate = () => true) {
  return scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })))
    .filter(item => item.comp.type === type && predicate(item.comp.data, item.brick));
}

function one(items, label) {
  assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
  return items[0];
}

function brickMap(scene) {
  return new Map(scene.bricks.map(brick => [brick.key, brick]));
}

function incoming(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.z === brick.key && edge.zt === type
    && (!port || edge.q === port));
}

function outgoing(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.a === brick.key && edge.at === type
    && (!port || edge.p === port));
}

function source(scene, edge) {
  return brickMap(scene).get(edge.a);
}

function target(scene, edge) {
  return brickMap(scene).get(edge.z);
}

function variantValue(value) {
  return value && typeof value === 'object' && '$variant' in value ? value.value : value;
}

function enumValue(value) {
  const unwrapped = variantValue(value);
  return unwrapped && typeof unwrapped === 'object' ? unwrapped.value : undefined;
}

function execReachable(scene, start, goal) {
  const map = brickMap(scene);
  const queue = [start.key];
  const seen = new Set(queue);
  const execSourcePorts = new Set([
    'ExecOut', 'ExecOutA', 'ExecOutB', 'Output', 'bPulseOnChange',
  ]);
  while (queue.length) {
    const key = queue.shift();
    if (key === goal.key) return true;
    for (const edge of scene.edges.filter(candidate => candidate.a === key
      && execSourcePorts.has(candidate.p))) {
      if (!map.has(edge.z) || seen.has(edge.z)) continue;
      seen.add(edge.z);
      queue.push(edge.z);
    }
  }
  return false;
}

function requestNonceContract(scene) {
  const request = one(rows(scene, C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request'), 'appearance request').brick;
  const requestType = C.Exec_SendCustomEventGlobal.NAME;
  const nonceEdge = one(incoming(scene, request, requestType, 'DataIn2'),
    'request committed nonce input');
  const nonce = source(scene, nonceEdge);
  assert(component(nonce, C.Var.NAME), 'request nonce is read from a retained Var');

  const requestExec = one(incoming(scene, request, requestType, 'ExecIn'),
    'delayed request execution');
  const vehicleGet = source(scene, requestExec);
  const vehicleGetComp = component(vehicleGet, C.Exec_ArrayVar_Get.NAME);
  assert(vehicleGetComp, 'request executes only after reading the retained vehicle array');
  assert.equal(variantValue(vehicleGetComp.data.Index), 0,
    'request vehicle read uses array index zero');
  assert.equal(requestExec.p, 'ExecOut', 'vehicle read completion executes request');

  const targetEdge = one(incoming(scene, request, requestType, 'Target'),
    'request target');
  const echoEdge = one(incoming(scene, request, requestType, 'DataIn1'),
    'request vehicle echo');
  assert.equal(targetEdge.a, vehicleGet.key, 'retained vehicle drives request Target');
  assert.equal(targetEdge.p, 'Value', 'request Target uses retained vehicle value');
  assert.equal(echoEdge.a, vehicleGet.key, 'retained vehicle drives echoed identity');
  assert.equal(echoEdge.p, 'Value', 'request identity uses retained vehicle value');

  const getExec = one(incoming(scene, vehicleGet, C.Exec_ArrayVar_Get.NAME, 'Exec'),
    'delayed vehicle read execution');
  const delay = source(scene, getExec);
  const delayComp = component(delay, C.BufferTicks.NAME);
  assert(delayComp, 'request waits through Buffer Ticks');
  assert.equal(delayComp.data.TicksToWait, 1, 'request waits exactly one logic tick');
  assert.equal(getExec.p, 'Output', 'buffer completion executes vehicle read');

  const delayInput = one(incoming(scene, delay, C.BufferTicks.NAME, 'Input'),
    'request delay input');
  const entryNonce = source(scene, delayInput);
  assert(component(entryNonce, C.Exec_Var_Set.NAME),
    'entry nonce setter starts the request delay');
  assert.equal(delayInput.p, 'ExecOut', 'request begins only after nonce commit');
  const entryVar = one(incoming(scene, entryNonce, C.Exec_Var_Set.NAME, 'VarRef'),
    'entry nonce VarRef');
  assert.equal(entryVar.a, nonce.key,
    'entry setter commits the same nonce Var later sent by request');

  const nextEdge = one(incoming(scene, entryNonce, C.Exec_Var_Set.NAME, 'Value'),
    'entry nonce next value');
  const nonceNext = source(scene, nextEdge);
  assert(component(nonceNext, C.Expr_MathAdd.NAME), 'entry nonce is incremented once');
  const addInput = one(incoming(scene, nonceNext, C.Expr_MathAdd.NAME, 'InputA'),
    'nonce increment input');
  assert.equal(addInput.a, nonce.key, 'nonce increment reads retained nonce');
  assert.equal(variantValue(component(nonceNext, C.Expr_MathAdd.NAME).data.InputB), 1,
    'nonce increment adds exactly one');
  assert(!incoming(scene, request, requestType, 'DataIn2')
    .some(edge => edge.a === nonceNext.key),
  'request never reads the still-live nonce + 1 expression');

  return { request, nonce, entryNonce, nonceNext, delay, vehicleGet };
}

function assertV12NonceBug(scene) {
  const request = one(rows(scene, C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request'), 'v12 appearance request').brick;
  const requestType = C.Exec_SendCustomEventGlobal.NAME;
  const nonceInput = one(incoming(scene, request, requestType, 'DataIn2'),
    'v12 request nonce input');
  const nonceNext = source(scene, nonceInput);
  assert(component(nonceNext, C.Expr_MathAdd.NAME),
    'v12 reproduces request reading live nonce + 1');
  const execInput = one(incoming(scene, request, requestType, 'ExecIn'),
    'v12 request execution');
  const entryNonce = source(scene, execInput);
  assert(component(entryNonce, C.Exec_Var_Set.NAME),
    'v12 request executes immediately after nonce setter');
  assert(incoming(scene, entryNonce, C.Exec_Var_Set.NAME, 'Value')
    .some(edge => edge.a === nonceNext.key),
  'v12 uses the same reactive nonce + 1 for commit and later send');
}

function materialRestoreContract(scene) {
  const materialGet = one(rows(scene, C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'Truck1Material getter').brick;
  const branchEdge = one(outgoing(scene, materialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(target(scene, edge), C.Exec_Branch.NAME)),
  'material getter completion restore branch');
  const branch = target(scene, branchEdge);
  assert.equal(branchEdge.q, 'Exec', 'material getter explicitly executes restore branch');

  const condEdge = one(incoming(scene, branch, C.Exec_Branch.NAME, 'bCond'),
    'saved material condition');
  const savedIsMetal = source(scene, condEdge);
  const compare = component(savedIsMetal, C.Expr_CompareEqual.NAME);
  assert(compare, 'material restore condition compares the saved score');
  assert.equal(variantValue(compare.data.InputA), 1,
    'saved material score 1 represents Metal');
  assert(incoming(scene, savedIsMetal, C.Expr_CompareEqual.NAME, 'InputB')
    .some(edge => edge.a === materialGet.key && edge.p === 'Value'),
  'material condition reads Truck1Material leaderboard value');

  const metalEdge = one(outgoing(scene, branch, C.Exec_Branch.NAME, 'ExecOutA'),
    'saved Metal branch');
  const plasticEdge = one(outgoing(scene, branch, C.Exec_Branch.NAME, 'ExecOutB'),
    'saved Plastic branch');
  const metalSetter = target(scene, metalEdge);
  const plasticSetter = target(scene, plasticEdge);
  const metalSet = component(metalSetter, C.Exec_Var_Set.NAME);
  const plasticSet = component(plasticSetter, C.Exec_Var_Set.NAME);
  assert(metalSet && plasticSet, 'material restore branch explicitly executes two Var setters');
  assert.equal(enumValue(metalSet.data.Value), 4, 'true restore branch sets EBrickMaterial Metal');
  assert.equal(enumValue(plasticSet.data.Value), 0,
    'false restore branch sets EBrickMaterial Plastic');
  assert.equal(metalEdge.q, 'Exec');
  assert.equal(plasticEdge.q, 'Exec');

  for (const setter of [metalSetter, plasticSetter]) {
    const execDrivers = incoming(scene, setter, C.Exec_Var_Set.NAME, 'Exec');
    assert.equal(execDrivers.length, 1, 'saved material setter has one explicit Exec driver');
    assert.equal(execDrivers[0].a, branch.key,
      'saved material setter is not driven by an unchanged expression value');
  }

  const restore = one(rows(scene, C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color'), 'appearance restore event').brick;
  assert(execReachable(scene, restore, materialGet),
    'zone-exit restore event executes the material leaderboard getter');

  return { materialGet, branch, savedIsMetal, metalSetter, plasticSetter };
}

function assertV7MaterialRestoreBug(scene) {
  const materialGet = one(rows(scene, C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'v7 Truck1Material getter').brick;
  const scoreComparisons = outgoing(scene, materialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
    .map(edge => target(scene, edge))
    .filter(brick => component(brick, C.Expr_CompareEqual.NAME))
    .filter(brick => [0, 1].includes(variantValue(
      component(brick, C.Expr_CompareEqual.NAME).data.InputA)));
  assert.equal(scoreComparisons.length, 2,
    'v7 reproduces separate equality-driven Plastic and Metal setters');
  for (const compare of scoreComparisons) {
    const setterEdge = one(outgoing(scene, compare, C.Expr_CompareEqual.NAME, 'bOutput'),
      'v7 equality-driven material setter');
    assert(component(target(scene, setterEdge), C.Exec_Var_Set.NAME),
      'v7 comparison output drives a material setter Exec input');
    assert.equal(setterEdge.q, 'Exec');
  }
  assert.equal(outgoing(scene, materialGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut').filter(edge =>
    component(target(scene, edge), C.Exec_Branch.NAME)).length, 0,
  'v7 material getter completion does not force a saved-material setter');
}

function test({
  terminalInput = DEFAULT_V10_TERMINAL,
  truckInput = DEFAULT_V5_TRUCK,
  previousTerminal = DEFAULT_V12_TERMINAL,
  previousTruck = DEFAULT_V7_TRUCK,
  terminalOutput = DEFAULT_V13_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V13_BUILDER,
} = {}) {
  // Retain the complete appearance, purchase, layout, placement, ownership,
  // and deterministic-build contract established through v12/v7.
  testV12({ terminalInput, truckInput, terminalOutput, truckOutput, builder });

  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);
  const oldTerminal = read(fs.readFileSync(previousTerminal));
  const oldTruck = read(fs.readFileSync(previousTruck));

  const request = requestNonceContract(terminal);
  const restore = materialRestoreContract(truck);
  assertV12NonceBug(oldTerminal);
  assertV7MaterialRestoreBug(oldTruck);

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
    requestInitialization: {
      committedNonce: request.nonce.key,
      settleTicks: component(request.delay, C.BufferTicks.NAME).data.TicksToWait,
      retainedVehicleRead: request.vehicleGet.key,
    },
    materialRestore: {
      explicitBranch: restore.branch.key,
      plastic: enumValue(component(restore.plasticSetter, C.Exec_Var_Set.NAME).data.Value),
      metal: enumValue(component(restore.metalSetter, C.Exec_Var_Set.NAME).data.Value),
    },
    inheritedV12Regressions: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_V10_TERMINAL,
  truckInput: process.argv[3] || DEFAULT_V5_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V13_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V13_BUILDER,
});

module.exports = test;
