'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV11 = require('./test-scrap-runners-color-terminal-v11.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V10_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v10.brz');
const DEFAULT_V5_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v5.brz');
const DEFAULT_V11_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v11.brz');
const DEFAULT_V6_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v6.brz');
const DEFAULT_V12_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v12.brz');
const DEFAULT_V7_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v7.brz');
const DEFAULT_V12_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v12.cjs');

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

function assertProceduralGateContract(scene, label) {
  const gates = scene.bricks.filter(brick => brick.data.asset.startsWith('PB_Gate_'));
  assert(gates.length > 0, `${label} contains procedural PB gates`);
  for (const brick of gates) {
    const [x, y, z] = brick.data.size;
    assert(x > 0 && y > 0 && z > 0,
      `${label} ${brick.data.asset} has explicit nonzero half-extents`);
    assert.equal(x % 5, 0, `${label} ${brick.data.asset} X half-extent is on grid`);
    assert.equal(y % 5, 0, `${label} ${brick.data.asset} Y half-extent is on grid`);
    assert.equal(z % 2, 0, `${label} ${brick.data.asset} Z half-extent is on grid`);
    assert.equal(brick.comps.length, 1,
      `${label} ${brick.data.asset} carries only its functional gate component`);
    assert.equal(brick.comps[0].type,
      `BrickComponentType_${brick.data.asset.slice('PB_Gate_'.length)}`,
      `${label} ${brick.data.asset} carries its matching primary gate component`);
    assert(!component(brick, C.Interact.NAME),
      `${label} ${brick.data.asset} has no editor-only Interact attachment`);
  }
  return gates;
}

function assertHandshakeGate(scene, type, eventName, label) {
  const item = one(rows(scene, type, data => data.EventName === eventName), label);
  assert(item.brick.data.asset.startsWith('PB_Gate_'), `${label} uses a PB gate asset`);
  assert.deepEqual(item.brick.data.size, [10, 5, 2],
    `${label} has the explicit runtime footprint used by its touching row`);
  assert.equal(item.brick.comps.length, 1, `${label} has no editor-only attachment`);
  return item.brick;
}

function test({
  terminalInput = DEFAULT_V10_TERMINAL,
  truckInput = DEFAULT_V5_TRUCK,
  previousTerminal = DEFAULT_V11_TERMINAL,
  previousTruck = DEFAULT_V6_TRUCK,
  terminalOutput = DEFAULT_V12_TERMINAL,
  truckOutput = DEFAULT_V7_TRUCK,
  builder = DEFAULT_V12_BUILDER,
} = {}) {
  // First rerun the complete behavior, layout, ownership, persistence, and
  // deterministic-build contract inherited from v11/v6.
  testV11({ terminalInput, truckInput, terminalOutput, truckOutput, builder });

  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const terminal = read(terminalBytes);
  const truck = read(truckBytes);

  const terminalValidation = validate(terminalBytes);
  const truckValidation = validate(truckBytes);
  assert(terminalValidation.strictOk, 'v12 terminal passes strict placement');
  assert(truckValidation.strictOk, 'v7 truck passes strict placement');

  const terminalPbGates = assertProceduralGateContract(terminal, 'terminal');
  const truckPbGates = assertProceduralGateContract(truck, 'truck');
  assertHandshakeGate(terminal, C.Exec_SendCustomEventGlobal.NAME,
    'SR.Appearance.Request', 'terminal appearance request');
  assertHandshakeGate(terminal, C.Event_CustomGlobal.NAME,
    'SR.Appearance.Reply', 'terminal appearance reply');
  assertHandshakeGate(truck, C.Event_CustomGlobal.NAME,
    'SR.Appearance.Request', 'truck appearance request');
  assertHandshakeGate(truck, C.Exec_SendCustomEventGlobal.NAME,
    'SR.Appearance.Reply', 'truck appearance reply');

  // The failed v11/v6 pair contained exactly these four zero-size procedural
  // gates. Keeping this comparison makes the user-observed placement failure a
  // permanent regression fixture without depending on their uploaded saves.
  const previousScenes = [
    ['terminal', read(fs.readFileSync(previousTerminal))],
    ['truck', read(fs.readFileSync(previousTruck))],
  ];
  const oldZeroSizePbGates = previousScenes.flatMap(([sceneLabel, scene]) => scene.bricks
    .filter(brick => brick.data.asset.startsWith('PB_Gate_')
      && !brick.data.size.some(value => value > 0))
    .map(brick => ({ sceneLabel, brick, comp: brick.comps.find(saved =>
      saved.type !== C.Interact.NAME) })));
  assert.equal(oldZeroSizePbGates.length, 4,
    'v11/v6 reproduces the four zero-size request/reply gates Brickadia rejected');
  assert.deepEqual(oldZeroSizePbGates.map(({ sceneLabel, comp }) =>
    `${sceneLabel}:${comp.type}:${comp.data.EventName}`).sort(), [
    `terminal:${C.Event_CustomGlobal.NAME}:SR.Appearance.Reply`,
    `terminal:${C.Exec_SendCustomEventGlobal.NAME}:SR.Appearance.Request`,
    `truck:${C.Event_CustomGlobal.NAME}:SR.Appearance.Request`,
    `truck:${C.Exec_SendCustomEventGlobal.NAME}:SR.Appearance.Reply`,
  ].sort(), 'the repaired gates are exactly the four gates absent from the placed captures');
  assert.equal([...terminalPbGates, ...truckPbGates]
    .filter(brick => !brick.data.size.some(value => value > 0)).length, 0,
  'v12/v7 contains no zero-size procedural gate');

  // Component_Interact is not attachable inside the foreach callable body.
  // Its two rejected labels were harmless but produced placement errors and
  // made the new MaterialOpacity path look broken.
  const bodyEntry = one(rows(truck, C.CallableEntry_ForEachArray.NAME),
    'truck body foreach entry').brick;
  const bodyGrid = bodyEntry.g;
  const bodyBricks = truck.bricks.filter(brick => brick.g === bodyGrid);
  assert.equal(bodyBricks.length, 7, 'body callable retains seven functional gates');
  assert.equal(bodyBricks.flatMap(brick => brick.comps)
    .filter(comp => comp.type === C.Interact.NAME).length, 0,
  'body callable contains no unattached Interact components');
  assert.equal(rows(truck, C.MicrochipInput.NAME,
    (_data, brick) => brick.g === bodyGrid).length, 3,
  'body callable retains Color, Material, and Intensity inputs');
  const bodySetters = rows(truck, C.Exec_SetBrickProperty.NAME,
    (_data, brick) => brick.g === bodyGrid);
  assert.deepEqual(bodySetters.map(item => item.comp.data.Property).sort((a, b) => a - b),
    [1, 2, 3], 'body callable retains Color, Material, and MaterialOpacity writes');
  assert(bodyBricks.every(brick => brick.comps.length === 1),
    'each callable-body brick carries only its functional component');
  const bodyFunctionalTypes = new Set([
    C.CallableEntry_ForEachArray.NAME,
    C.MicrochipInput.NAME,
    C.Exec_SetBrickProperty.NAME,
  ]);
  assert(bodyBricks.every(brick => bodyFunctionalTypes.has(brick.comps[0].type)),
    'callable-body bricks contain only the entry, input, and property-write components');

  // Updated validation must reject the old serialized defect, rather than
  // treating a procedural PB gate with zero extent as an overlap-free point.
  for (const [file, label] of [[previousTerminal, 'v11 terminal'], [previousTruck, 'v6 truck']]) {
    const result = validate(fs.readFileSync(file));
    assert(!result.strictOk, `${label} is rejected by the tightened placement validator`);
    assert(result.invalidBricks.some(item => item.asset.startsWith('PB_Gate_')
      && item.size.every(value => value === 0)),
    `${label} reports its zero-size PB gate explicitly`);
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
    fixedPlacementFailures: {
      explicitPbGateSizes: 4,
      removedUnattachableLabels: 2,
    },
    strictPlacement: true,
    v11BehaviorRegressions: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal, truck, result };
}

if (require.main === module) test({
  terminalInput: process.argv[2] || DEFAULT_V10_TERMINAL,
  truckInput: process.argv[3] || DEFAULT_V5_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V12_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V7_TRUCK,
  builder: process.argv[6] || DEFAULT_V12_BUILDER,
});

module.exports = test;
