'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');
const { ENGINE_PROFILES } = require('./mechanic-shop-catalog-v1.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v12.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-mechanic-enabled-v13.brz'));

const clone = structuredClone;
const N = value => ({ $variant: 'f64', value });
const I = value => ({ $variant: 'i64', value });
const Q = (X, Y, Z, W) => ({ $variant: 'Quat', value: { X, Y, Z, W } });
const S = value => ({ $variant: 'str', value });
const B = value => ({ $variant: 'Bool', value });
const O = value => ({ $variant: 'weak_object', value });

function owner(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Prefab owner');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
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

function sourceEntities(scene) {
  return [...scene.r.entities(), ...(scene.extraEntities || [])];
}

function writeTruck(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const beforeEntities = sourceEntities(scene);
  const afterEntities = [...first.r.entities()];
  assert.equal(beforeEntities.length, afterEntities.length, 'entity count');
  const gridMap = new Map([[1, 1]]);
  beforeEntities.forEach((entity, index) =>
    gridMap.set(entity.persistentIndex, afterEntities[index].persistentIndex));

  const keyMap = new Map();
  for (const grid of new Set(scene.bricks.map(brick => brick.g))) {
    const before = scene.bricks.filter(brick => brick.g === grid);
    const after = first.bricks.filter(brick => brick.g === gridMap.get(grid));
    assert.equal(after.length, before.length, `grid ${grid} brick count`);
    before.forEach((brick, index) => keyMap.set(brick.key, after[index].key));
  }

  let remapped = 0;
  for (const brick of first.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const old = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    const replacement = keyMap.get(old);
    assert(replacement, `Lost BrickHandle ${old}`);
    const [GridPersistentIndex, X, Y, Z, BrickIndexInChunk] = JSON.parse(replacement);
    Object.assign(value, {
      GridPersistentIndex,
      ChunkIndex: { X, Y, Z },
      BrickIndexInChunk,
    });
    remapped++;
  });

  const bytes = write(first, metadata).bytes;
  const final = read(bytes);
  const valid = new Set(final.bricks.map(brick => brick.key));
  let checked = 0;
  for (const brick of final.bricks) for (const saved of brick.comps) walk(saved.data, value => {
    if (!isHandle(value) || !value.GridPersistentIndex
      || value.BrickIndexInChunk === 0xffffffff) return;
    const key = JSON.stringify([value.GridPersistentIndex, value.ChunkIndex.X,
      value.ChunkIndex.Y, value.ChunkIndex.Z, value.BrickIndexInChunk]);
    assert(valid.has(key), `Dangling BrickHandle ${key}`);
    checked++;
  });
  assert.equal(checked, remapped, 'every remapped BrickHandle resolves');
  return { bytes, remapped };
}

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
}

function rowAt(bricks, x, y) {
  let edge = x;
  for (const brick of bricks) {
    const half = halfSize(brick);
    assert(half, brick.data.asset);
    brick.data.position = [edge + half[0], y, 2];
    edge += half[0] * 2;
  }
}

function fit(scene, grid) {
  const entity = sourceEntities(scene).find(saved => saved.persistentIndex === grid);
  assert(entity, `microchip entity ${grid}`);
  const bricks = scene.bricks.filter(brick => brick.g === grid);
  const low = [0, 1].map(axis => Math.floor(Math.min(...bricks.map(brick =>
    brick.data.position[axis] - halfSize(brick)[axis]))));
  const high = [0, 1].map(axis => Math.ceil(Math.max(...bricks.map(brick =>
    brick.data.position[axis] + halfSize(brick)[axis]))));
  for (let axis = 0; axis < 2; axis++) if ((low[axis] + high[axis]) % 2) high[axis]++;
  const copy = clone(entity);
  copy.data = clone(entity.data);
  copy.data.bCollapsed = true;
  copy.data.PlaneCenter = {
    X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2,
    Z: 0,
  };
  copy.data.PlaneExtent = {
    X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10,
    Z: 0,
  };
  scene.entityOverrides.set(grid, copy);
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  scene.extraEntities = [];
  scene.extraGridIds = new Set();
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows().filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const component = (brick, type) => {
    const result = brick?.comps.find(saved => saved.type === type);
    assert(result, `Missing ${type}`);
    return result;
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const removeInput = (target, type, port) => {
    const old = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return old;
  };
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  };
  const removeBrick = (brick, label) => {
    assert(brick && bricks.has(brick.key), `Missing ${label}`);
    scene.edges = scene.edges.filter(edge => edge.a !== brick.key && edge.z !== brick.key);
    scene.links = scene.links.filter(link => link.key !== brick.key);
    scene.bricks = scene.bricks.filter(saved => saved !== brick);
    bricks.delete(brick.key);
  };
  const replaceGate = (brick, oldType, kind, data, label) => {
    const definition = C[kind];
    assert(definition, kind);
    const index = brick.comps.findIndex(saved => saved.type === oldType);
    assert(index >= 0, `Missing ${label} ${oldType}`);
    brick.comps[index] = { type: definition.NAME, data: clone(data) };
    brick.data.asset = definition.BRICK;
    brick.data.size = definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0];
    return brick;
  };

  const mechanicalKeys = ['Truck1Engine', 'Truck1Fueltank', 'Truck1Suspension',
    'Truck1Steerangle', 'Truck1Steerturnspeed', 'Truck1WheelDistance'];
  const getters = mechanicalKeys.map(key => one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === key), `${key} getter`).brick);
  const board = getters[0].g;
  assert(getters.every(brick => brick.g === board), 'all mechanical getters share board');
  const updateCar = one(all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === board && data.EventName === 'UpdateCar'),
  'mechanical UpdateCar').brick;
  const ownerPlayerState = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'owner PlayerState output').brick;
  const ownerUserId = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'owner user ID output').brick;
  const vehicleGridSource = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,5]');
  assert(component(vehicleGridSource, C.ReadBrickGrid.NAME), 'vehicle grid source');

  // Bring the truck's saved mechanical profile schema in line with the new
  // data-driven shop catalog.
  component(getters[5], C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key =
    'Truck1Wheelspacing';
  component(getters[5], C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Value = 0;
  const wheelLabel = scene.bricks.find(brick => brick.key === '[13,-1,-1,-1,22]');
  component(wheelLabel, C.TextDisplay.NAME).data.Text = 'Truck1Wheelspacing';
  const wheelOutput = scene.bricks.find(brick => brick.key === '[13,-1,-1,-1,48]');
  component(wheelOutput, C.MicrochipOutput.NAME).data.PortLabel =
    'Output Truck1Wheelspacing';
  component(scene.bricks.find(brick => brick.key === '[13,-1,-1,-1,35]'),
    C.ArrayVar.NAME).data.Value = { $elementType: 'i64', $array: [30, 35, 40, 45, 50, 55, 60] };
  component(scene.bricks.find(brick => brick.key === '[13,-1,-1,-1,36]'),
    C.ArrayVar.NAME).data.Value = { $elementType: 'f64', $array: [0.05, 0.1, 0.2] };
  component(scene.bricks.find(brick => brick.key === '[13,-1,-1,-1,33]'),
    C.ArrayVar.NAME).data.Value = {
    $elementType: 'Quat', $array: clone(ENGINE_PROFILES),
  };

  // The inherited dashboard sampled speed with a 0.01-second, self-restarting
  // Stopwatch. A seat-gated 0.1-second Clock is visually just as responsive,
  // removes the explicit loop/pause inverter, and performs about 90% fewer
  // entity-speed queries while occupied.
  const driveGrid = vehicleGridSource.g;
  const speedStopwatch = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,4]');
  const speedPauseNot = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,27]');
  const occupiedInput = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,14]');
  const speedGetter = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,3]');
  assert([speedStopwatch, speedPauseNot, occupiedInput, speedGetter]
    .every(brick => brick?.g === driveGrid), 'dashboard speed gates share the drive controller');
  scene.edges = scene.edges.filter(edge => edge.a !== speedStopwatch.key
    && edge.z !== speedStopwatch.key);
  replaceGate(speedStopwatch, C.Stopwatch.NAME, 'Clock', {
    bEnabled: false,
    bPulseOn: false,
    OnTimeSeconds: 1,
    OffTimeSeconds: 1,
    IntervalSeconds: 0.1,
  }, 'dashboard speed clock');
  add(occupiedInput, C.MicrochipInput.NAME, 'RER_Output', speedStopwatch,
    C.Clock.NAME, 'bEnabled');
  add(speedStopwatch, C.Clock.NAME, 'Pulse', speedGetter,
    C.Exec_Entity_GetSpeed.NAME, 'Exec');
  removeBrick(speedPauseNot, 'dashboard Stopwatch pause inverter');

  // Both Read Brick Grid gates were in the same controller and therefore
  // resolved the same vehicle. Reuse the already-shared source for speed.
  const duplicateVehicleGrid = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,6]');
  assert(duplicateVehicleGrid?.g === driveGrid, 'duplicate vehicle-grid reader');
  removeInput(speedGetter, C.Exec_Entity_GetSpeed.NAME, 'Entity');
  add(vehicleGridSource, C.ReadBrickGrid.NAME, 'BrickGrid', speedGetter,
    C.Exec_Entity_GetSpeed.NAME, 'Entity');
  removeBrick(duplicateVehicleGrid, 'duplicate vehicle-grid reader');

  // The switch rerouter only fanned one signal to the freeze setter and its
  // inverter. Direct fan-out is smaller and has identical behavior.
  const freezeInput = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,13]');
  const freezeRerouter = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,10]');
  const freezeSetter = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,1]');
  const freezeNot = scene.bricks.find(brick => brick.key === '[12,-1,-1,-1,26]');
  assert([freezeInput, freezeRerouter, freezeSetter, freezeNot]
    .every(brick => brick?.g === driveGrid), 'freeze-control gates share the drive controller');
  removeInput(freezeSetter, C.Exec_Entity_SetFrozen.NAME, 'Exec');
  removeInput(freezeNot, C.Expr_LogicalNOT.NAME, 'bInput');
  removeBrick(freezeRerouter, 'freeze-control rerouter');
  add(freezeInput, C.MicrochipInput.NAME, 'RER_Output', freezeSetter,
    C.Exec_Entity_SetFrozen.NAME, 'Exec');
  add(freezeInput, C.MicrochipInput.NAME, 'RER_Output', freezeNot,
    C.Expr_LogicalNOT.NAME, 'bInput');

  // The current color terminal stopped reading these two vehicle custom
  // properties when it moved to the targeted appearance request/reply
  // protocol. Remove the now-unobserved publication path and its grid input.
  const legacyProperties = all(C.Exec_Entity_SetCustomProperty.NAME,
    data => ['CurrentColorScore', 'CurrentMaterialEnum'].includes(data.Key));
  assert.equal(legacyProperties.length, 2, 'two obsolete appearance properties');
  const appearanceGrid = legacyProperties[0].brick.g;
  assert(legacyProperties.every(row => row.brick.g === appearanceGrid),
    'obsolete appearance properties share the appearance controller');
  const materialProperty = legacyProperties.find(row =>
    row.comp.data.Key === 'CurrentMaterialEnum').brick;
  const materialMultiplierEdge = one(incoming(materialProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Value'), 'material property multiplier');
  const materialMultiplier = bricks.get(materialMultiplierEdge.a);
  const appearanceVehicleInput = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === appearanceGrid && data.PortLabel === 'Vehicle Grid'),
  'obsolete appearance vehicle-grid input').brick;
  for (const { brick } of legacyProperties) removeBrick(brick, 'obsolete appearance property');
  removeBrick(materialMultiplier, 'obsolete material property multiplier');
  removeBrick(appearanceVehicleInput, 'obsolete appearance vehicle-grid input');

  // Collapse the saved-color max/min pair into Brickadia's native clamp.
  const colorMax = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,39]');
  const colorMin = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,38]');
  const savedColorInput = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,43]');
  const redDivide = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,40]');
  const greenDivide = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,41]');
  const blueModulo = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,37]');
  assert([colorMax, colorMin, savedColorInput, redDivide, greenDivide, blueModulo]
    .every(brick => brick?.g === appearanceGrid), 'saved-color decoder gates');
  scene.edges = scene.edges.filter(edge => edge.a !== colorMax.key && edge.z !== colorMax.key);
  replaceGate(colorMax, C.Expr_MathMax.NAME, 'Expr_MathClamp', {
    Input: I(0), Min: I(0), Max: I(16777215),
  }, 'saved-color clamp');
  removeBrick(colorMin, 'redundant saved-color minimum');
  add(savedColorInput, C.MicrochipInput.NAME, 'RER_Output', colorMax,
    C.Expr_MathClamp.NAME, 'Input');
  for (const target of [redDivide, greenDivide, blueModulo]) add(colorMax,
    C.Expr_MathClamp.NAME, 'Output', target,
    target.comps.some(saved => saved.type === C.Expr_MathDivide.NAME)
      ? C.Expr_MathDivide.NAME
      : C.Expr_MathModulo.NAME,
    'InputA');

  // Decode Plastic/Metal with one typed Select and one setter per path rather
  // than a branch plus duplicate setters.
  const materialVar = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,20]');
  const savedMaterialCompare = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,21]');
  const savedMaterialSelect = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,28]');
  const savedMaterialSetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,22]');
  const redundantSavedMaterialSetter = scene.bricks.find(brick =>
    brick.key === '[16,-1,-1,-1,23]');
  const previewMaterialCompare = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,24]');
  const previewMaterialSelect = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,25]');
  const previewMaterialSetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,27]');
  const redundantPreviewMaterialSetter = scene.bricks.find(brick =>
    brick.key === '[16,-1,-1,-1,26]');
  const plastic = { $variant: 'dynamic_enum', value: { $enum: 'EBrickMaterial', value: 0 } };
  const metal = { $variant: 'dynamic_enum', value: { $enum: 'EBrickMaterial', value: 4 } };
  for (const [select, oldType, label] of [
    [savedMaterialSelect, C.Exec_Branch.NAME, 'saved material select'],
    [previewMaterialSelect, C.Exec_Branch.NAME, 'preview material select'],
  ]) {
    scene.edges = scene.edges.filter(edge => edge.a !== select.key && edge.z !== select.key);
    replaceGate(select, oldType, 'Expr_Select', {
      bSelectB: false, InputA: clone(plastic), InputB: clone(metal),
    }, label);
    const interact = select.comps.find(saved => saved.type === C.Interact.NAME);
    if (interact) {
      interact.data.Message = label;
      interact.data.PromptCustomLabel = label;
    }
  }
  for (const setter of [savedMaterialSetter, previewMaterialSetter])
    scene.edges = scene.edges.filter(edge => edge.a !== setter.key && edge.z !== setter.key);
  removeBrick(redundantSavedMaterialSetter, 'redundant saved material setter');
  removeBrick(redundantPreviewMaterialSetter, 'redundant preview material setter');
  add(savedMaterialCompare, C.Expr_CompareEqual.NAME, 'bOutput', savedMaterialSelect,
    C.Expr_Select.NAME, 'bSelectB');
  add(previewMaterialCompare, C.Expr_CompareEqual.NAME, 'bOutput', previewMaterialSelect,
    C.Expr_Select.NAME, 'bSelectB');
  for (const [select, setter] of [[savedMaterialSelect, savedMaterialSetter],
    [previewMaterialSelect, previewMaterialSetter]]) {
    add(materialVar, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef');
    add(select, C.Expr_Select.NAME, 'Output', setter, C.Exec_Var_Set.NAME, 'Value');
  }

  // Each appearance transaction now has one explicit execution chain. The
  // two completed chains converge once, settle for one tick, and invoke the
  // existing 31-handle callable exactly once. This replaces three independent
  // change-detector pulses plus a fourth explicit preview pulse.
  const appearanceLoad = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,5]');
  const interfaceEvent = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,0]');
  const restoreEvent = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,3]');
  const savedColorGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Color'), 'saved color getter').brick;
  const savedMaterialGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'saved material getter').brick;
  const savedColorSetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,33]');
  const previewColorSetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,34]');
  const previewIntensitySetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,52]');
  const savedIntensitySetter = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,53]');
  const finalRefresh = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,56]');
  const applyBuffer = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,50]');
  const colorChange = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,32]');
  const materialChange = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,48]');
  const intensityChange = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,54]');
  const colorMaterialRefresh = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,49]');
  const allValueRefresh = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,55]');
  assert([appearanceLoad, interfaceEvent, restoreEvent, savedColorSetter,
    previewColorSetter, previewIntensitySetter, savedIntensitySetter, finalRefresh,
    applyBuffer, colorChange, materialChange, intensityChange, colorMaterialRefresh,
    allValueRefresh].every(brick => brick?.g === appearanceGrid),
  'appearance refresh gates share the appearance controller');
  for (const brick of [colorChange, materialChange, intensityChange,
    colorMaterialRefresh, allValueRefresh]) removeBrick(brick, 'duplicate appearance refresh');
  scene.edges = scene.edges.filter(edge => edge.a !== finalRefresh.key
    && edge.z !== finalRefresh.key);
  const finalRefreshInteract = component(finalRefresh, C.Interact.NAME);
  finalRefreshInteract.data.Message = 'Saved or preview appearance complete';
  finalRefreshInteract.data.PromptCustomLabel = 'Saved or preview appearance complete';
  removeInput(savedMaterialGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  removeInput(savedIntensitySetter, C.Exec_Var_Set.NAME, 'Exec');
  removeInput(previewIntensitySetter, C.Exec_Var_Set.NAME, 'Exec');
  add(savedColorSetter, C.Exec_Var_Set.NAME, 'ExecOut', savedMaterialGetter,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
  add(savedMaterialGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'ExecOut',
    savedMaterialSetter, C.Exec_Var_Set.NAME, 'Exec');
  add(savedMaterialSetter, C.Exec_Var_Set.NAME, 'ExecOut', savedIntensitySetter,
    C.Exec_Var_Set.NAME, 'Exec');
  add(savedIntensitySetter, C.Exec_Var_Set.NAME, 'ExecOut', finalRefresh,
    C.Exec_Union.NAME, 'ExecA');
  add(previewColorSetter, C.Exec_Var_Set.NAME, 'ExecOut', previewMaterialSetter,
    C.Exec_Var_Set.NAME, 'Exec');
  add(previewMaterialSetter, C.Exec_Var_Set.NAME, 'ExecOut', previewIntensitySetter,
    C.Exec_Var_Set.NAME, 'Exec');
  add(previewIntensitySetter, C.Exec_Var_Set.NAME, 'ExecOut', finalRefresh,
    C.Exec_Union.NAME, 'ExecB');
  add(finalRefresh, C.Exec_Union.NAME, 'ExecOut', applyBuffer,
    C.BufferTicks.NAME, 'Input');

  // Each saved leaderboard score is an array index. The terminal only writes
  // valid catalog indices, but legacy or manually edited scores can still be
  // outside the current profile. Keep the truck driveable by explicitly
  // selecting the stock value whenever Array Get reports out-of-bounds.
  const arrayGets = getters.map((getter, index) => {
    const matches = scene.edges.filter(edge => edge.a === getter.key
      && edge.at === C.Exec_Gamemode_GetLeaderboardValue.NAME
      && edge.p === 'Value'
      && edge.zt === C.Exec_ArrayVar_Get.NAME
      && edge.q === 'Index');
    return one(matches.map(edge => ({ brick: bricks.get(edge.z), comp: edge })),
      `mechanical array getter ${index}`).brick;
  });
  const stockEngine = ENGINE_PROFILES[0];
  const stockDefaults = [Q(stockEngine.X, stockEngine.Y, stockEngine.Z, stockEngine.W),
    I(20000), I(500), I(30), N(0.05), N(0)];
  const fallbackLabels = ['Engine', 'Fuel tank', 'Suspension', 'Steer angle',
    'Steer turn speed', 'Wheel spacing'];
  arrayGets.forEach((arrayGet, index) => {
    Object.assign(component(arrayGet, C.Exec_ArrayVar_Get.NAME).data, {
      Index: 0,
      Value: clone(stockDefaults[index]),
      bOutOfBounds: false,
    });
  });

  // Add one compact third controller beside the already-consolidated
  // appearance and owner chips. All three shells touch on the grid.
  const ownerChip = one(scene.bricks.filter(brick => brick.g === board
    && brick.comps.some(saved => saved.type === C.TextDisplay.NAME
      && saved.data.Text === 'OWNER /\r\nPLAYERSTATE')),
  'owner controller shell');
  const colorChip = one(scene.bricks.filter(brick => brick.g === board
    && brick.comps.some(saved => saved.type === C.TextDisplay.NAME
      && saved.data.Text === 'COLOR + MATERIAL\r\nCONTROLLER')),
  'appearance controller shell');
  colorChip.data.position = [35, 5, 2];
  ownerChip.data.position = [45, 5, 2];

  const mechanicGrid = 21;
  assert(!new Set(scene.r.gridIds()).has(mechanicGrid), 'mechanic grid ID is unused');
  const ownerGrid = scene.links.find(link => link.key === ownerChip.key).grid;
  const ownerEntity = sourceEntities(scene).find(entity => entity.persistentIndex === ownerGrid);
  assert(ownerEntity, 'owner controller entity');
  const mechanicEntity = clone(ownerEntity);
  mechanicEntity.persistentIndex = mechanicGrid;
  mechanicEntity.data = clone(ownerEntity.data);
  mechanicEntity.data.bCollapsed = true;
  scene.extraEntities.push(mechanicEntity);
  scene.extraGridIds.add(mechanicGrid);

  const mechanicChip = clone(ownerChip);
  mechanicChip.key = 'v13:mechanic-interface-chip';
  mechanicChip.data.position = [55, 5, 2];
  const mechanicChipText = component(mechanicChip, C.TextDisplay.NAME);
  mechanicChipText.data.Text = 'MECHANIC\r\nINTERFACE';
  mechanicChipText.data.Color = { B: 75, G: 185, R: 255, A: 255 };
  const mechanicChipInteract = component(mechanicChip, C.Interact.NAME);
  mechanicChipInteract.data.Message = 'Mechanic terminal interface';
  mechanicChipInteract.data.PromptCustomLabel = 'Mechanic terminal interface';
  scene.bricks.push(mechanicChip);
  bricks.set(mechanicChip.key, mechanicChip);
  scene.links.push({ key: mechanicChip.key, grid: mechanicGrid });

  const gateBase = clone(scene.bricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  let sequence = 0;
  const gate = (kind, data, label) => {
    const definition = C[kind];
    assert(definition, kind);
    const brickData = clone(gateBase);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position: [0, 0, 2],
      direction: 4,
      rotation: 0,
      size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
      color: [225, 145, 60],
      material_intensity: 5,
    });
    const result = {
      key: `v13:${mechanicGrid}:gate:${sequence++}`,
      g: mechanicGrid,
      data: brickData,
      comps: [
        { type: definition.NAME, data: clone(data) },
        {
          type: C.Interact.NAME,
          data: {
            InteractSound: 0,
            Message: label,
            ConsoleTag: '',
            bAllowNearbyInteraction: true,
            bHiddenInteraction: false,
            PromptCustomLabel: label,
          },
        },
      ],
    };
    scene.bricks.push(result);
    bricks.set(result.key, result);
    return result;
  };

  const labelTemplate = clone(component(scene.bricks.find(brick =>
    brick.key === '[15,-1,-1,-1,4]'), C.TextDisplay.NAME).data);
  const header = (text, width, x, y) => {
    const display = clone(labelTemplate);
    Object.assign(display, {
      Text: text,
      Anchor: { X: 0.5, Y: 0.5 },
      Offset: { X: 0, Y: 0, Z: 0 },
      LineHeight: 2.25,
      Color: { B: 75, G: 185, R: 255, A: 255 },
    });
    const brick = {
      key: `v13:${mechanicGrid}:header:${sequence++}`,
      g: mechanicGrid,
      data: {
        size: [width / 2, 10, 2], position: [x + width / 2, y, 2],
        direction: 4, rotation: 0,
        collision: { player: true, weapon: true, interaction: true, tool: true, physics: true },
        visibility: true, material_intensity: 0, color: [20, 20, 20],
        owner_index: 0, asset: 'PB_DefaultMicroBrick', material: 'BMC_Glow',
      },
      comps: [{ type: C.TextDisplay.NAME, data: display }],
    };
    scene.bricks.push(brick);
    bricks.set(brick.key, brick);
    return brick;
  };

  const vehicleInput = gate('MicrochipInput', {
    PortLabel: 'Vehicle Grid', PortOrder: 1,
    CallableDefault: O(null), CallableMirror: O(null),
  }, 'Vehicle Grid input');
  const ownerInput = gate('MicrochipInput', {
    PortLabel: 'Owner User ID', PortOrder: 2,
    CallableDefault: S(''), CallableMirror: S(''),
  }, 'Owner User ID input');
  const request = gate('Event_CustomGlobal', {
    EventName: 'SR.Mechanic.Request', bIsObjectEvent: true,
    DataOut1: O(null), DataOut2: N(0), DataOut3: N(0), DataOut4: N(0),
    DataOut5: N(0), DataOut6: N(0), DataOut7: N(0), DataOut8: N(0),
  }, 'Receive targeted mechanic request');
  const requestVehicle = gate('Expr_CompareEqual', { InputA: O(null), InputB: O(null) },
    'Request targets this vehicle');
  const requestProtocol = gate('Expr_CompareEqual', { InputA: N(0), InputB: N(1) },
    'Request protocol is version 1');
  const ownerPresent = gate('Expr_CompareNotEqual', { InputA: S(''), InputB: S('') },
    'Stable owner ID is ready');
  const requestAnd1 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Vehicle and protocol request guard');
  const requestAnd2 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Complete request guard');
  const requestBranch = gate('Exec_Branch', { bCond: false }, 'Accept valid mechanic request');
  const requestNonce = gate('Var', { Value: N(0) }, 'Active mechanic session nonce');
  const storeNonce = gate('Exec_Var_Set', { Value: N(0) }, 'Store mechanic session nonce');
  const reply = gate('Exec_SendCustomEventGlobal', {
    EventName: 'SR.Mechanic.Reply', DataIn1: O(null), DataIn2: N(0),
    DataIn3: S('Truck1'), DataIn4: N(1), DataIn5: N(1), DataIn6: S(''),
    DataIn7: N(0), DataIn8: N(0),
  }, 'Reply with Truck1 profile and owner');

  const reload = gate('Event_CustomGlobal', {
    EventName: 'SR.Mechanic.Reload', bIsObjectEvent: true,
    DataOut1: O(null), DataOut2: N(0), DataOut3: S(''), DataOut4: S(''),
    DataOut5: N(0), DataOut6: S(''), DataOut7: N(0), DataOut8: N(0),
  }, 'Receive targeted saved-upgrade reload');
  const reloadVehicle = gate('Expr_CompareEqual', { InputA: O(null), InputB: O(null) },
    'Reload targets this vehicle');
  const reloadNonce = gate('Expr_CompareEqual', { InputA: N(0), InputB: N(0) },
    'Reload belongs to active terminal session');
  const reloadType = gate('Expr_CompareEqual', { InputA: S(''), InputB: S('Truck1') },
    'Reload catalog ID is Truck1');
  const reloadOwner = gate('Expr_CompareEqual', { InputA: S(''), InputB: S('') },
    'Reload owner matches truck owner');
  const reloadProtocol = gate('Expr_CompareEqual', { InputA: N(0), InputB: N(1) },
    'Reload protocol is version 1');
  const reloadAnd1 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Reload vehicle and nonce guard');
  const reloadAnd2 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Reload type and owner guard');
  const reloadAnd3 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Reload protocol guard');
  const reloadAnd4 = gate('Expr_LogicalAND', { bInputA: false, bInputB: false },
    'Complete reload guard');
  const reloadBranch = gate('Exec_Branch', { bCond: false },
    'Reload only an authorized saved profile');
  const spawnBuffer = gate('BufferTicks', { TicksToWait: 2, ZeroTicksToWait: 0 },
    'Wait for owner PlayerState resolution on spawn');
  const loadUnion = gate('Exec_Union', {}, 'Spawn or mechanic reload');
  const safeProfiles = stockDefaults.map((stock, index) => gate('Expr_Select', {
    bSelectB: false,
    InputA: clone(stock),
    InputB: clone(stock),
  }, `${fallbackLabels[index]} stock fallback`));

  header('REQUEST + REPLY', 180, 0, 20);
  rowAt([vehicleInput, ownerInput, request, requestVehicle, requestProtocol, ownerPresent,
    requestAnd1, requestAnd2, requestBranch, requestNonce, storeNonce, reply], 0, 5);
  header('RELOAD GUARDS', 150, 0, -20);
  rowAt([reload, reloadVehicle, reloadNonce, reloadType, reloadOwner, reloadProtocol,
    reloadAnd1, reloadAnd2, reloadAnd3, reloadAnd4, reloadBranch], 0, -35);
  header('SAVED PROFILE LOAD', 80, 0, -60);
  rowAt([spawnBuffer, loadUnion], 0, -75);
  header('SAFE PROFILE FALLBACKS', 100, 0, -100);
  rowAt(safeProfiles, 0, -115);

  add(vehicleGridSource, C.ReadBrickGrid.NAME, 'BrickGrid', vehicleInput,
    C.MicrochipInput.NAME, 'RER_Input');
  add(ownerUserId, C.MicrochipOutput.NAME, 'RER_Output', ownerInput,
    C.MicrochipInput.NAME, 'RER_Input');

  add(request, C.Event_CustomGlobal.NAME, 'DataOut1', requestVehicle,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(vehicleInput, C.MicrochipInput.NAME, 'RER_Output', requestVehicle,
    C.Expr_CompareEqual.NAME, 'InputB');
  add(request, C.Event_CustomGlobal.NAME, 'DataOut3', requestProtocol,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(ownerInput, C.MicrochipInput.NAME, 'RER_Output', ownerPresent,
    C.Expr_CompareNotEqual.NAME, 'InputA');
  add(requestVehicle, C.Expr_CompareEqual.NAME, 'bOutput', requestAnd1,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(requestProtocol, C.Expr_CompareEqual.NAME, 'bOutput', requestAnd1,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(requestAnd1, C.Expr_LogicalAND.NAME, 'bOutput', requestAnd2,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(ownerPresent, C.Expr_CompareNotEqual.NAME, 'bOutput', requestAnd2,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(request, C.Event_CustomGlobal.NAME, 'ExecOut', requestBranch,
    C.Exec_Branch.NAME, 'Exec');
  add(requestAnd2, C.Expr_LogicalAND.NAME, 'bOutput', requestBranch,
    C.Exec_Branch.NAME, 'bCond');
  add(requestNonce, C.Var.NAME, 'VarRef', storeNonce, C.Exec_Var_Set.NAME, 'VarRef');
  add(request, C.Event_CustomGlobal.NAME, 'DataOut2', storeNonce,
    C.Exec_Var_Set.NAME, 'Value');
  add(requestBranch, C.Exec_Branch.NAME, 'ExecOutA', storeNonce,
    C.Exec_Var_Set.NAME, 'Exec');
  add(storeNonce, C.Exec_Var_Set.NAME, 'ExecOut', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn');
  add(request, C.Event_CustomGlobal.NAME, 'DataOut1', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn1');
  add(request, C.Event_CustomGlobal.NAME, 'DataOut2', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn2');
  add(ownerInput, C.MicrochipInput.NAME, 'RER_Output', reply,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6');

  add(reload, C.Event_CustomGlobal.NAME, 'DataOut1', reloadVehicle,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(vehicleInput, C.MicrochipInput.NAME, 'RER_Output', reloadVehicle,
    C.Expr_CompareEqual.NAME, 'InputB');
  add(reload, C.Event_CustomGlobal.NAME, 'DataOut2', reloadNonce,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(requestNonce, C.Var.NAME, 'Value', reloadNonce,
    C.Expr_CompareEqual.NAME, 'InputB');
  add(reload, C.Event_CustomGlobal.NAME, 'DataOut3', reloadType,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(reload, C.Event_CustomGlobal.NAME, 'DataOut6', reloadOwner,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(ownerInput, C.MicrochipInput.NAME, 'RER_Output', reloadOwner,
    C.Expr_CompareEqual.NAME, 'InputB');
  add(reload, C.Event_CustomGlobal.NAME, 'DataOut8', reloadProtocol,
    C.Expr_CompareEqual.NAME, 'InputA');
  add(reloadVehicle, C.Expr_CompareEqual.NAME, 'bOutput', reloadAnd1,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(reloadNonce, C.Expr_CompareEqual.NAME, 'bOutput', reloadAnd1,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(reloadType, C.Expr_CompareEqual.NAME, 'bOutput', reloadAnd2,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(reloadOwner, C.Expr_CompareEqual.NAME, 'bOutput', reloadAnd2,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(reloadAnd1, C.Expr_LogicalAND.NAME, 'bOutput', reloadAnd3,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(reloadAnd2, C.Expr_LogicalAND.NAME, 'bOutput', reloadAnd3,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(reloadAnd3, C.Expr_LogicalAND.NAME, 'bOutput', reloadAnd4,
    C.Expr_LogicalAND.NAME, 'bInputA');
  add(reloadProtocol, C.Expr_CompareEqual.NAME, 'bOutput', reloadAnd4,
    C.Expr_LogicalAND.NAME, 'bInputB');
  add(reloadAnd4, C.Expr_LogicalAND.NAME, 'bOutput', reloadBranch,
    C.Exec_Branch.NAME, 'bCond');
  add(reload, C.Event_CustomGlobal.NAME, 'ExecOut', reloadBranch,
    C.Exec_Branch.NAME, 'Exec');

  add(updateCar, C.Event_CustomGlobal.NAME, 'ExecOut', spawnBuffer,
    C.BufferTicks.NAME, 'Input');
  add(spawnBuffer, C.BufferTicks.NAME, 'Output', loadUnion, C.Exec_Union.NAME, 'ExecA');
  add(reloadBranch, C.Exec_Branch.NAME, 'ExecOutA', loadUnion,
    C.Exec_Union.NAME, 'ExecB');

  for (const getter of getters) {
    assert.equal(removeInput(getter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec').length,
      1, `${component(getter, C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key} old Exec`);
    assert.equal(removeInput(getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState').length, 1,
    `${component(getter, C.Exec_Gamemode_GetLeaderboardValue.NAME).data.Key} old PlayerState`);
    add(loadUnion, C.Exec_Union.NAME, 'ExecOut', getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Exec');
    add(ownerPlayerState, C.MicrochipOutput.NAME, 'RER_Output', getter,
      C.Exec_Gamemode_GetLeaderboardValue.NAME, 'PlayerState');
  }

  for (const [index, arrayGet] of arrayGets.entries()) {
    const rawConsumers = scene.edges.filter(edge => edge.a === arrayGet.key
      && edge.at === C.Exec_ArrayVar_Get.NAME && edge.p === 'Value');
    assert.equal(rawConsumers.length, 1,
      `${fallbackLabels[index]} Array Get has one raw value consumer`);
    const rawConsumer = rawConsumers[0];
    scene.edges = scene.edges.filter(edge => edge !== rawConsumer);
    add(arrayGet, C.Exec_ArrayVar_Get.NAME, 'Value', safeProfiles[index],
      C.Expr_Select.NAME, 'InputA');
    add(arrayGet, C.Exec_ArrayVar_Get.NAME, 'bOutOfBounds', safeProfiles[index],
      C.Expr_Select.NAME, 'bSelectB');
    add(safeProfiles[index], C.Expr_Select.NAME, 'Output', bricks.get(rawConsumer.z),
      rawConsumer.zt, rawConsumer.q);
  }

  for (const grid of [board, mechanicGrid]) fit(scene, grid);
  const metadata = {
    name: 'Scrap Runners - Truck1 Mechanic Enabled v13',
    description: 'Truck1 v12 appearance and ownership logic plus a clean mechanic request/reply/reload controller, owner-authoritative upgrade reads, and catalog-matched steering/wheel profiles.',
    owner: owner(scene),
  };
  const written = writeTruck(scene, metadata);
  return {
    bytes: repack(written.bytes, donor, metadata),
    scene,
    remappedBrickHandles: written.remapped,
    grids: { board, mechanicGrid, ownerGrid },
  };
}

function finite(value, name) {
  if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite ${name}`);
  else if (Array.isArray(value)) value.forEach((child, index) =>
    finite(child, `${name}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value)
    .forEach(([key, child]) => finite(child, `${name}.${key}`));
}

module.exports = build;
if (require.main === module) {
  const result = build();
  result.scene.bricks.forEach((brick, index) => finite(brick, `truck[${index}]`));
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    remappedBrickHandles: result.remappedBrickHandles,
    mechanicGrid: result.grids.mechanicGrid,
    mechanicalProfiles: 6,
  }, null, 2));
}
