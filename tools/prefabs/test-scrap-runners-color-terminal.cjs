'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_INPUT = '/workspace/attachments/0729ece5-83e9-4bbc-9116-14b1d500027f/Change.brz';
const DEFAULT_OUTPUT = require('path').join(__dirname, '../../outputs/scrap-runners-truck1-color-terminal-v1.brz');

const indexOf = key => Number(JSON.parse(key)[4]);

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

function test({ input = DEFAULT_INPUT, output = DEFAULT_OUTPUT } = {}) {
  const before = read(fs.readFileSync(input));
  const after = read(fs.readFileSync(output));
  const componentRows = scene => scene.bricks.flatMap(brick => brick.comps.map(component => ({ brick, component })));
  const rows = componentRows(after);
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(rows.filter(item => item.component.type === type && predicate(item.component.data, item.brick)), label);
  const incoming = (brick, type, port) => after.edges.filter(edge => edge.z === brick.key && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => after.edges.filter(edge => edge.a === brick.key && edge.at === type && edge.p === port);

  // Preserve the source's non-public owner on every brick and entity.
  const sourceOwners = before.r.owners();
  const sourceOwnerIndex = sourceOwners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceOwnerIndex >= 0, 'Source must have a non-public owner');
  const expectedOwnerId = brdb.guidToUuid(sourceOwners.UserIds[sourceOwnerIndex]).toLowerCase();
  const outputOwners = after.r.owners();
  const outputOwnerIds = outputOwners.UserIds.map(brdb.guidToUuid).map(id => id.toLowerCase());
  const outputOwnerIndex = outputOwnerIds.indexOf(expectedOwnerId);
  assert(outputOwnerIndex >= 0, 'Source owner ID is present in output');
  assert.equal(outputOwners.UserNames[outputOwnerIndex], sourceOwners.UserNames[sourceOwnerIndex], 'Owner name changed');
  assert.equal(outputOwners.DisplayNames[outputOwnerIndex], sourceOwners.DisplayNames[sourceOwnerIndex], 'Owner display name changed');
  for (const grid of after.r.gridIds()) for (const chunk of after.r.brickChunkIndex(grid)) {
    const soa = after.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputOwnerIndex), `grid ${grid} current brick owner changed`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputOwnerIndex), `grid ${grid} original brick owner changed`);
  }
  assert([...after.r.entities()].every(entity => entity.ownerIndex === outputOwnerIndex), 'Entity current owner changed');
  assert([...after.r.entities()].every(entity => entity.originalOwnerIndex === outputOwnerIndex), 'Entity original owner changed');
  const bundle = JSON.parse(Buffer.from(after.r.fs.readFile('Meta/Bundle.json')).toString());
  assert((bundle.authors || []).some(author => (author.iD || author.id || '').toLowerCase() === expectedOwnerId), 'Source owner must remain a bundle author');
  assert.equal(bundle.gameVersion, JSON.parse(Buffer.from(before.r.fs.readFile('Meta/Bundle.json')).toString()).gameVersion, 'Donor game version changed');

  // Purchase settings and menu.
  const cost = row(C.Var.NAME, (data, brick) => data.Value?.value === 100
    && brick.comps.some(component => component.type === C.Interact.NAME && component.data.PromptCustomLabel === 'Color purchase cost'), 'configurable color cost');
  assert.equal(cost.component.data.Value.$variant, 'i64', 'Color cost should remain an integer leaderboard amount');
  const menu = row(C.Expr_String_FormatText.NAME, data => /SPACE BUY COLOR \(\{F\} SCRAP\)/.test(data.FormatString), 'menu purchase instructions');
  const colorConfigGrid = menu.brick.g;
  assert.equal(cost.brick.g, colorConfigGrid, 'Cost and configurable menu must share the main green chip');
  assert(incoming(menu.brick, C.Expr_String_FormatText.NAME, 'InputF').some(edge => edge.a === cost.brick.key), 'Cost must feed menu InputF');

  // General chip retains owner PlayerState.
  const generalGrid = one([...new Set(rows.filter(item => item.component.type === C.Exec_Entity_SetFrozen.NAME).map(item => item.brick.g))], 'general vehicle grid');
  const terminalGrid = row(C.EntityZoneEvent_Left.NAME, () => true, 'terminal vehicle-zone left event').brick.g;
  const ownerEvent = row(C.Event_CustomGlobal.NAME, (data, brick) => brick.g === generalGrid && data.EventName === 'UpdateCar', 'general UpdateCar event');
  const ownerVar = row(C.Var.NAME, (data, brick) => brick.g === generalGrid && data.Value?.$variant === 'weak_object', 'general Owner PlayerState var');
  const ownerOutput = row(C.MicrochipOutput.NAME, (data, brick) => brick.g === generalGrid && data.PortLabel === 'Owner PlayerState', 'Owner PlayerState output');
  assert(outgoing(ownerEvent.brick, C.Event_CustomGlobal.NAME, 'DataOut1').length, 'General UpdateCar must store DataOut1');
  assert(outgoing(ownerVar.brick, C.Var.NAME, 'Value').some(edge => edge.z === ownerOutput.brick.key), 'Owner var must feed output');

  // Existing non-color getters retain the same keys/data and direct UpdateCar inputs.
  const protectedKeys = ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension', 'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1WheelDistance', 'Truck1Material'];
  for (const key of protectedKeys) {
    const oldRows = componentRows(before).filter(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && item.component.data.Key === key);
    const newRows = rows.filter(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && item.component.data.Key === key);
    assert.equal(oldRows.length, 1, `Original ${key}`);
    assert.equal(newRows.length, 1, `Output ${key}`);
    assert.deepEqual(newRows[0].component.data, oldRows[0].component.data, `${key} data changed`);
    const execSource = one(incoming(newRows[0].brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec'), `${key} Exec source`);
    const playerSource = one(incoming(newRows[0].brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'), `${key} PlayerState source`);
    assert.equal(execSource.at, C.Event_CustomGlobal.NAME, `${key} Exec no longer comes from UpdateCar`);
    assert.equal(playerSource.at, C.Event_CustomGlobal.NAME, `${key} PlayerState no longer comes from UpdateCar`);
  }
  const oldMaterialGrid = one([...new Set(componentRows(before).filter(item => item.component.type === C.Var.NAME
    && item.component.data.Value?.$variant === 'dynamic_enum').map(item => item.brick.g))], 'original material decoder grid');
  const newMaterialGrid = one([...new Set(rows.filter(item => item.component.type === C.Var.NAME
    && item.component.data.Value?.$variant === 'dynamic_enum').map(item => item.brick.g))], 'output material decoder grid');
  const oldMaterial = before.bricks.filter(brick => brick.g === oldMaterialGrid).map(brick => brick.comps);
  const newMaterial = after.bricks.filter(brick => brick.g === newMaterialGrid).map(brick => brick.comps);
  assert.deepEqual(newMaterial, oldMaterial, 'Truck1Material decoder changed');

  // Only the color getter is routed through the retained owner and restore event.
  const colorGetter = row(C.Exec_Gamemode_GetLeaderboardValue.NAME, data => data.Key === 'Truck1Color' && data.Value === 4977664, 'vehicle Truck1Color getter');
  const colorPlayerSource = one(incoming(colorGetter.brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'), 'Truck1Color PlayerState source');
  assert.equal(colorPlayerSource.a, ownerOutput.brick.key, 'Truck1Color must use retained general-chip PlayerState');
  const restoreEvent = row(C.Event_CustomGlobal.NAME, data => data.EventName === 'Restore Truck1Color' && data.bIsObjectEvent, 'vehicle restore event');
  assert(outgoing(restoreEvent.brick, C.Event_CustomGlobal.NAME, 'ExecOut').length, 'Restore event must pulse color path');

  // Dedicated controller contains both saved/preview sets and the body array/application loop.
  const controllerGrid = one([...new Set(rows.filter(item => item.component.type === C.ArrayVar.NAME
    && item.component.data.Value?.$elementType === 'brick_handle').map(item => item.brick.g))], 'Truck1Color controller grid');
  const controllerBricks = after.bricks.filter(brick => brick.g === controllerGrid);
  assert(controllerBricks.some(brick => brick.comps.some(component => component.type === C.Var.NAME && component.data.Value?.$variant === 'LinearColor')), 'Color display var not inside controller');
  assert.equal(controllerBricks.filter(brick => brick.comps.some(component => component.type === C.Exec_Var_Set.NAME)).length, 2, 'Controller needs saved and preview VarSets');
  assert(controllerBricks.some(brick => brick.comps.some(component => component.type === C.ArrayVar.NAME && component.data.Value?.$elementType === 'brick_handle')), 'Body array not inside controller');
  assert(controllerBricks.some(brick => brick.comps.some(component => component.type === C.Expr_ChangeDetector.NAME)), 'Body color change detector not inside controller');
  assert(after.bricks.find(brick => brick.comps.some(component => component.type === C.TextDisplay.NAME && /TRUCK1COLOR/.test(component.data.Text))), 'Controller chip label missing');

  // Expanded, human-readable layouts must remain on their microchip planes.
  function assertGridFitsPlane(grid, label) {
    const entity = [...after.r.entities()].find(candidate => candidate.persistentIndex === grid);
    assert(entity?.data?.PlaneCenter && entity?.data?.PlaneExtent, `${label} plane metadata`);
    for (const brick of after.bricks.filter(candidate => candidate.g === grid)) {
      for (const [axis, coordinate] of [['X', 0], ['Y', 1], ['Z', 2]]) {
        const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
        const halfSize = brick.data.size?.[coordinate] || 0;
        assert(distance + halfSize <= entity.data.PlaneExtent[axis],
          `${label} brick ${brick.key} is off-plane on ${axis}: ${distance}+${halfSize} > ${entity.data.PlaneExtent[axis]}`);
      }
    }
  }
  assertGridFitsPlane(terminalGrid, 'terminal organization');
  assertGridFitsPlane(generalGrid, 'general PlayerState organization');
  assertGridFitsPlane(controllerGrid, 'Truck1Color controller organization');

  // Every persistent BrickHandle must resolve after the writer renumbers grids.
  const validBrickTargets = new Set(after.bricks.map(brick => brick.key));
  let brickHandleCount = 0;
  for (const brick of after.bricks) for (const savedComponent of brick.comps) visitValues(savedComponent.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    assert(validBrickTargets.has(key), `Dangling stored BrickHandle: ${key}`);
    brickHandleCount++;
  });
  assert(brickHandleCount >= 31, `Expected the Truck1 body references, found ${brickHandleCount}`);

  // Proven encoder topology.
  const split = row(C.Expr_SplitColorSRGB.NAME, (_data, brick) => brick.g === terminalGrid, 'SplitColorSRGB encoder');
  const redMultiply = row(C.Expr_MathMultiply.NAME, data => data.InputB?.value === 65536, 'red x65536');
  const greenMultiply = row(C.Expr_MathMultiply.NAME, data => data.InputB?.value === 256, 'green x256');
  assert(outgoing(split.brick, C.Expr_SplitColorSRGB.NAME, 'R').some(edge => edge.z === redMultiply.brick.key), 'R encoder wire');
  assert(outgoing(split.brick, C.Expr_SplitColorSRGB.NAME, 'G').some(edge => edge.z === greenMultiply.brick.key), 'G encoder wire');
  const packedAdds = rows.filter(item => item.brick.g === terminalGrid && item.component.type === C.Expr_MathAdd.NAME
    && outgoing(item.brick, C.Expr_MathAdd.NAME, 'Output').some(edge => edge.zt === C.Exec_Gamemode_SetLeaderboardValue.NAME || edge.zt === C.Expr_CompareNotEqual.NAME));
  assert.equal(packedAdds.length, 1, 'One final packed RGB output');

  // Transaction: affordability + changed color -> Set Truck1Color -> debit Scrap.
  const setColor = row(C.Exec_Gamemode_SetLeaderboardValue.NAME, data => data.Key === 'Truck1Color', 'Truck1Color setter');
  const debit = row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME, data => data.Key === 'Scrap', 'Scrap debit');
  assert(outgoing(setColor.brick, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut').some(edge => edge.z === debit.brick.key && edge.q === 'Exec'), 'Set color must precede debit');
  assert(incoming(setColor.brick, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value').some(edge => packedAdds[0].brick.key === edge.a), 'Packed RGB must feed Truck1Color setter');
  assert(incoming(debit.brick, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Value').some(edge => edge.at === C.Expr_MathNegate.NAME), 'Configurable negative cost must feed debit');
  assert(rows.some(item => item.component.type === C.Expr_CompareGreaterOrEqual.NAME
    && incoming(item.brick, C.Expr_CompareGreaterOrEqual.NAME, 'InputB').some(edge => edge.a === cost.brick.key)), 'Affordability must use configurable cost');
  assert(rows.some(item => item.component.type === C.Expr_CompareNotEqual.NAME
    && outgoing(item.brick, C.Expr_CompareNotEqual.NAME, 'bOutput').some(edge => edge.zt === C.Exec_Branch.NAME)), 'Same saved color must be rejected');

  // Space starts purchase, not preview. Color changes drive guarded preview.
  const inputSplitter = row(C.InputSplitter.NAME, (_data, brick) => brick.g !== generalGrid, 'color-customizer seat input splitter');
  const previewSend = row(C.Exec_SendCustomEventGlobal.NAME, data => data.EventName === 'Interface with Vehicle', 'preview sender');
  assert(!after.edges.some(edge => edge.a === inputSplitter.brick.key && edge.p === 'InputUp' && edge.z === previewSend.brick.key), 'Space still previews');
  assert(after.edges.some(edge => edge.a === inputSplitter.brick.key && edge.p === 'InputUp' && edge.zt === C.Exec_ArrayVar_Get.NAME), 'Space must start guarded purchase');
  assert(incoming(previewSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn').some(edge => edge.at === C.Exec_Branch.NAME), 'Preview sender must be target-guarded');

  // Zone exit targets the exact leaving entity and triggers only the color restore event.
  const restoreSend = row(C.Exec_SendCustomEventGlobal.NAME, data => data.EventName === 'Restore Truck1Color', 'zone-exit restore sender');
  assert.equal(restoreSend.component.data.DataIn1.$variant, restoreEvent.component.data.DataOut1.$variant, 'Restore sender/receiver signature mismatch');
  const targetEdge = one(incoming(restoreSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'Target'), 'restore Target');
  const execEdge = one(incoming(restoreSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'), 'restore Exec');
  assert.equal(targetEdge.at, C.EntityZoneEvent_Left.NAME, 'Restore Target must be ZoneLeft.Entity');
  assert.equal(targetEdge.p, 'Entity');
  assert.equal(execEdge.at, C.EntityZoneEvent_Left.NAME, 'Restore Exec must be ZoneLeft.Exec');
  assert.equal(execEdge.p, 'Exec');

  // Numeric codec sanity checks against the existing integer decoder contract.
  const pack = (r, g, b) => r * 65536 + g * 256 + b;
  const unpack = value => [Math.floor(value / 65536), Math.floor(value / 256) % 256, value % 256];
  assert.equal(pack(255, 0, 0), 0xFF0000);
  assert.equal(pack(0, 255, 0), 0x00FF00);
  assert.equal(pack(0, 0, 255), 0x0000FF);
  assert.deepEqual(unpack(4977664), [75, 244, 0]);

  console.log(JSON.stringify({
    output,
    bricks: after.bricks.length,
    wires: after.edges.length,
    colorCost: 100,
    validatedBrickHandles: brickHandleCount,
    protectedLeaderboardGetters: protectedKeys,
    checks: 'passed',
  }, null, 2));
  return after;
}

if (require.main === module) test({ input: process.argv[2] || DEFAULT_INPUT, output: process.argv[3] || DEFAULT_OUTPUT });

module.exports = test;
