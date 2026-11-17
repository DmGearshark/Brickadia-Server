'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_INPUT = '/workspace/attachments/0729ece5-83e9-4bbc-9116-14b1d500027f/Change.brz';
const DEFAULT_TERMINAL_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v3.brz');
const DEFAULT_TRUCK_OUTPUT = path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v3.brz');

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
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key && edge.at === type && edge.p === port);
  return { rows, bricks, one, row, incoming, outgoing };
}

function assertOwnerAndMetadata(before, scene, label) {
  const sourceOwners = before.r.owners();
  const sourceOwnerIndex = sourceOwners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(sourceOwnerIndex >= 0, 'Source must have a non-public owner');
  const expectedOwnerId = brdb.guidToUuid(sourceOwners.UserIds[sourceOwnerIndex]).toLowerCase();
  const outputOwners = scene.r.owners();
  const outputOwnerIds = outputOwners.UserIds.map(brdb.guidToUuid).map(id => id.toLowerCase());
  const outputOwnerIndex = outputOwnerIds.indexOf(expectedOwnerId);
  assert(outputOwnerIndex >= 0, `${label}: source owner ID is present`);
  assert.equal(outputOwners.UserNames[outputOwnerIndex], sourceOwners.UserNames[sourceOwnerIndex], `${label}: owner name changed`);
  assert.equal(outputOwners.DisplayNames[outputOwnerIndex], sourceOwners.DisplayNames[sourceOwnerIndex], `${label}: owner display name changed`);
  for (const grid of scene.r.gridIds()) for (const chunk of scene.r.brickChunkIndex(grid)) {
    const soa = scene.r.brickChunkSoa(grid, chunk.index);
    assert(soa.OwnerIndices.every(index => index === outputOwnerIndex), `${label}: grid ${grid} current owner changed`);
    assert(soa.OriginalOwnerIndices.every(index => index === outputOwnerIndex), `${label}: grid ${grid} original owner changed`);
  }
  assert([...scene.r.entities()].every(entity => entity.ownerIndex === outputOwnerIndex), `${label}: entity current owner changed`);
  assert([...scene.r.entities()].every(entity => entity.originalOwnerIndex === outputOwnerIndex), `${label}: entity original owner changed`);
  const bundle = JSON.parse(Buffer.from(scene.r.fs.readFile('Meta/Bundle.json')).toString());
  assert((bundle.authors || []).some(author => (author.iD || author.id || '').toLowerCase() === expectedOwnerId), `${label}: bundle author missing`);
  const donorBundle = JSON.parse(Buffer.from(before.r.fs.readFile('Meta/Bundle.json')).toString());
  assert.equal(bundle.gameVersion, donorBundle.gameVersion, `${label}: donor game version changed`);
}

function assertIntegrity(scene, label) {
  const brickKeys = new Set(scene.bricks.map(brick => brick.key));
  const grids = new Set(scene.r.gridIds());
  const entities = new Set([...scene.r.entities()].map(entity => entity.persistentIndex));
  for (const edge of scene.edges) {
    assert(brickKeys.has(edge.a), `${label}: dangling wire source ${edge.a}`);
    assert(brickKeys.has(edge.z), `${label}: dangling wire target ${edge.z}`);
  }
  for (const link of scene.links) {
    assert(brickKeys.has(link.key), `${label}: dangling microchip-link brick`);
    assert(grids.has(link.grid), `${label}: dangling microchip-link grid ${link.grid}`);
  }
  for (const joint of scene.joints || []) {
    assert(brickKeys.has(joint.key), `${label}: dangling joint brick`);
    assert(entities.has(joint.entity), `${label}: dangling joint entity ${joint.entity}`);
  }
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

function assertGridFitsPlane(scene, grid, label) {
  const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
  assert(entity?.data?.PlaneCenter && entity?.data?.PlaneExtent, `${label}: plane metadata`);
  for (const brick of scene.bricks.filter(candidate => candidate.g === grid)) {
    for (const [axis, coordinate] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      const distance = Math.abs(brick.data.position[coordinate] - entity.data.PlaneCenter[axis]);
      const halfSize = brick.data.size?.[coordinate] || 0;
      assert(distance + halfSize <= entity.data.PlaneExtent[axis],
        `${label}: brick ${brick.key} off-plane on ${axis}: ${distance}+${halfSize} > ${entity.data.PlaneExtent[axis]}`);
    }
  }
}

function bricksOverlap(first, second) {
  const halfSize = brick => {
    if (brick.data.size?.some(value => value > 0)) return brick.data.size;
    if (brick.data.asset.startsWith('B_1x1_Gate_')) return [5, 5, 2];
    return [0, 0, 0];
  };
  const a = halfSize(first);
  const b = halfSize(second);
  return [0, 1, 2].every(axis => Math.abs(first.data.position[axis] - second.data.position[axis]) < a[axis] + b[axis]);
}

function test({ input = DEFAULT_INPUT, terminalOutput = DEFAULT_TERMINAL_OUTPUT, truckOutput = DEFAULT_TRUCK_OUTPUT } = {}) {
  const before = read(fs.readFileSync(input));
  const terminal = read(fs.readFileSync(terminalOutput));
  const truck = read(fs.readFileSync(truckOutput));
  const sourceRows = before.bricks.flatMap(brick => brick.comps.map(component => ({ brick, component })));
  const t = api(terminal);
  const v = api(truck);

  assertOwnerAndMetadata(before, terminal, 'terminal');
  assertOwnerAndMetadata(before, truck, 'truck');
  assertIntegrity(terminal, 'terminal');
  assertIntegrity(truck, 'truck');

  // The terminal artifact is genuinely terminal-only: root, swatch, and three
  // microchips. No hidden test vehicle, vehicle receiver, or truck stat logic.
  const terminalEntities = [...terminal.r.entities()];
  assert.equal(terminal.r.gridIds().length, 5, 'Terminal should contain root + swatch + 3 microchip grids');
  assert.equal(terminalEntities.filter(entity => entity.typeName === 'Entity_DynamicBrickGrid').length, 1, 'Terminal should retain only its preview swatch dynamic grid');
  assert.equal(terminalEntities.filter(entity => entity.typeName === 'Entity_MicrochipDynamicBrickGrid').length, 3, 'Terminal should retain exactly three microchips');
  assert(!terminalEntities.some(entity => entity.typeName.startsWith('Entity_Wheel_')), 'Terminal still contains a vehicle wheel');
  assert(!terminalEntities.some(entity => entity.data?.EntityTag === 'Vehicle'), 'Terminal still contains a tagged vehicle');
  assert(!t.rows.some(item => item.component.type === C.Event_CustomGlobal.NAME && ['UpdateCar', 'Restore Truck1Color'].includes(item.component.data.EventName)), 'Terminal still contains vehicle-side event receivers');
  assert(!t.rows.some(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME
    && /^Truck1/.test(item.component.data.Key) && item.component.data.Key !== 'Truck1Color'), 'Terminal still contains non-color Truck1 getters');
  assert.equal(t.rows.filter(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME
    && item.component.data.Key === 'Truck1Color').length, 1, 'Terminal should retain only its purchase-time Truck1Color read');
  assert.equal(countAndValidateBrickHandles(terminal, 'terminal'), 0, 'Terminal should not retain truck body BrickHandles');

  // Purchase settings and configurable menu remain in the terminal.
  const cost = t.row(C.Var.NAME, (data, brick) => data.Value?.value === 100
    && brick.comps.some(component => component.type === C.Interact.NAME && component.data.PromptCustomLabel === 'Color purchase cost'), 'configurable color cost');
  assert.equal(cost.component.data.Value.$variant, 'i64', 'Color cost should remain an integer');
  const menu = t.row(C.Expr_String_FormatText.NAME, data => /SPACE BUY COLOR \(\{F\} SCRAP\)/.test(data.FormatString), 'menu purchase instructions');
  const colorConfigGrid = menu.brick.g;
  assert.equal(cost.brick.g, colorConfigGrid, 'Cost and menu must share the green config chip');
  assert(t.incoming(menu.brick, C.Expr_String_FormatText.NAME, 'InputF').some(edge => edge.a === cost.brick.key), 'Cost must feed menu InputF');

  const terminalGrid = t.row(C.EntityZoneEvent_Left.NAME, () => true, 'terminal zone-left event').brick.g;
  const inputSplitter = t.row(C.InputSplitter.NAME, () => true, 'color-customizer seat input splitter');
  const previewSend = t.row(C.Exec_SendCustomEventGlobal.NAME, data => data.EventName === 'Interface with Vehicle', 'preview sender');
  const selectedColor = t.row(C.MicrochipOutput.NAME, (data, brick) => data.PortLabel === 'Color'
    && t.outgoing(brick, C.MicrochipOutput.NAME, 'RER_Output').some(edge => edge.z === previewSend.brick.key), 'selected Color output');
  assert(t.incoming(previewSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'DataIn1').some(edge => edge.a === selectedColor.brick.key), 'Selected color must feed preview payload');
  const livePreviewLabel = t.row(C.TextDisplay.NAME, data => /^LIVE VEHICLE PREVIEW/.test(data.Text), 'live-preview organization label');
  const leftInputDetector = t.row(C.Expr_EdgeDetectorExec.NAME, (_data, brick) => brick.g === selectedColor.brick.g
    && brick.data.position[0] === 528 && brick.data.position[1] === 48, 'left-input edge detector');
  assert(!bricksOverlap(livePreviewLabel.brick, leftInputDetector.brick), 'Live-preview label physically overlaps the left-input edge detector');
  assert.equal(terminal.edges.filter(edge => edge.a === leftInputDetector.brick.key || edge.z === leftInputDetector.brick.key).length, 7,
    'Left-input edge detector must retain all seven placement-sensitive wires');

  // Walk from the guarded preview sender back to the enter/change union.
  const previewBranchEdge = t.one(t.incoming(previewSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'), 'preview sender ExecIn');
  assert.equal(previewBranchEdge.at, C.Exec_Branch.NAME, 'Preview sender must be target-guarded');
  const previewBranch = t.bricks.get(previewBranchEdge.a);
  const targetGetEdge = t.one(t.incoming(previewBranch, C.Exec_Branch.NAME, 'Exec'), 'preview guard Exec');
  assert.equal(targetGetEdge.at, C.Exec_ArrayVar_Get.NAME, 'Preview guard must follow vehicle array get');
  const targetGet = t.bricks.get(targetGetEdge.a);
  const previewUnionEdge = t.one(t.incoming(targetGet, C.Exec_ArrayVar_Get.NAME, 'Exec'), 'preview target-get Exec');
  assert.equal(previewUnionEdge.at, C.Exec_Union.NAME, 'Preview target get must follow enter/change union');
  const previewUnion = t.bricks.get(previewUnionEdge.a);
  const enterEdge = t.one(t.incoming(previewUnion, C.Exec_Union.NAME, 'ExecA'), 'preview enter pulse');
  assert.equal(enterEdge.at, C.Exec_ArrayVar_Insert.NAME, 'Zone insert must request the initial preview');
  const changeEdge = t.one(t.incoming(previewUnion, C.Exec_Union.NAME, 'ExecB'), 'preview color-change pulse');
  assert.equal(changeEdge.at, C.BufferTicks.NAME, 'Live preview must use the buffered H/S/B write pulse, not a ChangeDetector');
  const previewDelay = t.bricks.get(changeEdge.a);
  const previewDelayData = previewDelay.comps.find(component => component.type === C.BufferTicks.NAME).data;
  assert.equal(previewDelayData.TicksToWait, 1, 'Live preview should wait exactly one tick');
  assert(!t.incoming(previewUnion, C.Exec_Union.NAME, 'ExecB').some(edge => edge.at === C.Expr_ChangeDetector.NAME), 'Failed ChangeDetector preview path remains');

  // Recursively prove all 15 actual H/S/B VarSet completion pulses feed the buffer.
  const setterKeys = new Set();
  const walkPulse = edge => {
    if (edge.at === C.Exec_Var_Set.NAME && edge.p === 'ExecOut') {
      setterKeys.add(edge.a);
      return;
    }
    assert.equal(edge.at, C.Exec_Union.NAME, `Unexpected live-preview pulse source ${edge.at}.${edge.p}`);
    const union = t.bricks.get(edge.a);
    walkPulse(t.one(t.incoming(union, C.Exec_Union.NAME, 'ExecA'), 'preview union ExecA'));
    walkPulse(t.one(t.incoming(union, C.Exec_Union.NAME, 'ExecB'), 'preview union ExecB'));
  };
  walkPulse(t.one(t.incoming(previewDelay, C.BufferTicks.NAME, 'Input'), 'preview delay input'));
  assert.equal(setterKeys.size, 15, 'All 15 H/S/B setters must trigger live preview');
  const varCounts = new Map();
  for (const key of setterKeys) {
    const setter = t.bricks.get(key);
    const varEdge = t.one(t.incoming(setter, C.Exec_Var_Set.NAME, 'VarRef'), 'preview setter VarRef');
    varCounts.set(varEdge.a, (varCounts.get(varEdge.a) || 0) + 1);
  }
  assert.deepEqual([...varCounts.values()].sort((a, b) => a - b), [5, 5, 5], 'Hue, Saturation, and Brightness should each have five write paths');
  const hsbDefaults = [...varCounts.keys()].map(key => {
    const variable = t.bricks.get(key);
    return variable.comps.find(component => component.type === C.Var.NAME).data.Value.value;
  }).sort((a, b) => a - b);
  assert.deepEqual(hsbDefaults, [100, 100, 286], 'Live-preview variables are not H/S/B');

  // Space starts purchase only; color writes and zone entry start preview.
  assert(!terminal.edges.some(edge => edge.a === inputSplitter.brick.key && edge.p === 'InputUp' && edge.z === previewSend.brick.key), 'Space still directly previews');
  assert(terminal.edges.some(edge => edge.a === inputSplitter.brick.key && edge.p === 'InputUp' && edge.zt === C.Exec_ArrayVar_Get.NAME), 'Space must start guarded purchase');

  // Proven RGB integer encoder and purchase transaction.
  const split = t.row(C.Expr_SplitColorSRGB.NAME, (_data, brick) => brick.g === terminalGrid, 'SplitColorSRGB encoder');
  const redMultiply = t.row(C.Expr_MathMultiply.NAME, data => data.InputB?.value === 65536, 'red x65536');
  const greenMultiply = t.row(C.Expr_MathMultiply.NAME, data => data.InputB?.value === 256, 'green x256');
  assert(t.outgoing(split.brick, C.Expr_SplitColorSRGB.NAME, 'R').some(edge => edge.z === redMultiply.brick.key), 'R encoder wire');
  assert(t.outgoing(split.brick, C.Expr_SplitColorSRGB.NAME, 'G').some(edge => edge.z === greenMultiply.brick.key), 'G encoder wire');
  const packedAdds = t.rows.filter(item => item.brick.g === terminalGrid && item.component.type === C.Expr_MathAdd.NAME
    && t.outgoing(item.brick, C.Expr_MathAdd.NAME, 'Output').some(edge => edge.zt === C.Exec_Gamemode_SetLeaderboardValue.NAME || edge.zt === C.Expr_CompareNotEqual.NAME));
  assert.equal(packedAdds.length, 1, 'One final packed RGB output');
  const setColor = t.row(C.Exec_Gamemode_SetLeaderboardValue.NAME, data => data.Key === 'Truck1Color', 'Truck1Color setter');
  const debit = t.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME, data => data.Key === 'Scrap', 'Scrap debit');
  assert(t.outgoing(setColor.brick, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut').some(edge => edge.z === debit.brick.key && edge.q === 'Exec'), 'Set color must precede debit');
  assert(t.incoming(setColor.brick, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value').some(edge => edge.a === packedAdds[0].brick.key), 'Packed RGB must feed setter');
  assert(t.incoming(debit.brick, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Value').some(edge => edge.at === C.Expr_MathNegate.NAME), 'Negative configurable cost must feed debit');
  assert(t.rows.some(item => item.component.type === C.Expr_CompareGreaterOrEqual.NAME
    && t.incoming(item.brick, C.Expr_CompareGreaterOrEqual.NAME, 'InputB').some(edge => edge.a === cost.brick.key)), 'Affordability must use configurable cost');

  // Truck-only artifact keeps the existing spawner contract and vehicle logic.
  const vehicleRoot = v.one([...truck.r.entities()].filter(entity => entity.data?.EntityTag === 'Vehicle'), 'tagged vehicle root');
  assert.deepEqual(vehicleRoot.location, { X: 0, Y: 0, Z: 0 }, 'Truck prefab should be centered on its vehicle root for the existing spawner');
  assert.equal([...truck.r.entities()].filter(entity => entity.typeName.startsWith('Entity_Wheel_')).length, 4, 'Truck artifact should retain four wheels');
  assert(!v.rows.some(item => [C.EntityZoneEvent_Left.NAME, C.EntityZoneEvent_Entered.NAME].includes(item.component.type)), 'Truck artifact still contains terminal zone logic');
  assert(!v.rows.some(item => item.component.type === C.Exec_SendCustomEventGlobal.NAME && item.component.data.EventName === 'Interface with Vehicle'), 'Truck artifact still contains terminal preview sender');
  assert(!v.rows.some(item => item.component.type === C.Interact.NAME && item.component.data.PromptCustomLabel === 'Color purchase cost'), 'Truck artifact still contains terminal purchase config');

  const generalGrid = v.one([...new Set(v.rows.filter(item => item.component.type === C.Exec_Entity_SetFrozen.NAME).map(item => item.brick.g))], 'general vehicle grid');
  const ownerEvent = v.row(C.Event_CustomGlobal.NAME, (data, brick) => brick.g === generalGrid && data.EventName === 'UpdateCar', 'general UpdateCar event');
  const ownerVar = v.row(C.Var.NAME, (data, brick) => brick.g === generalGrid && data.Value?.$variant === 'weak_object', 'general Owner PlayerState var');
  const ownerOutput = v.row(C.MicrochipOutput.NAME, (data, brick) => brick.g === generalGrid && data.PortLabel === 'Owner PlayerState', 'Owner PlayerState output');
  assert(v.outgoing(ownerEvent.brick, C.Event_CustomGlobal.NAME, 'DataOut1').length, 'General UpdateCar must store DataOut1');
  assert(v.outgoing(ownerVar.brick, C.Var.NAME, 'Value').some(edge => edge.z === ownerOutput.brick.key), 'Owner var must feed output');

  const protectedKeys = ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension', 'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1WheelDistance', 'Truck1Material'];
  for (const key of protectedKeys) {
    const oldRows = sourceRows.filter(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && item.component.data.Key === key);
    const newRows = v.rows.filter(item => item.component.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && item.component.data.Key === key);
    assert.equal(oldRows.length, 1, `Original ${key}`);
    assert.equal(newRows.length, 1, `Truck ${key}`);
    assert.deepEqual(newRows[0].component.data, oldRows[0].component.data, `${key} data changed`);
    const execSource = v.one(v.incoming(newRows[0].brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec'), `${key} Exec source`);
    const playerSource = v.one(v.incoming(newRows[0].brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'), `${key} PlayerState source`);
    assert.equal(execSource.at, C.Event_CustomGlobal.NAME, `${key} Exec no longer comes from UpdateCar`);
    assert.equal(playerSource.at, C.Event_CustomGlobal.NAME, `${key} PlayerState no longer comes from UpdateCar`);
  }

  const oldMaterialGrid = new Set(sourceRows.filter(item => item.component.type === C.Var.NAME
    && item.component.data.Value?.$variant === 'dynamic_enum').map(item => item.brick.g));
  const newMaterialGrid = new Set(v.rows.filter(item => item.component.type === C.Var.NAME
    && item.component.data.Value?.$variant === 'dynamic_enum').map(item => item.brick.g));
  assert.equal(oldMaterialGrid.size, 1, 'Original material decoder grid');
  assert.equal(newMaterialGrid.size, 1, 'Truck material decoder grid');
  const oldMaterial = before.bricks.filter(brick => brick.g === [...oldMaterialGrid][0]).map(brick => brick.comps);
  const newMaterial = truck.bricks.filter(brick => brick.g === [...newMaterialGrid][0]).map(brick => brick.comps);
  assert.deepEqual(newMaterial, oldMaterial, 'Truck1Material decoder changed');

  const colorGetter = v.row(C.Exec_Gamemode_GetLeaderboardValue.NAME, data => data.Key === 'Truck1Color' && data.Value === 4977664, 'vehicle Truck1Color getter');
  const colorPlayerSource = v.one(v.incoming(colorGetter.brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState'), 'Truck1Color PlayerState source');
  assert.equal(colorPlayerSource.a, ownerOutput.brick.key, 'Truck1Color must use retained owner PlayerState');
  const restoreEvent = v.row(C.Event_CustomGlobal.NAME, data => data.EventName === 'Restore Truck1Color' && data.bIsObjectEvent, 'vehicle restore event');
  assert(v.outgoing(restoreEvent.brick, C.Event_CustomGlobal.NAME, 'ExecOut').length, 'Restore event must pulse color path');
  const previewEvent = v.row(C.Event_CustomGlobal.NAME, data => data.EventName === 'Interface with Vehicle' && data.bIsObjectEvent, 'vehicle live-preview event');
  const previewExec = v.one(v.outgoing(previewEvent.brick, C.Event_CustomGlobal.NAME, 'ExecOut'), 'vehicle preview ExecOut');
  const previewValue = v.one(v.outgoing(previewEvent.brick, C.Event_CustomGlobal.NAME, 'DataOut1'), 'vehicle preview DataOut1');
  assert.equal(previewExec.zt, C.Exec_Var_Set.NAME, 'Vehicle preview execution must feed the temporary color setter');
  assert.equal(previewValue.zt, C.Exec_Var_Set.NAME, 'Vehicle preview color must feed the temporary color setter');
  assert.equal(previewExec.z, previewValue.z, 'Vehicle preview execution and color must feed the same setter');

  const restoreLabel = v.row(C.TextDisplay.NAME, data => /^TRUCK1COLOR LOAD \/ RESTORE/.test(data.Text), 'Truck1Color restore label');
  const savedLabel = v.row(C.TextDisplay.NAME, data => data.Text === 'SAVED SCORE -> RGB', 'saved-color label');
  const displayLabel = v.row(C.TextDisplay.NAME, data => /^DISPLAY COLOR/.test(data.Text), 'display-color label');
  assert(!bricksOverlap(restoreLabel.brick, previewEvent.brick), 'Restore label physically overlaps the vehicle preview event');
  assert(!bricksOverlap(savedLabel.brick, displayLabel.brick), 'Saved/display color labels physically overlap');

  const controllerGrid = v.one([...new Set(v.rows.filter(item => item.component.type === C.ArrayVar.NAME
    && item.component.data.Value?.$elementType === 'brick_handle').map(item => item.brick.g))], 'Truck1Color controller grid');
  const controllerBricks = truck.bricks.filter(brick => brick.g === controllerGrid);
  assert(controllerBricks.some(brick => brick.comps.some(component => component.type === C.Var.NAME && component.data.Value?.$variant === 'LinearColor')), 'Color display var not inside controller');
  assert.equal(controllerBricks.filter(brick => brick.comps.some(component => component.type === C.Exec_Var_Set.NAME)).length, 2, 'Controller needs saved and preview VarSets');
  assert(controllerBricks.some(brick => brick.comps.some(component => component.type === C.Expr_ChangeDetector.NAME)), 'Body color application detector missing');
  assert.equal(countAndValidateBrickHandles(truck, 'truck'), 33, 'Truck must retain 31 body and 2 application-loop BrickHandles');

  // Terminal exit sender and truck receiver deliberately live in separate prefabs.
  const restoreSend = t.row(C.Exec_SendCustomEventGlobal.NAME, data => data.EventName === 'Restore Truck1Color', 'zone-exit restore sender');
  assert.equal(restoreSend.component.data.DataIn1.$variant, restoreEvent.component.data.DataOut1.$variant, 'Restore sender/receiver signature mismatch');
  const restoreTarget = t.one(t.incoming(restoreSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'Target'), 'restore Target');
  const restoreExec = t.one(t.incoming(restoreSend.brick, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'), 'restore Exec');
  assert.equal(restoreTarget.at, C.EntityZoneEvent_Left.NAME, 'Restore target must be ZoneLeft.Entity');
  assert.equal(restoreTarget.p, 'Entity');
  assert.equal(restoreExec.at, C.EntityZoneEvent_Left.NAME, 'Restore execution must be ZoneLeft.Exec');
  assert.equal(restoreExec.p, 'Exec');

  assertGridFitsPlane(terminal, terminalGrid, 'terminal organization');
  assertGridFitsPlane(terminal, selectedColor.brick.g, 'color-core live-preview organization');
  assertGridFitsPlane(truck, generalGrid, 'general PlayerState organization');
  assertGridFitsPlane(truck, controllerGrid, 'Truck1Color controller organization');

  // Numeric codec sanity checks against the existing integer decoder contract.
  const pack = (r, g, b) => r * 65536 + g * 256 + b;
  const unpack = value => [Math.floor(value / 65536), Math.floor(value / 256) % 256, value % 256];
  assert.equal(pack(255, 0, 0), 0xFF0000);
  assert.equal(pack(0, 255, 0), 0x00FF00);
  assert.equal(pack(0, 0, 255), 0x0000FF);
  assert.deepEqual(unpack(4977664), [75, 244, 0]);

  console.log(JSON.stringify({
    terminalOutput,
    terminalBricks: terminal.bricks.length,
    terminalWires: terminal.edges.length,
    terminalBrickHandles: 0,
    livePreviewSetters: setterKeys.size,
    truckOutput,
    truckBricks: truck.bricks.length,
    truckWires: truck.edges.length,
    truckBrickHandles: 33,
    protectedLeaderboardGetters: protectedKeys,
    checks: 'passed',
  }, null, 2));
  return { terminal, truck };
}

if (require.main === module) test({
  input: process.argv[2] || DEFAULT_INPUT,
  terminalOutput: process.argv[3] || DEFAULT_TERMINAL_OUTPUT,
  truckOutput: process.argv[4] || DEFAULT_TRUCK_OUTPUT,
});

module.exports = test;
