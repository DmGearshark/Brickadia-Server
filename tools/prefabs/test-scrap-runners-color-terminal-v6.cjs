'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_INPUT = '/workspace/attachments/bcdfc39d-2306-4e9a-8022-16b52e64aab0/Updated Frame.brz';
const DEFAULT_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v6.brz');

const valueOf = value => value && typeof value === 'object' && '$variant' in value ? value.value : value;

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

function assertOwner(before, after) {
  const source = before.r.owners();
  const sourceIndex = source.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceIndex >= 0, 'Source owner');
  const id = brdb.guidToUuid(source.UserIds[sourceIndex]).toLowerCase();
  const output = after.r.owners();
  const outputIndex = output.UserIds.map(brdb.guidToUuid).map(value => value.toLowerCase()).indexOf(id);
  assert(outputIndex >= 0, 'Source owner ID preserved');
  assert.equal(output.UserNames[outputIndex], source.UserNames[sourceIndex]);
  assert.equal(output.DisplayNames[outputIndex], source.DisplayNames[sourceIndex]);
  for (const grid of after.r.gridIds()) for (const chunk of after.r.brickChunkIndex(grid)) {
    const soa = after.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputIndex), `Grid ${grid} current owner`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputIndex), `Grid ${grid} original owner`);
  }
}

function assertIntegrity(scene) {
  const keys = new Set(scene.bricks.map(brick => brick.key));
  const targets = new Set();
  for (const edge of scene.edges) {
    assert(keys.has(edge.a), `Dangling source ${edge.a}`);
    assert(keys.has(edge.z), `Dangling target ${edge.z}`);
    const target = `${edge.z}|${edge.zt}|${edge.q}`;
    assert(!targets.has(target), `Duplicate driver ${target}`);
    targets.add(target);
  }
  for (const link of scene.links) assert(keys.has(link.key), `Dangling microchip link ${link.key}`);
  for (const joint of scene.joints || []) assert(keys.has(joint.key), `Dangling joint ${joint.key}`);
}

function visitValues(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  if (Array.isArray(value)) for (const child of value) visitValues(child, callback);
  else for (const child of Object.values(value)) visitValues(child, callback);
}

function countBrickHandles(scene) {
  const targets = new Set(scene.bricks.map(brick => brick.key));
  let count = 0;
  for (const brick of scene.bricks) for (const component of brick.comps) visitValues(component.data, value => {
    if (!Number.isInteger(value?.GridPersistentIndex) || !value.ChunkIndex
      || !Number.isInteger(value.BrickIndexInChunk)
      || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([
      value.GridPersistentIndex, value.ChunkIndex.X, value.ChunkIndex.Y,
      value.ChunkIndex.Z, value.BrickIndexInChunk,
    ]);
    assert(targets.has(key), `Dangling stored BrickHandle ${key}`);
    count++;
  });
  return count;
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

function assertGridFitsPlane(scene, grid) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity?.data?.PlaneCenter && entity?.data?.PlaneExtent, 'Terminal plane metadata');
  for (const brick of scene.bricks.filter(candidate => candidate.g === grid)) {
    for (const [axis, coordinate] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
      assert(distance + halfSize(brick)[coordinate] <= entity.data.PlaneExtent[axis],
        `${brick.key} outside terminal ${axis} plane`);
    }
  }
}

function canonicalRoot(scene) {
  return scene.bricks.filter(brick => brick.g === 1)
    .map(brick => ({ data: brick.data, comps: brick.comps }));
}

function test({ input = DEFAULT_INPUT, output = DEFAULT_OUTPUT } = {}) {
  const source = read(fs.readFileSync(input));
  const terminal = read(fs.readFileSync(output));
  const s = api(source);
  const t = api(terminal);

  assertOwner(source, terminal);
  assertIntegrity(terminal);
  assert.equal(countBrickHandles(terminal), 0, 'Terminal must not contain vehicle BrickHandles');
  assert.deepEqual(terminal.r.externalAssets(), source.r.externalAssets(), 'Configured sound/font assets changed');
  assert.deepEqual(canonicalRoot(terminal), canonicalRoot(source), 'User frame/display/sound geometry changed');

  const sourceEmitters = s.rows.filter(item => item.component.type === C.OneShotAudioEmitter.NAME)
    .map(item => ({ position: item.brick.data.position, data: item.component.data }))
    .sort((a, b) => JSON.stringify(a.position).localeCompare(JSON.stringify(b.position)));
  const outputEmitters = t.rows.filter(item => item.component.type === C.OneShotAudioEmitter.NAME)
    .map(item => ({ position: item.brick.data.position, data: item.component.data }))
    .sort((a, b) => JSON.stringify(a.position).localeCompare(JSON.stringify(b.position)));
  assert.equal(sourceEmitters.length, 6, 'Expected all six configured sounds');
  assert.deepEqual(outputEmitters, sourceEmitters, 'Configured sounds changed');

  const sourceZone = s.row(C.AttachedZone.NAME, () => true, 'source vehicle zone');
  const outputZone = t.row(C.AttachedZone.NAME, () => true, 'output vehicle zone');
  assert.deepEqual(outputZone.brick.data.position, sourceZone.brick.data.position, 'Vehicle zone position changed');
  assert.deepEqual(outputZone.brick.data.size, sourceZone.brick.data.size, 'Vehicle zone size changed');

  const displays = t.rows.filter(item => item.component.type === C.TextDisplay.NAME && item.brick.g === 1
    && item.brick.data.size[0] === 1 && item.brick.data.size[1] === 8 && item.brick.data.size[2] === 12
    && item.component.data.Anchor?.X === 0 && item.component.data.Anchor?.Y === 0)
    .sort((a, b) => a.brick.data.position[1] - b.brick.data.position[1]);
  assert.equal(displays.length, 2, 'Two physical monitor columns');
  const [leftDisplay, rightDisplay] = displays;
  assert.deepEqual(leftDisplay.brick.data.position, [-24895, -51160, 1976]);
  assert.deepEqual(rightDisplay.brick.data.position, [-24895, -51144, 1976]);
  const leftText = t.one(t.incoming(leftDisplay.brick, C.TextDisplay.NAME, 'Text'), 'left display text');
  const rightText = t.one(t.incoming(rightDisplay.brick, C.TextDisplay.NAME, 'Text'), 'right display text');
  const leftFormatter = t.bricks.get(leftText.a);
  const rightFormatter = t.bricks.get(rightText.a);
  assert.equal(leftText.at, C.Expr_String_FormatText.NAME);
  assert.equal(rightText.at, C.Expr_String_FormatText.NAME);
  const leftEnable = t.one(t.incoming(leftDisplay.brick, C.TextDisplay.NAME, 'bEnabled'), 'left display enable');
  const rightEnable = t.one(t.incoming(rightDisplay.brick, C.TextDisplay.NAME, 'bEnabled'), 'right display enable');
  assert.deepEqual({ a: rightEnable.a, at: rightEnable.at, p: rightEnable.p },
    { a: leftEnable.a, at: leftEnable.at, p: leftEnable.p }, 'Both columns must share seat visibility');

  const leftFormat = leftFormatter.comps.find(component => component.type === C.Expr_String_FormatText.NAME).data.FormatString;
  const rightFormat = rightFormatter.comps.find(component => component.type === C.Expr_String_FormatText.NAME).data.FormatString;
  assert.equal(leftFormat,
    'PROCESS: COLOR_CUSTOMIZER\r\nSTATUS: RUNNING\r\n\r\nUSER: {B}\r\nID: {A}\r\nSCRAP: 🔩{C}\r\n\r\nVEHICLE: {D}\r\nCURRENT COLOR: {E}\r\nPREVIEW COLOR: #{F}\r\n\r\n{G}');
  assert.equal(rightFormat,
    'COLOR SETTINGS\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n{E}\r\n\r\n{F}\r\n\r\nW/S SELECT\r\nA/D TAP: 1 | HOLD: REPEAT\r\nC ENTER HEX | SPACE ACTIVATE');
  for (const port of ['InputA', 'InputB', 'InputC', 'InputD', 'InputE', 'InputF', 'InputG'])
    assert.equal(t.incoming(leftFormatter, C.Expr_String_FormatText.NAME, port).length, 1, `Left display ${port}`);
  assert.equal(t.incoming(rightFormatter, C.Expr_String_FormatText.NAME, 'InputG').length, 0,
    'Right controls must not retain the old session block');

  const responseEdge = t.one(t.incoming(leftFormatter, C.Expr_String_FormatText.NAME, 'InputG'), 'system response input');
  const responseVar = t.bricks.get(responseEdge.a);
  assert.equal(responseEdge.at, C.Var.NAME);
  assert.equal(valueOf(responseVar.comps.find(component => component.type === C.Var.NAME).data.Value), 'SYSTEM RESPONSE: READY');

  const price = t.row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === 'PRICE: 🔩{A}\r\n{B}', 'normal price and BUY block');
  assert(t.outgoing(price.brick, C.Expr_String_FormatText.NAME, 'Output')
    .some(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'InputA'), 'Normal block must feed flash selector');

  const settingRows = t.rows.filter(item => item.component.type === C.Expr_String_FormatText.NAME
    && (/^\{A\}(HUE|SATURATION|BRIGHTNESS|MATERIAL|INTENSITY)/.test(item.component.data.FormatString)
      || item.component.data.FormatString === '{A}BUY{B}'));
  assert.equal(settingRows.length, 6, 'Five settings plus BUY row');
  for (const item of settingRows) {
    const suffixPort = item.component.data.FormatString === '{A}BUY{B}' ? 'InputB' : 'InputC';
    const prefix = t.one(t.incoming(item.brick, C.Expr_String_FormatText.NAME, 'InputA'), 'orange row prefix');
    const suffix = t.one(t.incoming(item.brick, C.Expr_String_FormatText.NAME, suffixPort), 'orange row suffix');
    assert.equal(valueOf(t.bricks.get(prefix.a).comps.find(component => component.type === C.Expr_Select.NAME).data.InputB),
      '<color="ff8700">> ');
    assert.equal(valueOf(t.bricks.get(suffix.a).comps.find(component => component.type === C.Expr_Select.NAME).data.InputB),
      ' <</>');
  }

  const responseValues = new Map(t.rows.filter(item => item.component.type === C.Exec_Var_Set.NAME)
    .map(item => [valueOf(item.component.data.Value), item]));
  const expectedResponses = [
    'SYSTEM RESPONSE: READY',
    '<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED</>',
    '<color="ff3030">SYSTEM RESPONSE: NO VEHICLE</>',
    '<color="ff3030">SYSTEM RESPONSE: CANNOT AFFORD</>',
    '<color="ff3030">SYSTEM RESPONSE: COLOR ALREADY APPLIED</>',
  ];
  for (const response of expectedResponses) assert(responseValues.has(response), `Missing response: ${response}`);

  const terminalGrid = t.row(C.EntityZoneEvent_Entered.NAME, () => true, 'zone entered').brick.g;
  const statusMessages = t.rows.filter(item => item.component.type === C.Exec_PlayerState_ShowStatusMessage.NAME);
  assert.equal(statusMessages.length, 1, 'Only invalid-hex player message may remain');
  assert.equal(statusMessages[0].brick.g === terminalGrid, false, 'Remaining invalid-hex message must stay in the hidden core');
  assert.match(statusMessages[0].component.data.Message, /Invalid hex/);
  assert.equal(t.rows.filter(item => item.component.type === C.Expr_String_FormatText.NAME
    && /COLOR PURCHASED|NOT ENOUGH SCRAP/.test(item.component.data.FormatString)).length, 0,
  'Purchase pop-up formatters must be removed');

  const successfulBuy = t.row(C.MicrochipOutput.NAME, data => data.PortLabel === 'Successful Buy', 'Successful Buy output');
  const failedBuy = t.row(C.MicrochipOutput.NAME, data => data.PortLabel === 'Failed Buy', 'Failed Buy output');
  const successSounds = t.outgoing(successfulBuy.brick, C.MicrochipOutput.NAME, 'RER_Output')
    .map(edge => t.bricks.get(edge.z)).filter(brick => brick?.comps.some(component => component.type === C.OneShotAudioEmitter.NAME));
  const failedSounds = t.outgoing(failedBuy.brick, C.MicrochipOutput.NAME, 'RER_Output')
    .map(edge => t.bricks.get(edge.z)).filter(brick => brick?.comps.some(component => component.type === C.OneShotAudioEmitter.NAME));
  assert.equal(successSounds.length, 2, 'Both purchase success sounds preserved');
  assert.equal(failedSounds.length, 1, 'Failed purchase sound preserved');
  const successDriver = t.one(t.incoming(successfulBuy.brick, C.MicrochipOutput.NAME, 'RER_Input'), 'success response driver');
  const successSetter = t.bricks.get(successDriver.a);
  assert.equal(valueOf(successSetter.comps.find(component => component.type === C.Exec_Var_Set.NAME).data.Value),
    '<color="00ff00">SYSTEM RESPONSE: COLOR APPLIED</>');
  assert(t.incoming(successSetter, C.Exec_Var_Set.NAME, 'Exec')
    .some(edge => edge.at === C.Exec_Gamemode_IncrementLeaderboardValue.NAME), 'Success response must follow Scrap debit');

  const splitter = t.row(C.InputSplitter.NAME, () => true, 'seat splitter');
  const space = t.one(t.outgoing(splitter.brick, C.InputSplitter.NAME, 'InputUp'), 'Space guard');
  const buyGuard = t.bricks.get(space.z);
  const buyCondition = t.one(t.incoming(buyGuard, C.Exec_Branch.NAME, 'bCond'), 'BUY selection condition');
  assert.equal(buyCondition.at, C.Expr_CompareEqual.NAME, 'Space guard must allow BUY to report missing vehicles');
  assert.equal(t.outgoing(buyGuard, C.Exec_Branch.NAME, 'ExecOutB').length, 0, 'Space on other rows remains a no-op');

  const noVehicleSetter = responseValues.get('<color="ff3030">SYSTEM RESPONSE: NO VEHICLE</>');
  const noVehicleCause = t.one(t.incoming(noVehicleSetter.brick, C.Exec_Var_Set.NAME, 'Exec'), 'no vehicle cause');
  assert.equal(noVehicleCause.at, C.Exec_Union.NAME);
  const noVehicleUnion = t.bricks.get(noVehicleCause.a);
  assert.equal(t.incoming(noVehicleUnion, C.Exec_Union.NAME, 'ExecA').length, 1, 'Out-of-bounds vehicle path');
  assert.equal(t.incoming(noVehicleUnion, C.Exec_Union.NAME, 'ExecB').length, 1, 'Unsupported vehicle path');
  assert(t.outgoing(noVehicleSetter.brick, C.Exec_Var_Set.NAME, 'ExecOut')
    .some(edge => edge.zt === C.Exec_Union.NAME), 'NO VEHICLE must fire Failed Buy');

  const cannotSetter = responseValues.get('<color="ff3030">SYSTEM RESPONSE: CANNOT AFFORD</>');
  assert(t.incoming(cannotSetter.brick, C.Exec_Var_Set.NAME, 'Exec')
    .some(edge => edge.at === C.Exec_Branch.NAME && edge.p === 'ExecOutB'), 'Funds false must set CANNOT AFFORD');
  assert(t.outgoing(cannotSetter.brick, C.Exec_Var_Set.NAME, 'ExecOut')
    .some(edge => edge.zt === C.Exec_Union.NAME), 'CANNOT AFFORD must fire Failed Buy');
  assert(t.outgoing(cannotSetter.brick, C.Exec_Var_Set.NAME, 'ExecOut')
    .some(edge => edge.zt === C.Exec_Branch.NAME), 'CANNOT AFFORD must start finite flash');
  const sameSetter = responseValues.get('<color="ff3030">SYSTEM RESPONSE: COLOR ALREADY APPLIED</>');
  assert(t.incoming(sameSetter.brick, C.Exec_Var_Set.NAME, 'Exec')
    .some(edge => edge.at === C.Exec_Branch.NAME && edge.p === 'ExecOutB'), 'Same-color false path');
  assert(t.outgoing(sameSetter.brick, C.Exec_Var_Set.NAME, 'ExecOut')
    .some(edge => edge.zt === C.Exec_Union.NAME), 'Same-color response must fire Failed Buy');

  const redBlock = t.row(C.Expr_String_FormatText.NAME,
    data => data.FormatString === '<color="ff3030">PRICE: 🔩{A}\r\n> BUY <</>',
    'red affordability block');
  const flashSelectEdge = t.one(t.outgoing(redBlock.brick, C.Expr_String_FormatText.NAME, 'Output'), 'red block selector');
  assert.equal(flashSelectEdge.zt, C.Expr_Select.NAME);
  assert.equal(flashSelectEdge.q, 'InputB');
  const flashSelect = t.bricks.get(flashSelectEdge.z);
  const flashVisibleEdge = t.one(t.incoming(flashSelect, C.Expr_Select.NAME, 'bSelectB'), 'flash visibility');
  const flashVisible = t.bricks.get(flashVisibleEdge.a);
  assert.equal(flashVisibleEdge.at, C.Var.NAME);
  const flashSetters = t.outgoing(flashVisible, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME)
    .map(edge => t.bricks.get(edge.z));
  assert.equal(flashSetters.filter(brick => valueOf(brick.comps.find(component => component.type === C.Exec_Var_Set.NAME).data.Value) === true).length, 3,
    'Three red blink-on setters');
  assert.equal(flashSetters.filter(brick => valueOf(brick.comps.find(component => component.type === C.Exec_Var_Set.NAME).data.Value) === false).length, 3,
    'Three red blink-off setters');
  const flashBuffers = t.rows.filter(item => item.brick.g === terminalGrid
    && item.component.type === C.BufferSeconds.NAME
    && item.component.data.SecondsToWait === Math.fround(0.2));
  assert.equal(flashBuffers.length, 5, 'Three 0.2s holds and two 0.2s gaps');

  const colorKeyGet = t.row(C.Exec_Entity_GetCustomProperty.NAME,
    data => data.Key === 'ColorLeaderboardKey', 'dynamic color key getter');
  const colorKeySetEdge = t.one(t.outgoing(colorKeyGet.brick, C.Exec_Entity_GetCustomProperty.NAME, 'Value')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'dynamic color key setter');
  const colorKeySet = t.bricks.get(colorKeySetEdge.z);
  const colorKeyVarEdge = t.one(t.incoming(colorKeySet, C.Exec_Var_Set.NAME, 'VarRef'), 'dynamic color key variable');
  const colorKeyVar = t.bricks.get(colorKeyVarEdge.a);
  assert.equal(t.outgoing(colorKeyVar, C.Var.NAME, 'Value').filter(edge => edge.q === 'Key').length, 3,
    'Dynamic vehicle color key still drives purchase read/write and saved display');

  const addedBricks = terminal.bricks.filter(brick => brick.g === terminalGrid && brick.data.position[1] >= 1060);
  assert(addedBricks.length >= 25, 'Complete organized response/flash section');
  for (let index = 0; index < addedBricks.length; index++) for (let candidate = index + 1; candidate < addedBricks.length; candidate++)
    assert(!overlaps(addedBricks[index], addedBricks[candidate]),
      `New feedback bricks overlap: ${addedBricks[index].key} / ${addedBricks[candidate].key}`);
  assertGridFitsPlane(terminal, terminalGrid);

  console.log(JSON.stringify({
    output,
    bricks: terminal.bricks.length,
    wires: terminal.edges.length,
    soundEmitters: outputEmitters.length,
    purchasePopupsRemaining: 0,
    monitorColumns: displays.length,
    orangeRows: settingRows.length,
    redBlinks: 3,
    systemResponses: expectedResponses.length,
    checks: 'passed',
  }, null, 2));
  return { source, terminal };
}

if (require.main === module) test({
  input: process.argv[2] || DEFAULT_INPUT,
  output: process.argv[3] || DEFAULT_OUTPUT,
});

module.exports = test;
