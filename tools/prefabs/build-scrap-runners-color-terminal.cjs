'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N, S, B, O } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2] || '/workspace/attachments/0729ece5-83e9-4bbc-9116-14b1d500027f/Change.brz');
const TERMINAL_OUTPUT = path.resolve(process.argv[3] || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v4.brz'));
const TRUCK_OUTPUT = path.resolve(process.argv[4] || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v3.brz'));

const GRID = {
  main: 1,
  terminal: 2532386,
  truckOuter: 2532400,
  truckGeneral: 2532401,
  truckStats: 2532402,
  colorApplyLoop: 2532403,
  materialDecoder: 2532404,
  colorController: 2532405,
  colorConfig: 2532428,
  colorCore: 2532429,
};

const clone = value => structuredClone(value);
const I = value => ({ $variant: 'i64', value });
const colorValue = (R = 1, G = 1, Bv = 1, A = 1) => ({ R, G, B: Bv, A });
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

// reskin-loadboard.write correctly remaps grids, links, joints, and wires, but
// opaque BrickHandle values stored inside variables still contain the source
// persistent grid IDs. Perform a memory-only first serialization to learn the
// new grid/brick addresses, patch every stored handle, then serialize once more.
function writeWithRemappedBrickHandles(scene, metadata) {
  const firstBytes = write(scene, metadata).bytes;
  const first = read(firstBytes);
  const sourceEntities = [...scene.r.entities()];
  const firstEntities = [...first.r.entities()];
  assert.equal(firstEntities.length, sourceEntities.length, 'Entity count changed during first serialization');

  const gridMap = new Map([[1, 1]]);
  for (let index = 0; index < sourceEntities.length; index++)
    gridMap.set(sourceEntities[index].persistentIndex, firstEntities[index].persistentIndex);

  const targetMap = new Map();
  for (const sourceGrid of new Set(scene.bricks.map(brick => brick.g))) {
    const outputGrid = gridMap.get(sourceGrid);
    assert(outputGrid != null, `No serialized grid mapping for ${sourceGrid}`);
    const sourceBricks = scene.bricks.filter(brick => brick.g === sourceGrid);
    const outputBricks = first.bricks.filter(brick => brick.g === outputGrid);
    assert.equal(outputBricks.length, sourceBricks.length, `Brick count changed on grid ${sourceGrid}`);
    for (let index = 0; index < sourceBricks.length; index++) targetMap.set(sourceBricks[index].key, outputBricks[index].key);
  }

  let remapped = 0;
  for (const brick of first.bricks) for (const savedComponent of brick.comps) visitValues(savedComponent.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const oldKey = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    const newKey = targetMap.get(oldKey);
    assert(newKey, `Stored BrickHandle target disappeared: ${oldKey}`);
    const [grid, x, y, z, index] = JSON.parse(newKey);
    value.GridPersistentIndex = grid;
    value.ChunkIndex = { X: x, Y: y, Z: z };
    value.BrickIndexInChunk = index;
    remapped++;
  });
  const finalBytes = write(first, metadata).bytes;
  const finalScene = read(finalBytes);
  const validTargets = new Set(finalScene.bricks.map(brick => brick.key));
  let validated = 0;
  for (const brick of finalScene.bricks) for (const savedComponent of brick.comps) visitValues(savedComponent.data, value => {
    if (!isBrickHandle(value) || value.GridPersistentIndex === 0 || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([
      value.GridPersistentIndex,
      value.ChunkIndex.X,
      value.ChunkIndex.Y,
      value.ChunkIndex.Z,
      value.BrickIndexInChunk,
    ]);
    assert(validTargets.has(key), `Final stored BrickHandle is dangling: ${key}`);
    validated++;
  });
  assert.equal(validated, remapped, 'Stored BrickHandle validation count changed');
  return { bytes: finalBytes, remappedBrickHandles: remapped };
}

function sceneForGrids(scene, grids, { originEntity } = {}) {
  const keptGrids = new Set(grids);
  const bricks = scene.bricks.filter(brick => keptGrids.has(brick.g));
  const brickKeys = new Set(bricks.map(brick => brick.key));
  const links = scene.links.filter(link => brickKeys.has(link.key) && keptGrids.has(link.grid));
  const joints = (scene.joints || []).filter(joint => brickKeys.has(joint.key));
  const entityIds = new Set([...keptGrids].filter(grid => grid !== 1));
  for (const joint of joints) entityIds.add(joint.entity);
  const retainedEntities = [...scene.r.entities()].filter(entity => entityIds.has(entity.persistentIndex));
  const origin = originEntity == null
    ? { X: 0, Y: 0, Z: 0 }
    : retainedEntities.find(entity => entity.persistentIndex === originEntity)?.location;
  assert(origin, `Missing requested prefab-origin entity ${originEntity}`);
  const entities = retainedEntities.map(entity => {
    const shifted = clone(entity);
    shifted.location = {
      X: entity.location.X - origin.X,
      Y: entity.location.Y - origin.Y,
      Z: entity.location.Z - origin.Z,
    };
    return shifted;
  });

  // reskin-loadboard.write() normally serializes every donor entity. Present a
  // filtered reader view so the terminal contains no hidden/empty truck grids,
  // while all metadata/schema reads still bind to the original reader.
  const reader = new Proxy(scene.r, {
    get(target, property) {
      if (property === 'entities') return () => entities.values();
      if (property === 'gridIds') return () => [...keptGrids];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    ...scene,
    r: reader,
    bricks,
    edges: scene.edges.filter(edge => brickKeys.has(edge.a) && brickKeys.has(edge.z)),
    links,
    joints,
    entityOverrides: new Map([...(scene.entityOverrides || new Map())]
      .filter(([grid]) => entityIds.has(grid))
      .map(([grid, override]) => {
        const shifted = clone(override);
        shifted.location = {
          X: override.location.X - origin.X,
          Y: override.location.Y - origin.Y,
          Z: override.location.Z - origin.Z,
        };
        return [grid, shifted];
      })),
  };
}

function build(input = INPUT) {
  const inputBytes = fs.readFileSync(input);
  const scene = read(inputBytes);
  let sequence = 0;
  const sourceOwners = scene.r.owners();
  const sourceOwnerIndex = sourceOwners.UserNames.findIndex(name => name !== 'PUBLIC');
  const owner = sourceOwnerIndex < 0 ? undefined : {
    id: brdb.guidToUuid(sourceOwners.UserIds[sourceOwnerIndex]),
    name: sourceOwners.UserNames[sourceOwnerIndex],
    display_name: sourceOwners.DisplayNames[sourceOwnerIndex],
  };

  const allComponents = brick => brick.comps.map(component => component.type);
  const brickAt = (grid, index) => {
    const brick = scene.bricks.find(candidate => candidate.g === grid && indexOf(candidate.key) === index);
    assert(brick, `Missing brick g${grid}#${index}`);
    return brick;
  };
  const component = (brick, type) => {
    const result = brick.comps.find(candidate => candidate.type === type);
    assert(result, `Missing ${type} on ${brick.key}; found ${allComponents(brick).join(', ')}`);
    return result;
  };
  const typeOf = brick => {
    const result = brick.comps.find(candidate => candidate.type.startsWith('BrickComponentType_'))
      || brick.comps.find(candidate => candidate.type.startsWith('Component_Internal_'))
      || brick.comps[0];
    assert(result, `Brick ${brick.key} has no component`);
    return result.type;
  };
  const uniqueKey = (grid, name) => `added:${grid}:${name}:${sequence++}`;

  scene.entityOverrides = new Map();
  function expandMicrochipPlane(grid, center, extent) {
    const entity = [...scene.r.entities()].find(candidate => candidate.persistentIndex === grid);
    assert(entity, `Missing microchip grid entity ${grid}`);
    const override = clone(entity);
    override.data = clone(entity.data);
    override.data.bCollapsed = false;
    override.data.PlaneCenter = { X: center[0], Y: center[1], Z: center[2] };
    override.data.PlaneExtent = { X: extent[0], Y: extent[1], Z: extent[2] };
    scene.entityOverrides.set(grid, override);
  }
  expandMicrochipPlane(GRID.terminal, [330, 310, 2], [380, 400, 8]);
  expandMicrochipPlane(GRID.truckGeneral, [55, 55, 2], [140, 120, 8]);
  expandMicrochipPlane(GRID.colorController, [120, 25, 2], [155, 90, 8]);

  const baseGate = clone(scene.bricks.find(brick => brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const baseProgrammableGate = clone(scene.bricks.find(brick => brick.data.asset.startsWith('PB_Gate_')).data);
  const baseLabel = brickAt(GRID.terminal, 2);

  function gate(kind, grid, position, data = {}, options = {}) {
    const definition = C[kind];
    assert(definition, `Unknown gate ${kind}`);
    const programmable = definition.BRICK.startsWith('PB_Gate_');
    const brickData = clone(programmable ? baseProgrammableGate : baseGate);
    brickData.asset = definition.BRICK;
    brickData.position = position;
    brickData.direction = options.direction ?? 4;
    brickData.rotation = options.rotation ?? 0;
    brickData.size = programmable ? [5, 5, 2] : [0, 0, 0];
    brickData.color = options.color || [67, 122, 163];
    brickData.material_intensity = options.materialIntensity ?? 5;
    const brick = {
      key: uniqueKey(grid, options.name || kind),
      g: grid,
      data: brickData,
      comps: [{ type: definition.NAME, data: clone(data) }],
    };
    scene.bricks.push(brick);
    return brick;
  }

  function label(grid, position, text, options = {}) {
    const brick = clone(baseLabel);
    brick.key = uniqueKey(grid, options.name || 'label');
    brick.g = grid;
    brick.data.position = position;
    brick.data.size = options.size || [20, 10, 2];
    brick.data.color = options.brickColor || [35, 35, 35];
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = text;
    display.data.LineHeight = options.lineHeight ?? 1.5;
    display.data.WidthScale = options.widthScale ?? 1;
    display.data.Color = options.textColor || { B: 255, G: 255, R: 255, A: 255 };
    display.data.Anchor = options.anchor || { X: 0, Y: 0.5 };
    display.data.Offset = options.offset || { X: 1, Y: 0, Z: 0 };
    scene.bricks.push(brick);
    return brick;
  }

  function addEdge(source, sourceType, sourcePort, target, targetType, targetPort) {
    const sourceKey = typeof source === 'string' ? source : source.key;
    const targetKey = typeof target === 'string' ? target : target.key;
    assert(!scene.edges.some(edge => edge.z === targetKey && edge.zt === targetType && edge.q === targetPort),
      `Duplicate driver for ${targetKey}.${targetPort}`);
    scene.edges.push({ a: sourceKey, at: sourceType, p: sourcePort, z: targetKey, zt: targetType, q: targetPort });
  }

  function removeIncoming(target, targetType, targetPort) {
    const targetKey = typeof target === 'string' ? target : target.key;
    const removed = scene.edges.filter(edge => edge.z === targetKey && edge.zt === targetType && edge.q === targetPort);
    scene.edges = scene.edges.filter(edge => !(edge.z === targetKey && edge.zt === targetType && edge.q === targetPort));
    return removed;
  }

  function removeBrick(brick) {
    scene.edges = scene.edges.filter(edge => edge.a !== brick.key && edge.z !== brick.key);
    scene.links = scene.links.filter(link => link.key !== brick.key);
    scene.bricks = scene.bricks.filter(candidate => candidate !== brick);
  }

  const originalNonColorGetterSnapshot = new Map();
  for (const key of ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension', 'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1WheelDistance', 'Truck1Material']) {
    const brick = scene.bricks.find(candidate => candidate.g === GRID.truckStats
      && candidate.comps.some(candidateComponent => candidateComponent.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && candidateComponent.data.Key === key));
    assert(brick, `Missing protected getter ${key}`);
    originalNonColorGetterSnapshot.set(key, {
      data: clone(component(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME).data),
      edges: clone(scene.edges.filter(edge => edge.a === brick.key || edge.z === brick.key)),
    });
  }
  const materialGridSnapshot = {
    bricks: clone(scene.bricks.filter(brick => brick.g === GRID.materialDecoder)),
    edges: clone(scene.edges.filter(edge => {
      const keys = new Set(scene.bricks.filter(brick => brick.g === GRID.materialDecoder).map(brick => brick.key));
      return keys.has(edge.a) || keys.has(edge.z);
    })),
  };

  // ---------------------------------------------------------------------------
  // GENERAL VEHICLE CHIP — retain the owner PlayerState delivered by UpdateCar.
  // ---------------------------------------------------------------------------
  const generalUpdateTemplate = clone(component(brickAt(GRID.truckStats, 1), C.Event_CustomGlobal.NAME).data);
  generalUpdateTemplate.EventName = 'UpdateCar';
  generalUpdateTemplate.bIsObjectEvent = true;
  generalUpdateTemplate.DataOut1 = O(null);
  const ownerEvent = gate('Event_CustomGlobal', GRID.truckGeneral, [95, -5, 2], generalUpdateTemplate,
    { name: 'owner_update_event', color: [0, 138, 184] });
  const ownerVar = gate('Var', GRID.truckGeneral, [135, -5, 2], { Value: O(null) },
    { name: 'owner_playerstate_var', color: [93, 184, 255] });
  const ownerSet = gate('Exec_Var_Set', GRID.truckGeneral, [115, -5, 2], { bChangeType: false, Value: O(null) },
    { name: 'owner_playerstate_set', color: [93, 184, 255] });
  const ownerOutput = gate('MicrochipOutput', GRID.truckGeneral, [155, -5, 2], {
    PortLabel: 'Owner PlayerState', PortOrder: 1, CallableDefault: O(null), CallableResult: O(null),
  }, { name: 'owner_playerstate_output', color: [93, 184, 255] });
  label(GRID.truckGeneral, [125, -25, 2], 'OWNER / PLAYERSTATE\r\nStored from the spawner UpdateCar event.\r\nReusable by vehicle terminals.',
    { name: 'owner_playerstate_label', size: [50, 15, 2], textColor: { B: 255, G: 230, R: 110, A: 255 } });
  addEdge(ownerEvent, C.Event_CustomGlobal.NAME, 'ExecOut', ownerSet, C.Exec_Var_Set.NAME, 'Exec');
  addEdge(ownerEvent, C.Event_CustomGlobal.NAME, 'DataOut1', ownerSet, C.Exec_Var_Set.NAME, 'Value');
  addEdge(ownerVar, C.Var.NAME, 'VarRef', ownerSet, C.Exec_Var_Set.NAME, 'VarRef');
  addEdge(ownerVar, C.Var.NAME, 'Value', ownerOutput, C.MicrochipOutput.NAME, 'RER_Input');

  // ---------------------------------------------------------------------------
  // TRUCK1COLOR CONTROLLER — move saved/preview/application logic into the
  // existing color-decoder child chip. Truck1Material remains outside.
  // ---------------------------------------------------------------------------
  const colorChipBrick = brickAt(GRID.truckStats, 43);
  const colorChipDisplay = component(colorChipBrick, C.TextDisplay.NAME);
  colorChipDisplay.data.Text = 'TRUCK1COLOR\r\nCONTROLLER';
  colorChipDisplay.data.LineHeight = 1.35;
  colorChipDisplay.data.Color = { B: 40, G: 170, R: 255, A: 255 };
  const interactTemplate = clone(component(brickAt(GRID.colorConfig, 15), C.Interact.NAME).data);
  interactTemplate.Message = 'Contains only Truck1Color decoding, temporary preview selection, change detection, and body-brick application. Truck1Material remains outside this chip.';
  interactTemplate.PromptCustomLabel = 'Truck1Color controller';
  colorChipBrick.comps.unshift({ type: C.Interact.NAME, data: interactTemplate });

  const colorControllerHeader = brickAt(GRID.colorController, 0);
  component(colorControllerHeader, C.TextDisplay.NAME).data.Text = '<size="96">TRUCK1COLOR CONTROLLER</>\r\nSaved RGB integer + temporary preview + body application';
  colorControllerHeader.data.position = [105, -35, 2];
  colorControllerHeader.data.size = [100, 15, 2];

  const movedColorBricks = new Map([
    [34, [210, 80, 2]],  // body brick array
    [40, [120, 55, 2]],  // displayed color variable
    [41, [245, 80, 2]],  // for-each application chip
    [55, [180, 80, 2]],  // color change detector
    [56, [80, 55, 2]],   // saved color VarSet
    [57, [80, 80, 2]],   // preview color VarSet
  ]);
  for (const [index, position] of movedColorBricks) {
    const brick = brickAt(GRID.truckStats, index);
    brick.g = GRID.colorController;
    brick.data.position = position;
  }
  label(GRID.colorController, [25, 25, 2], 'SAVED SCORE -> RGB',
    { name: 'saved_decode_label', size: [30, 8, 2], textColor: { B: 80, G: 190, R: 255, A: 255 } });
  label(GRID.colorController, [105, 25, 2], 'DISPLAY COLOR\r\nSaved load or temporary preview',
    { name: 'display_color_label', size: [45, 10, 2], textColor: { B: 180, G: 255, R: 255, A: 255 } });
  label(GRID.colorController, [215, 25, 2], 'APPLY TO BODY BRICKS',
    { name: 'body_apply_label', size: [50, 8, 2], textColor: { B: 120, G: 255, R: 140, A: 255 } });

  const statsUpdateEvent = brickAt(GRID.truckStats, 1);
  const colorGetter = brickAt(GRID.truckStats, 9);
  const restoreEventData = clone(generalUpdateTemplate);
  restoreEventData.EventName = 'Restore Truck1Color';
  const restoreEvent = gate('Event_CustomGlobal', GRID.truckStats, [95, 35, 2], restoreEventData,
    { name: 'restore_truck1color_event', color: [255, 160, 35] });
  const initialColorDelay = gate('BufferTicks', GRID.truckStats, [55, 35, 2], {
    TicksToWait: 1, ZeroTicksToWait: -1, CurrentTicks: 0,
    Input: { $variant: 'WireGraphExec', value: {} }, Output: { $variant: 'WireGraphExec', value: {} },
    Buffered: { $variant: 'WireGraphExec', value: {} }, bHasQueued: false, bIsOffTimer: false,
  }, { name: 'initial_color_owner_delay', color: [255, 185, 80] });
  const colorLoadUnion = gate('Exec_Union', GRID.truckStats, [75, 35, 2], {},
    { name: 'color_load_union', color: [255, 185, 80] });
  label(GRID.truckStats, [75, 90, 2], 'TRUCK1COLOR LOAD / RESTORE\r\nInitial UpdateCar waits one tick for the general owner PlayerState.\r\nZone exit pulses only this color getter.',
    { name: 'color_restore_label', size: [65, 10, 2], textColor: { B: 80, G: 185, R: 255, A: 255 } });

  removeIncoming(colorGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  removeIncoming(colorGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  addEdge(statsUpdateEvent, C.Event_CustomGlobal.NAME, 'ExecOut', initialColorDelay, C.BufferTicks.NAME, 'Input');
  addEdge(initialColorDelay, C.BufferTicks.NAME, 'Output', colorLoadUnion, C.Exec_Union.NAME, 'ExecA');
  addEdge(restoreEvent, C.Event_CustomGlobal.NAME, 'ExecOut', colorLoadUnion, C.Exec_Union.NAME, 'ExecB');
  addEdge(colorLoadUnion, C.Exec_Union.NAME, 'ExecOut', colorGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  addEdge(ownerOutput, C.MicrochipOutput.NAME, 'RER_Output', colorGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');

  // ---------------------------------------------------------------------------
  // CONFIG CHIP — expose the editable purchase cost, BUY row, and result pulses.
  // ---------------------------------------------------------------------------
  const costTemplate = brickAt(GRID.colorConfig, 14);
  const costVar = clone(costTemplate);
  costVar.key = uniqueKey(GRID.colorConfig, 'color_purchase_cost');
  costVar.g = GRID.colorConfig;
  costVar.data.position = [144, -264, 2];
  component(costVar, C.Var.NAME).data.Value = I(100);
  const costInteract = component(costVar, C.Interact.NAME);
  costInteract.data.Message = 'Scrap charged only when Space successfully saves a genuinely new Truck1Color leaderboard value. Previewing is free.';
  costInteract.data.PromptCustomLabel = 'Color purchase cost';
  scene.bricks.push(costVar);

  // BUY is the sixth selectable row. Keep its angle brackets entirely inside
  // the formatted row so selecting it never shifts any of the other rows.
  const selectionVar = brickAt(GRID.colorCore, 109);
  const previousSelectionAdd = brickAt(GRID.colorCore, 143);
  const previousSelectionModulo = brickAt(GRID.colorCore, 100);
  const nextSelectionModulo = brickAt(GRID.colorCore, 101);
  component(previousSelectionAdd, C.Expr_MathAdd.NAME).data.InputB = N(5);
  component(previousSelectionModulo, C.Expr_MathModuloFloored.NAME).data.InputB = N(6);
  component(nextSelectionModulo, C.Expr_MathModuloFloored.NAME).data.InputB = N(6);

  const buySelected = gate('Expr_CompareEqual', GRID.colorCore, [576, 816, 2], {
    InputA: N(0), InputB: N(5),
  }, { name: 'buy_selection_compare', color: [75, 210, 125] });
  const buyPrefix = gate('Expr_Select', GRID.colorCore, [576, 864, 2], {
    InputA: S('  '), InputB: S('> '), bSelectB: false,
  }, { name: 'buy_selection_prefix', color: [75, 210, 125] });
  const buySuffix = gate('Expr_Select', GRID.colorCore, [576, 912, 2], {
    InputA: S(''), InputB: S(' <'), bSelectB: false,
  }, { name: 'buy_selection_suffix', color: [75, 210, 125] });
  const buyRow = gate('Expr_String_FormatText', GRID.colorConfig, [240, 144, 2], {
    FormatString: '{A}BUY{B}',
    InputA: S('  '), InputB: S(''), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'buy_menu_row', color: [75, 210, 125] });
  const priceAndBuy = gate('Expr_String_FormatText', GRID.colorConfig, [240, 240, 2], {
    FormatString: 'PRICE {A}\r\n{B}',
    InputA: I(100), InputB: S('  BUY'), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'price_and_buy_menu_block', color: [75, 210, 125] });
  const successfulBuyOutput = gate('MicrochipOutput', GRID.colorConfig, [240, -96, 2], {
    PortLabel: 'Successful Buy', PortOrder: 4, CallableDefault: S(''), CallableResult: S(''),
  }, { name: 'successful_buy_output', color: [75, 210, 125] });
  const failedBuyOutput = gate('MicrochipOutput', GRID.colorConfig, [240, -144, 2], {
    PortLabel: 'Failed Buy', PortOrder: 5, CallableDefault: S(''), CallableResult: S(''),
  }, { name: 'failed_buy_output', color: [255, 95, 95] });

  addEdge(selectionVar, C.Var.NAME, 'Value', buySelected, C.Expr_CompareEqual.NAME, 'InputA');
  addEdge(buySelected, C.Expr_CompareEqual.NAME, 'bOutput', buyPrefix, C.Expr_Select.NAME, 'bSelectB');
  addEdge(buySelected, C.Expr_CompareEqual.NAME, 'bOutput', buySuffix, C.Expr_Select.NAME, 'bSelectB');
  addEdge(buyPrefix, C.Expr_Select.NAME, 'Output', buyRow, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(buySuffix, C.Expr_Select.NAME, 'Output', buyRow, C.Expr_String_FormatText.NAME, 'InputB');
  addEdge(costVar, C.Var.NAME, 'Value', priceAndBuy, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(buyRow, C.Expr_String_FormatText.NAME, 'Output', priceAndBuy, C.Expr_String_FormatText.NAME, 'InputB');

  const completeMenu = brickAt(GRID.colorConfig, 9);
  const completeMenuFormat = component(completeMenu, C.Expr_String_FormatText.NAME);
  completeMenuFormat.data.FormatString = 'PROCESS: COLOR_CUSTOMIZER\r\nSTATUS: RUNNING\r\n\r\n{G}\r\n\r\n{A}\r\n{B}\r\n{C}\r\n{D}\r\n{E}\r\n\r\n{F}\r\n\r\nW/S SELECT   A/D TAP: 1 | HOLD: REPEAT\r\nC ENTER HEX   SPACE ACTIVATE';
  addEdge(priceAndBuy, C.Expr_String_FormatText.NAME, 'Output', completeMenu, C.Expr_String_FormatText.NAME, 'InputF');

  // ---------------------------------------------------------------------------
  // TERMINAL CHIP — rebuild the small interface into clear sections.
  // ---------------------------------------------------------------------------
  const previewSend = brickAt(GRID.terminal, 0);
  const reservedTerminalEvent = brickAt(GRID.terminal, 1);
  const sectionZone = brickAt(GRID.terminal, 2);
  const sectionPreview = brickAt(GRID.terminal, 3);
  const sectionPurchase = brickAt(GRID.terminal, 4);
  const sectionRestore = brickAt(GRID.terminal, 5);
  const zoneLeft = brickAt(GRID.terminal, 6);
  const zoneEntered = brickAt(GRID.terminal, 7);
  const removeAt = brickAt(GRID.terminal, 8);
  const insert = brickAt(GRID.terminal, 9);
  const previewTargetGet = brickAt(GRID.terminal, 10);
  const findLeaving = brickAt(GRID.terminal, 11);
  const vehicleArray = brickAt(GRID.terminal, 12);

  // Remove three abandoned placeholder expression gates and their dead wiring.
  for (const index of [13, 14, 15]) removeBrick(brickAt(GRID.terminal, index));

  const sectionText = [
    [sectionZone, '1. ZONE VEHICLE TRACKING\r\nThe zone array remembers vehicle entity references.'],
    [sectionPreview, '2. LIVE PREVIEW\r\nColor changes target only the first vehicle currently in the zone.'],
    [sectionPurchase, '3. PURCHASE + SAVE\r\nSpace: check Scrap, require a new color, save Truck1Color, then charge.'],
    [sectionRestore, '4. EXIT RESTORE\r\nLeaving vehicle is targeted directly and reloads only Truck1Color.'],
  ];
  for (const [brick, text] of sectionText) {
    const display = component(brick, C.TextDisplay.NAME);
    display.data.Text = text;
    display.data.LineHeight = 1.35;
    display.data.Anchor = { X: 0, Y: 0.5 };
    display.data.Offset = { X: 1, Y: 0, Z: 0 };
    brick.data.size = [60, 12, 2];
  }
  sectionZone.data.position = [100, -40, 2];
  sectionPreview.data.position = [100, 130, 2];
  sectionPurchase.data.position = [170, 300, 2];
  sectionRestore.data.position = [100, 600, 2];

  vehicleArray.data.position = [0, 20, 2];
  zoneEntered.data.position = [0, 70, 2];
  insert.data.position = [60, 70, 2];
  zoneLeft.data.position = [180, 70, 2];
  findLeaving.data.position = [240, 70, 2];
  removeAt.data.position = [300, 70, 2];
  previewTargetGet.data.position = [120, 210, 2];
  previewSend.data.position = [300, 210, 2];
  reservedTerminalEvent.data.position = [420, 650, 2];
  component(reservedTerminalEvent, C.Event_CustomGlobal.NAME).data.EventName = 'Interface with Terminal';

  const selectedColorOutput = brickAt(GRID.colorCore, 120);
  const inputSplitter = brickAt(GRID.colorCore, 3);
  const seat = brickAt(GRID.main, 57);

  // Replace the old Space -> preview behavior with enter/change -> guarded preview.
  removeIncoming(previewSend, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  removeIncoming(previewTargetGet, C.Exec_ArrayVar_Get.NAME, 'Exec');
  // Remove obsolete insert/remove -> logical-OR wires by source/target after deleting the OR gate.
  scene.edges = scene.edges.filter(edge => !(edge.a === insert.key && edge.p === 'ExecOut')
    && !(edge.a === removeAt.key && edge.p === 'ExecOut'));

  const previewUnion = gate('Exec_Union', GRID.terminal, [60, 210, 2], {},
    { name: 'preview_enter_or_change', color: [215, 85, 255] });
  const previewInBounds = gate('Expr_LogicalNOT', GRID.terminal, [180, 210, 2], { bInput: true },
    { name: 'preview_target_valid', color: [215, 85, 255] });
  const previewBranch = gate('Exec_Branch', GRID.terminal, [240, 210, 2], { bCond: false },
    { name: 'preview_guard', color: [215, 85, 255] });
  addEdge(insert, C.Exec_ArrayVar_Insert.NAME, 'ExecOut', previewUnion, C.Exec_Union.NAME, 'ExecA');

  // A pure ChangeDetector did not produce execution in game. Aggregate the
  // actual post-write pulses for every Hue/Saturation/Brightness setter. The
  // one-tick buffer lets all three parallel hex setters finish before reading
  // the selected Color output, and also coalesces their same-tick pulses.
  const colorVars = new Set([110, 111, 112].map(index => brickAt(GRID.colorCore, index).key));
  const colorSetters = scene.bricks.filter(brick => brick.g === GRID.colorCore
    && brick.comps.some(savedComponent => savedComponent.type === C.Exec_Var_Set.NAME)
    && scene.edges.some(edge => edge.a && colorVars.has(edge.a)
      && edge.z === brick.key && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'VarRef'));
  assert.equal(colorSetters.length, 15, 'Expected exactly 15 H/S/B write paths');
  let previewPulse = { brick: colorSetters[0], type: C.Exec_Var_Set.NAME, port: 'ExecOut' };
  for (let index = 1; index < colorSetters.length; index++) {
    const union = gate('Exec_Union', GRID.colorCore, [576, 72 + (index - 1) * 48, 2], {},
      { name: `preview_color_write_union_${index}`, color: [215, 85, 255] });
    addEdge(previewPulse.brick, previewPulse.type, previewPulse.port, union, C.Exec_Union.NAME, 'ExecA');
    addEdge(colorSetters[index], C.Exec_Var_Set.NAME, 'ExecOut', union, C.Exec_Union.NAME, 'ExecB');
    previewPulse = { brick: union, type: C.Exec_Union.NAME, port: 'ExecOut' };
  }
  const previewDelay = gate('BufferTicks', GRID.colorCore, [576, 768, 2], {
    TicksToWait: 1, ZeroTicksToWait: -1, CurrentTicks: 0,
    Input: { $variant: 'WireGraphExec', value: {} }, Output: { $variant: 'WireGraphExec', value: {} },
    Buffered: { $variant: 'WireGraphExec', value: {} }, bHasQueued: false, bIsOffTimer: false,
  }, { name: 'preview_after_color_write', color: [215, 85, 255] });
  label(GRID.colorCore, [552, 1100, 2], 'LIVE VEHICLE PREVIEW\r\n15 H/S/B writes -> 1 tick -> terminal',
    { name: 'live_preview_pulse_label', size: [45, 10, 2], textColor: { B: 255, G: 140, R: 235, A: 255 } });
  addEdge(previewPulse.brick, previewPulse.type, previewPulse.port, previewDelay, C.BufferTicks.NAME, 'Input');
  addEdge(previewDelay, C.BufferTicks.NAME, 'Output', previewUnion, C.Exec_Union.NAME, 'ExecB');
  addEdge(previewUnion, C.Exec_Union.NAME, 'ExecOut', previewTargetGet, C.Exec_ArrayVar_Get.NAME, 'Exec');
  addEdge(previewTargetGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', previewInBounds, C.Expr_LogicalNOT.NAME, 'bInput');
  addEdge(previewTargetGet, C.Exec_ArrayVar_Get.NAME, 'ExecOut', previewBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(previewInBounds, C.Expr_LogicalNOT.NAME, 'bOutput', previewBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(previewBranch, C.Exec_Branch.NAME, 'ExecOutA', previewSend, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');

  // Direct exit restoration uses the entity leaving the zone, not a stale array slot.
  const restoreSendData = clone(component(previewSend, C.Exec_SendCustomEventGlobal.NAME).data);
  restoreSendData.EventName = 'Restore Truck1Color';
  restoreSendData.DataIn1 = O(null);
  const restoreSend = gate('Exec_SendCustomEventGlobal', GRID.terminal, [240, 660, 2], restoreSendData,
    { name: 'restore_leaving_vehicle', color: [255, 160, 35] });
  addEdge(zoneLeft, typeOf(zoneLeft), 'Exec', restoreSend, C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  addEdge(zoneLeft, typeOf(zoneLeft), 'Entity', restoreSend, C.Exec_SendCustomEventGlobal.NAME, 'Target');

  // Purchase requires an active vehicle, the seated operator, enough Scrap, and a new packed RGB value.
  const purchaseVehicleGet = gate('Exec_ArrayVar_Get', GRID.terminal, [0, 370, 2], {
    Index: 0, Value: O(null), bOutOfBounds: true,
  }, { name: 'purchase_vehicle_get', color: [75, 210, 125] });
  const purchaseVehicleValid = gate('Expr_LogicalNOT', GRID.terminal, [60, 370, 2], { bInput: true },
    { name: 'purchase_vehicle_valid', color: [75, 210, 125] });
  const purchaseVehicleBranch = gate('Exec_Branch', GRID.terminal, [120, 370, 2], { bCond: false },
    { name: 'purchase_vehicle_guard', color: [75, 210, 125] });
  const getOperator = gate('Exec_PlayerState_GetFromEntity', GRID.terminal, [180, 370, 2], {},
    { name: 'purchase_operator', color: [75, 210, 125] });
  const getScrap = gate('Exec_Gamemode_GetLeaderboardValue', GRID.terminal, [240, 370, 2], { Key: 'Scrap', Value: 0 },
    { name: 'get_scrap', color: [75, 210, 125] });
  const getSavedColor = gate('Exec_Gamemode_GetLeaderboardValue', GRID.terminal, [300, 370, 2], { Key: 'Truck1Color', Value: 0 },
    { name: 'get_saved_color', color: [75, 210, 125] });
  const buySelectionBranch = gate('Exec_Branch', GRID.terminal, [0, 320, 2], { bCond: false },
    { name: 'buy_selection_guard', color: [75, 210, 125] });

  addEdge(vehicleArray, C.ArrayVar.NAME, 'ArrayVarRef', purchaseVehicleGet, C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef');
  addEdge(inputSplitter, typeOf(inputSplitter), 'InputUp', buySelectionBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(buySelected, C.Expr_CompareEqual.NAME, 'bOutput', buySelectionBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(buySelectionBranch, C.Exec_Branch.NAME, 'ExecOutA', purchaseVehicleGet, C.Exec_ArrayVar_Get.NAME, 'Exec');
  addEdge(purchaseVehicleGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', purchaseVehicleValid, C.Expr_LogicalNOT.NAME, 'bInput');
  addEdge(purchaseVehicleGet, C.Exec_ArrayVar_Get.NAME, 'ExecOut', purchaseVehicleBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(purchaseVehicleValid, C.Expr_LogicalNOT.NAME, 'bOutput', purchaseVehicleBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(purchaseVehicleBranch, C.Exec_Branch.NAME, 'ExecOutA', getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'Exec');
  addEdge(seat, typeOf(seat), 'SittingCharacter', getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'Entity');
  addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'ExecOut', getScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', getScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  addEdge(getScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', getSavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', getSavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');

  // Proven inverse of the existing decoder: SplitColorSRGB already emits 0..255 integers.
  const splitRgb = gate('Expr_SplitColorSRGB', GRID.terminal, [0, 470, 2], { Input: colorValue(1, 1, 1, 1) },
    { name: 'encode_split_srgb', color: [255, 125, 60] });
  const multiplyR = gate('Expr_MathMultiply', GRID.terminal, [60, 450, 2], { InputA: I(0), InputB: I(65536) },
    { name: 'encode_red', color: [255, 90, 90] });
  const multiplyG = gate('Expr_MathMultiply', GRID.terminal, [60, 490, 2], { InputA: I(0), InputB: I(256) },
    { name: 'encode_green', color: [90, 255, 110] });
  const addRg = gate('Expr_MathAdd', GRID.terminal, [120, 470, 2], { InputA: I(0), InputB: I(0) },
    { name: 'encode_rg', color: [255, 175, 75] });
  const packedRgb = gate('Expr_MathAdd', GRID.terminal, [180, 470, 2], { InputA: I(0), InputB: I(0) },
    { name: 'encode_rgb_integer', color: [255, 175, 75] });
  label(GRID.terminal, [90, 530, 2], 'RGB SCORE ENCODER\r\nR x 65536 + G x 256 + B',
    { name: 'rgb_encoder_label', size: [55, 10, 2], textColor: { B: 90, G: 180, R: 255, A: 255 } });
  addEdge(selectedColorOutput, C.MicrochipOutput.NAME, 'RER_Output', splitRgb, C.Expr_SplitColorSRGB.NAME, 'Input');
  addEdge(splitRgb, C.Expr_SplitColorSRGB.NAME, 'R', multiplyR, C.Expr_MathMultiply.NAME, 'InputA');
  addEdge(splitRgb, C.Expr_SplitColorSRGB.NAME, 'G', multiplyG, C.Expr_MathMultiply.NAME, 'InputA');
  addEdge(multiplyR, C.Expr_MathMultiply.NAME, 'Output', addRg, C.Expr_MathAdd.NAME, 'InputA');
  addEdge(multiplyG, C.Expr_MathMultiply.NAME, 'Output', addRg, C.Expr_MathAdd.NAME, 'InputB');
  addEdge(addRg, C.Expr_MathAdd.NAME, 'Output', packedRgb, C.Expr_MathAdd.NAME, 'InputA');
  addEdge(splitRgb, C.Expr_SplitColorSRGB.NAME, 'B', packedRgb, C.Expr_MathAdd.NAME, 'InputB');

  const hasFunds = gate('Expr_CompareGreaterOrEqual', GRID.terminal, [360, 370, 2], { InputA: I(0), InputB: I(100) },
    { name: 'has_color_funds', color: [75, 210, 125] });
  const colorChanged = gate('Expr_CompareNotEqual', GRID.terminal, [360, 420, 2], { InputA: I(0), InputB: I(0) },
    { name: 'new_color_changed', color: [75, 210, 125] });
  const fundsBranch = gate('Exec_Branch', GRID.terminal, [420, 370, 2], { bCond: false },
    { name: 'funds_branch', color: [75, 210, 125] });
  const changedBranch = gate('Exec_Branch', GRID.terminal, [480, 370, 2], { bCond: false },
    { name: 'changed_branch', color: [75, 210, 125] });
  const setColor = gate('Exec_Gamemode_SetLeaderboardValue', GRID.terminal, [540, 370, 2], { Key: 'Truck1Color', Value: 0 },
    { name: 'set_truck1color', color: [70, 190, 255] });
  const negativeCost = gate('Expr_MathNegate', GRID.terminal, [480, 470, 2], { Input: N(100) },
    { name: 'negative_color_cost', color: [255, 95, 95] });
  const chargeScrap = gate('Exec_Gamemode_IncrementLeaderboardValue', GRID.terminal, [600, 370, 2], { Key: 'Scrap', Value: -100 },
    { name: 'charge_scrap', color: [255, 95, 95] });
  const successFormat = gate('Expr_String_FormatText', GRID.terminal, [540, 470, 2], {
    FormatString: 'COLOR PURCHASED: -{A} SCRAP', InputA: N(100), InputB: N(0), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'purchase_success_text', color: [75, 210, 125] });
  const failureFormat = gate('Expr_String_FormatText', GRID.terminal, [420, 520, 2], {
    FormatString: 'NOT ENOUGH SCRAP: COLOR COSTS {A}', InputA: N(100), InputB: N(0), InputC: N(0), InputD: N(0), InputE: N(0), InputF: N(0), InputG: N(0),
  }, { name: 'purchase_failure_text', color: [255, 95, 95] });
  const successMessage = gate('Exec_PlayerState_ShowStatusMessage', GRID.terminal, [660, 370, 2], { Message: 'COLOR PURCHASED' },
    { name: 'purchase_success_message', color: [75, 210, 125] });
  const failureMessage = gate('Exec_PlayerState_ShowStatusMessage', GRID.terminal, [480, 520, 2], { Message: 'NOT ENOUGH SCRAP' },
    { name: 'purchase_failure_message', color: [255, 95, 95] });
  const sameMessage = gate('Exec_PlayerState_ShowStatusMessage', GRID.terminal, [540, 420, 2], { Message: 'THIS COLOR IS ALREADY SAVED' },
    { name: 'purchase_same_message', color: [255, 185, 80] });

  addEdge(getScrap, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', hasFunds, C.Expr_CompareGreaterOrEqual.NAME, 'InputA');
  addEdge(costVar, C.Var.NAME, 'Value', hasFunds, C.Expr_CompareGreaterOrEqual.NAME, 'InputB');
  addEdge(getSavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', colorChanged, C.Expr_CompareNotEqual.NAME, 'InputA');
  addEdge(packedRgb, C.Expr_MathAdd.NAME, 'Output', colorChanged, C.Expr_CompareNotEqual.NAME, 'InputB');
  addEdge(getSavedColor, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut', fundsBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(hasFunds, C.Expr_CompareGreaterOrEqual.NAME, 'bOutput', fundsBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(fundsBranch, C.Exec_Branch.NAME, 'ExecOutA', changedBranch, C.Exec_Branch.NAME, 'Exec');
  addEdge(colorChanged, C.Expr_CompareNotEqual.NAME, 'bOutput', changedBranch, C.Exec_Branch.NAME, 'bCond');
  addEdge(changedBranch, C.Exec_Branch.NAME, 'ExecOutA', setColor, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Exec');
  addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', setColor, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'PlayerState');
  addEdge(packedRgb, C.Expr_MathAdd.NAME, 'Output', setColor, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value');
  addEdge(setColor, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut', chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec');
  addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'PlayerState');
  addEdge(costVar, C.Var.NAME, 'Value', negativeCost, C.Expr_MathNegate.NAME, 'Input');
  addEdge(negativeCost, C.Expr_MathNegate.NAME, 'Output', chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Value');
  addEdge(chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut', successMessage, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Exec');
  addEdge(fundsBranch, C.Exec_Branch.NAME, 'ExecOutB', failureMessage, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Exec');
  addEdge(changedBranch, C.Exec_Branch.NAME, 'ExecOutB', sameMessage, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Exec');
  for (const message of [successMessage, failureMessage, sameMessage])
    addEdge(getOperator, C.Exec_PlayerState_GetFromEntity.NAME, 'PlayerState', message, C.Exec_PlayerState_ShowStatusMessage.NAME, 'PlayerState');
  addEdge(costVar, C.Var.NAME, 'Value', successFormat, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(costVar, C.Var.NAME, 'Value', failureFormat, C.Expr_String_FormatText.NAME, 'InputA');
  addEdge(successFormat, C.Expr_String_FormatText.NAME, 'Output', successMessage, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Message');
  addEdge(failureFormat, C.Expr_String_FormatText.NAME, 'Output', failureMessage, C.Exec_PlayerState_ShowStatusMessage.NAME, 'Message');

  // External result pulses are emitted only for an actual BUY activation.
  // Success occurs after the debit finishes. Failure combines no vehicle,
  // insufficient Scrap, and already-saved color; an unselected Space press is
  // intentionally ignored by the buy-selection branch above.
  const failedBuyUnionA = gate('Exec_Union', GRID.terminal, [600, 520, 2], {},
    { name: 'failed_buy_union_a', color: [255, 95, 95] });
  const failedBuyUnionB = gate('Exec_Union', GRID.terminal, [660, 520, 2], {},
    { name: 'failed_buy_union_b', color: [255, 95, 95] });
  addEdge(purchaseVehicleBranch, C.Exec_Branch.NAME, 'ExecOutB', failedBuyUnionA, C.Exec_Union.NAME, 'ExecA');
  addEdge(fundsBranch, C.Exec_Branch.NAME, 'ExecOutB', failedBuyUnionA, C.Exec_Union.NAME, 'ExecB');
  addEdge(failedBuyUnionA, C.Exec_Union.NAME, 'ExecOut', failedBuyUnionB, C.Exec_Union.NAME, 'ExecA');
  addEdge(changedBranch, C.Exec_Branch.NAME, 'ExecOutB', failedBuyUnionB, C.Exec_Union.NAME, 'ExecB');
  addEdge(chargeScrap, C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'ExecOut', successfulBuyOutput, C.MicrochipOutput.NAME, 'RER_Input');
  addEdge(failedBuyUnionB, C.Exec_Union.NAME, 'ExecOut', failedBuyOutput, C.MicrochipOutput.NAME, 'RER_Input');

  // The old Space preview edge must be completely gone.
  assert(!scene.edges.some(edge => edge.a === inputSplitter.key && edge.p === 'InputUp'
    && edge.z === previewSend.key && edge.q === 'ExecIn'));

  // Protected non-color leaderboard paths and material decoder must be untouched.
  for (const [key, snapshot] of originalNonColorGetterSnapshot) {
    const brick = scene.bricks.find(candidate => candidate.g === GRID.truckStats
      && candidate.comps.some(candidateComponent => candidateComponent.type === C.Exec_Gamemode_GetLeaderboardValue.NAME && candidateComponent.data.Key === key));
    assert(brick, `Protected getter disappeared: ${key}`);
    assert.deepEqual(component(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME).data, snapshot.data, `Protected getter data changed: ${key}`);
    assert.deepEqual(scene.edges.filter(edge => edge.a === brick.key || edge.z === brick.key), snapshot.edges, `Protected getter wires changed: ${key}`);
  }
  assert.deepEqual(scene.bricks.filter(brick => brick.g === GRID.materialDecoder), materialGridSnapshot.bricks, 'Truck1Material decoder bricks changed');
  assert.deepEqual(scene.edges.filter(edge => {
    const keys = new Set(scene.bricks.filter(brick => brick.g === GRID.materialDecoder).map(brick => brick.key));
    return keys.has(edge.a) || keys.has(edge.z);
  }), materialGridSnapshot.edges, 'Truck1Material decoder wires changed');

  const terminalScene = sceneForGrids(scene, [1, GRID.terminal, 2532427, GRID.colorConfig, GRID.colorCore]);
  const truckScene = sceneForGrids(scene, [
    2532391, 2532392, 2532393, 2532394, 2532395, 2532396, 2532397, 2532398, 2532399,
    GRID.truckOuter, GRID.truckGeneral, GRID.truckStats, GRID.colorApplyLoop, GRID.materialDecoder, GRID.colorController,
  ], { originEntity: 2532391 });

  const truckPrefab = clone(scene.r.prefabJson());
  for (const key of ['bottomStudsPivot', 'studsExpandedPivot', 'topStudsPivot', 'boundsPivot']) {
    truckPrefab.pivots[key].center = { x: 0, y: 0, z: 0 };
    truckPrefab.pivots[key].halfExtent = { x: 100, y: 60, z: 50 };
  }

  const terminalName = 'Scrap Runners - Color Terminal v4';
  const terminalDescription = 'Terminal-only colorizer with live preview, selectable BUY row and price, successful/failed purchase pulse outputs, 100 Scrap saving, and targeted zone-exit restoration. Uses the existing v3 color-enabled Truck1 prefab.';
  const truckName = 'Scrap Runners - Truck1 Color Enabled v3';
  const truckDescription = 'Truck1-only prefab for the existing vehicle spawner, with retained owner PlayerState, saved color loading, temporary preview events, and targeted restoration.';
  const terminalResult = writeWithRemappedBrickHandles(terminalScene, {
    name: terminalName,
    description: terminalDescription,
    owner,
  });
  const truckResult = writeWithRemappedBrickHandles(truckScene, {
    name: truckName,
    description: truckDescription,
    owner,
    prefab: truckPrefab,
  });
  const terminalBytes = repack(terminalResult.bytes, inputBytes, { name: terminalName, description: terminalDescription });
  const truckBytes = repack(truckResult.bytes, inputBytes, { name: truckName, description: truckDescription });
  return {
    terminalBytes,
    truckBytes,
    scene,
    terminalScene,
    truckScene,
    input,
    terminalOutput: TERMINAL_OUTPUT,
    truckOutput: TRUCK_OUTPUT,
    grids: GRID,
    terminalRemappedBrickHandles: terminalResult.remappedBrickHandles,
    truckRemappedBrickHandles: truckResult.remappedBrickHandles,
  };
}

if (require.main === module) {
  const context = build(INPUT);
  fs.mkdirSync(path.dirname(TERMINAL_OUTPUT), { recursive: true });
  fs.mkdirSync(path.dirname(TRUCK_OUTPUT), { recursive: true });
  fs.writeFileSync(TERMINAL_OUTPUT, context.terminalBytes);
  fs.writeFileSync(TRUCK_OUTPUT, context.truckBytes);
  require('./test-scrap-runners-color-terminal.cjs')({
    input: INPUT,
    terminalOutput: TERMINAL_OUTPUT,
    truckOutput: TRUCK_OUTPUT,
  });
  console.log(JSON.stringify({
    input: INPUT,
    terminalOutput: TERMINAL_OUTPUT,
    terminalBytes: context.terminalBytes.length,
    terminalRemappedBrickHandles: context.terminalRemappedBrickHandles,
    truckOutput: TRUCK_OUTPUT,
    truckBytes: context.truckBytes.length,
    truckRemappedBrickHandles: context.truckRemappedBrickHandles,
  }, null, 2));
}

module.exports = build;
