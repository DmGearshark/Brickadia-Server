'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV11 = require('./test-scrap-runners-truck1-color-enabled-v11.cjs');
const { C } = require('./loadboard-lib.cjs');

const OUTPUT = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v12.brz');
const BUILDER = path.join(__dirname,
  'build-scrap-runners-truck1-color-enabled-v12.cjs');

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function test({ output = OUTPUT, builder = BUILDER } = {}) {
  testV11();
  const bytes = fs.readFileSync(output);
  const scene = read(bytes);
  assert(validate(bytes).strictOk, 'Truck1 v12 passes strict placement');
  assert.equal(scene.bricks.length, 281, 'v12 has expected brick count');
  assert.equal(scene.edges.length, 220, 'v12 has expected wire count');

  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(row =>
    row.comp.type === type && predicate(row.comp.data, row.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0].brick;
  };
  const linkedGrid = brick => {
    const links = scene.links.filter(link => link.key === brick.key);
    assert.equal(links.length, 1, `one child grid for ${brick.key}`);
    return links[0].grid;
  };
  const edge = (source, sourceType, sourcePort, target, targetType, targetPort, label) =>
    assert.equal(scene.edges.filter(saved => saved.a === source.key && saved.at === sourceType
      && saved.p === sourcePort && saved.z === target.key && saved.zt === targetType
      && saved.q === targetPort).length, 1, label);

  const colorGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Color'), 'Truck1Color getter');
  const materialGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'Truck1Material getter');
  assert.equal(colorGetter.g, materialGetter.g, 'appearance getters share green board');
  const board = colorGetter.g;
  const appearanceChip = one(all(C.TextDisplay.NAME,
    data => data.Text === 'COLOR + MATERIAL\r\nCONTROLLER'), 'appearance chip');
  const ownerChip = one(all(C.TextDisplay.NAME,
    data => data.Text === 'OWNER /\r\nPLAYERSTATE'), 'owner chip');
  assert.equal(appearanceChip.g, board, 'appearance chip is on green board');
  assert.equal(ownerChip.g, board, 'owner chip is on green board');
  const appearanceGrid = linkedGrid(appearanceChip);
  const ownerGrid = linkedGrid(ownerChip);

  const savedColor = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Saved Color Score'),
  'saved color input');
  const savedMaterial = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Saved Material Score'),
  'saved material input');
  const ownerIdInput = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Owner User ID'),
  'owner ID input');
  const vehicleInput = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Vehicle Grid'),
  'vehicle grid input');
  edge(colorGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', savedColor,
    C.MicrochipInput.NAME, 'RER_Input', 'saved color enters controller');
  edge(materialGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', savedMaterial,
    C.MicrochipInput.NAME, 'RER_Input', 'saved material enters controller');

  const ownerOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'owner PlayerState output');
  const ownerIdOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'owner ID output');
  assert.equal(ownerOutput.g, ownerGrid, 'owner PlayerState is inside owner chip');
  assert.equal(ownerIdOutput.g, ownerGrid, 'owner ID is inside owner chip');
  edge(ownerOutput, C.MicrochipOutput.NAME, 'RER_Output', colorGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState', 'owner drives color lookup');
  edge(ownerOutput, C.MicrochipOutput.NAME, 'RER_Output', materialGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState', 'owner drives material lookup');
  edge(ownerIdOutput, C.MicrochipOutput.NAME, 'RER_Output', ownerIdInput,
    C.MicrochipInput.NAME, 'RER_Input', 'owner ID enters appearance controller');

  const reply = one(all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply');
  const colorOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Color'), 'color output');
  const materialOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Material'), 'material output');
  const intensityOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Intensity'), 'intensity output');
  for (const brick of [reply, colorOutput, materialOutput, intensityOutput])
    assert.equal(brick.g, appearanceGrid, 'appearance protocol/output is consolidated');
  edge(ownerIdInput, C.MicrochipInput.NAME, 'RER_Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6', 'reply receives stable owner ID');

  const properties = all(C.Exec_Entity_SetCustomProperty.NAME,
    data => data.Key === 'CurrentColorScore' || data.Key === 'CurrentMaterialEnum')
    .map(row => row.brick);
  assert.equal(properties.length, 2, 'both retained appearance properties exist');
  for (const property of properties) {
    assert.equal(property.g, appearanceGrid, 'appearance property is inside controller');
    edge(vehicleInput, C.MicrochipInput.NAME, 'RER_Output', property,
      C.Exec_Entity_SetCustomProperty.NAME, 'Entity', 'vehicle grid drives property setter');
  }

  const appearanceEvents = new Set(['Interface with Vehicle', 'Restore Truck1Color',
    'SR.Appearance.Request']);
  const appearanceOutputs = new Set(['Output Truck1Color', 'Output Truck1Material',
    'Output Truck1Intensity']);
  assert.equal(scene.bricks.filter(brick => brick.g === board && (
    appearanceEvents.has(component(brick, C.Event_CustomGlobal.NAME)?.data.EventName)
      || appearanceOutputs.has(component(brick, C.MicrochipOutput.NAME)?.data.PortLabel)
      || component(brick, C.Exec_Entity_SetCustomProperty.NAME))).length, 0,
  'green board has no loose appearance protocol gates');
  assert.equal(all(C.Expr_CompareEqual.NAME,
    (_data, brick) => brick.g === appearanceGrid).length >= 2, true,
  'material decoder moved into combined controller');
  assert.equal(all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === ownerGrid && data.EventName === 'UpdateCar').length, 1,
  'owner refresh event moved into owner controller');

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build();
  const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v12 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), bytes, 'checked output matches fresh build');
  assert.equal(first.remappedBrickHandles, 33, 'all stored BrickHandles are remapped');

  const result = {
    output,
    bricks: scene.bricks.length,
    wires: scene.edges.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    visibleGreenBoard: 'two leaderboard getters + appearance chip + owner chip',
    strictPlacement: true,
    deterministic: true,
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) test();
module.exports = test;
