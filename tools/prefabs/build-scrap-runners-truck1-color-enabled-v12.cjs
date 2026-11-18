'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v11.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-truck1-color-enabled-v12.brz'));

const clone = structuredClone;
const N = value => ({ $variant: 'f64', value });
const S = value => ({ $variant: 'str', value });
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

function writeTruck(scene, metadata) {
  const first = read(write(scene, metadata).bytes);
  const beforeEntities = [...scene.r.entities()];
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
  const entity = [...scene.r.entities()].find(saved => saved.persistentIndex === grid);
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
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({
      a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort,
    });
  };
  const removeInput = (target, type, port) => {
    const old = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return old;
  };
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(saved =>
    saved.type === C.Interact.NAME && (saved.data.PromptCustomLabel === text
      || saved.data.Message === text))), `label ${text}`);
  const linkForChild = child => one(scene.links.filter(link => link.grid === child),
    `microchip link for grid ${child}`);
  const chipForChild = child => bricks.get(linkForChild(child).key);

  const colorGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Color'), 'Truck1Color getter').brick;
  const materialGetter = one(all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    data => data.Key === 'Truck1Material'), 'Truck1Material getter').brick;
  const appearanceGrid = colorGetter.g;
  assert.equal(materialGetter.g, appearanceGrid, 'color and material getters share board');
  const colorControllerChip = label('Truck1Color controller');
  assert.equal(colorControllerChip.g, appearanceGrid, 'color controller is on upgrade board');
  const controllerGrid = linkForChild(scene.links.find(link =>
    link.key === colorControllerChip.key).grid).grid;
  const materialChip = one(scene.bricks.filter(brick => brick.g === appearanceGrid
    && brick.comps.some(saved => saved.type === C.TextDisplay.NAME
      && saved.data.Text === 'material-decoder')), 'material decoder chip');
  const materialGrid = scene.links.find(link => link.key === materialChip.key).grid;

  const ownerLabel = one(all(C.TextDisplay.NAME,
    data => /^OWNER \/ PLAYERSTATE/.test(data.Text || '')), 'owner label').brick;
  const generalGrid = ownerLabel.g;
  const ownerUpdate = one(all(C.Event_CustomGlobal.NAME,
    (data, brick) => brick.g === generalGrid && data.EventName === 'UpdateCar'),
  'owner UpdateCar event').brick;
  const ownerResolver = label('Resolve spawning Character to Owner PlayerState');
  const ownerOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner PlayerState'), 'Owner PlayerState output').brick;
  const ownerVar = bricks.get(one(incoming(ownerOutput,
    C.MicrochipOutput.NAME, 'RER_Input'), 'owner Var source').a);
  const ownerSetter = bricks.get(one(outgoing(ownerVar, C.Var.NAME, 'VarRef')
    .filter(edge => edge.zt === C.Exec_Var_Set.NAME), 'owner setter').z);
  const ownerIdGetter = label('Resolve retained owner to stable user ID');
  const ownerIdSetter = label('Store stable owner user ID');
  const ownerIdVar = label('Owner User ID');
  const ownerIdOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Owner User ID'), 'Owner User ID output').brick;
  const ownerBricks = [ownerLabel, ownerUpdate, ownerResolver, ownerSetter, ownerVar,
    ownerOutput, ownerIdGetter, ownerIdSetter, ownerIdVar, ownerIdOutput];
  assert(ownerBricks.every(brick => brick.g === generalGrid),
    'all owner logic starts in the general vehicle chip');

  // Reuse the old material-decoder child grid and its chip brick as the new
  // owner controller. Move the decoder itself into the combined controller.
  const materialDecoderBricks = scene.bricks.filter(brick => brick.g === materialGrid);
  assert.equal(materialDecoderBricks.length, 9, 'complete material decoder grid');
  for (const brick of materialDecoderBricks) brick.g = controllerGrid;
  for (const brick of ownerBricks) brick.g = materialGrid;
  rowAt([ownerUpdate, ownerResolver, ownerSetter, ownerVar, ownerOutput,
    ownerIdGetter, ownerIdSetter, ownerIdVar, ownerIdOutput], -10, 5);
  ownerLabel.data.position = [90, -15, 2];

  const ownerChipText = component(materialChip, C.TextDisplay.NAME);
  ownerChipText.data.Text = 'OWNER /\r\nPLAYERSTATE';
  ownerChipText.data.Rotation = -45;
  ownerChipText.data.LineHeight = 1.35;
  ownerChipText.data.Color = { B: 225, G: 185, R: 70, A: 255 };
  if (!materialChip.comps.some(saved => saved.type === C.Interact.NAME)) {
    materialChip.comps.push({
      type: C.Interact.NAME,
      data: {
        InteractSound: 0,
        Message: 'Owner / PlayerState controller',
        ConsoleTag: '',
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
        PromptCustomLabel: 'Owner / PlayerState controller',
      },
    });
  }
  materialChip.data.position = [75, 5, 2];

  // Move every outer-board appearance helper into the existing color
  // controller. The two leaderboard getters and the two controller chips are
  // the only appearance/ownership controls left visible on the green board.
  const outerAppearanceKeys = [
    '[13,-1,-1,-1,0]',
    ...Array.from({ length: 19 }, (_, index) => `[13,-1,-1,-1,${50 + index}]`),
  ];
  const outerAppearance = outerAppearanceKeys.map(key => one(scene.bricks
    .filter(brick => brick.key === key), `outer appearance brick ${key}`));
  assert(outerAppearance.every(brick => brick.g === appearanceGrid),
    'appearance helpers start on green board');
  for (const brick of outerAppearance) brick.g = controllerGrid;

  const interfaceEvent = one(all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Interface with Vehicle'), 'preview receiver').brick;
  const restoreEvent = one(all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'Restore Truck1Color'), 'restore receiver').brick;
  const requestEvent = one(all(C.Event_CustomGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Request'), 'appearance request').brick;
  const replySender = one(all(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SR.Appearance.Reply'), 'appearance reply sender').brick;
  const colorOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Color'), 'color output').brick;
  const materialOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Material'), 'material output').brick;
  const intensityOutput = one(all(C.MicrochipOutput.NAME,
    data => data.PortLabel === 'Output Truck1Intensity'), 'intensity output').brick;
  const colorProperty = one(all(C.Exec_Entity_SetCustomProperty.NAME,
    data => data.Key === 'CurrentColorScore'), 'color property setter').brick;
  const materialProperty = one(all(C.Exec_Entity_SetCustomProperty.NAME,
    data => data.Key === 'CurrentMaterialEnum'), 'material property setter').brick;
  const materialMultiply = bricks.get(one(incoming(materialProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Value'), 'material score multiplier').a);
  const requestSplit = bricks.get(one(outgoing(requestEvent,
    C.Event_CustomGlobal.NAME, 'ExecOut').filter(edge =>
    edge.zt === C.Exec_SendCustomEventGlobal.NAME), 'request reply execution').z);
  assert.equal(requestSplit.key, replySender.key, 'request directly executes reply');

  const gateBase = clone(scene.bricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  let sequence = 0;
  const gate = (kind, position, data, key, hover) => {
    const definition = C[kind];
    assert(definition, kind);
    const brickData = clone(gateBase);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position,
      direction: 4,
      rotation: 0,
      size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
      color: [225, 95, 180],
      material_intensity: 5,
    });
    const result = {
      key: `v12:${controllerGrid}:${key}:${sequence++}`,
      g: controllerGrid,
      data: brickData,
      comps: [
        { type: definition.NAME, data: clone(data) },
        {
          type: C.Interact.NAME,
          data: {
            InteractSound: 0,
            Message: hover,
            ConsoleTag: '',
            bAllowNearbyInteraction: true,
            bHiddenInteraction: false,
            PromptCustomLabel: hover,
          },
        },
      ],
    };
    scene.bricks.push(result);
    bricks.set(result.key, result);
    return result;
  };

  const savedMaterialInput = gate('MicrochipInput', [20, -10, 2], {
    PortLabel: 'Saved Material Score', PortOrder: 2,
    CallableDefault: N(0), CallableMirror: N(0),
  }, 'saved_material_input', 'Saved Material Score input');
  const ownerIdInput = gate('MicrochipInput', [30, -10, 2], {
    PortLabel: 'Owner User ID', PortOrder: 3,
    CallableDefault: S(''), CallableMirror: S(''),
  }, 'owner_id_input', 'Owner User ID input');
  const vehicleGridInput = gate('MicrochipInput', [40, -10, 2], {
    PortLabel: 'Vehicle Grid', PortOrder: 4,
    CallableDefault: O(null), CallableMirror: O(null),
  }, 'vehicle_grid_input', 'Vehicle Grid input');
  const savedColorInput = one(all(C.MicrochipInput.NAME,
    (data, brick) => brick.g === controllerGrid && data.PortLabel === 'Integer'),
  'existing saved color input').brick;
  const savedColorComp = component(savedColorInput, C.MicrochipInput.NAME);
  savedColorComp.data.PortLabel = 'Saved Color Score';
  savedColorComp.data.PortOrder = 1;

  const materialScoreEdge = one(removeInput(bricks.get('[15,-1,-1,-1,1]'),
    C.Expr_CompareEqual.NAME, 'InputB'), 'old direct material score');
  assert.equal(materialScoreEdge.a, materialGetter.key);
  add(materialGetter, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value', savedMaterialInput,
    C.MicrochipInput.NAME, 'RER_Input');
  add(savedMaterialInput, C.MicrochipInput.NAME, 'RER_Output',
    bricks.get('[15,-1,-1,-1,1]'), C.Expr_CompareEqual.NAME, 'InputB');

  const oldOwnerReply = one(removeInput(replySender,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6'), 'old direct owner ID reply');
  assert.equal(oldOwnerReply.a, ownerIdOutput.key);
  add(ownerIdOutput, C.MicrochipOutput.NAME, 'RER_Output', ownerIdInput,
    C.MicrochipInput.NAME, 'RER_Input');
  add(ownerIdInput, C.MicrochipInput.NAME, 'RER_Output', replySender,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6');

  const oldColorEntity = one(removeInput(colorProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Entity'), 'old color entity source');
  const oldMaterialEntity = one(removeInput(materialProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Entity'), 'old material entity source');
  assert.equal(oldColorEntity.a, oldMaterialEntity.a, 'custom properties share vehicle grid');
  const vehicleGridSource = bricks.get(oldColorEntity.a);
  add(vehicleGridSource, oldColorEntity.at, oldColorEntity.p, vehicleGridInput,
    C.MicrochipInput.NAME, 'RER_Input');
  add(vehicleGridInput, C.MicrochipInput.NAME, 'RER_Output', colorProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Entity');
  add(vehicleGridInput, C.MicrochipInput.NAME, 'RER_Output', materialProperty,
    C.Exec_Entity_SetCustomProperty.NAME, 'Entity');

  // Compact internal sections. Existing color decoder/body rows stay intact;
  // imported material and protocol logic is placed in touching rows below it.
  rowAt(materialDecoderBricks.sort((a, b) =>
    a.data.position[1] - b.data.position[1] || a.data.position[0] - b.data.position[0]),
  0, 130);
  const loadBuffer = bricks.get('[13,-1,-1,-1,53]');
  const loadUnion = bricks.get('[13,-1,-1,-1,54]');
  rowAt([loadBuffer, loadUnion, restoreEvent, interfaceEvent], 0, 150);
  rowAt([materialMultiply, materialProperty, colorProperty], 0, 170);
  const pack = ['[13,-1,-1,-1,61]', '[13,-1,-1,-1,62]',
    '[13,-1,-1,-1,63]', '[13,-1,-1,-1,64]', '[13,-1,-1,-1,65]',
    '[13,-1,-1,-1,66]', '[13,-1,-1,-1,67]'].map(key => bricks.get(key));
  rowAt([colorOutput, materialOutput, intensityOutput, requestEvent,
    ...pack, replySender], 0, 190);
  const loadLabel = bricks.get('[13,-1,-1,-1,55]');
  component(loadLabel, C.TextDisplay.NAME).data.Text =
    'COLOR + MATERIAL LOAD / RESTORE / TERMINAL PROTOCOL';
  loadLabel.data.position = [130, 230, 2];

  const controllerText = component(colorControllerChip, C.TextDisplay.NAME);
  controllerText.data.Text = 'COLOR + MATERIAL\r\nCONTROLLER';
  const controllerInteract = component(colorControllerChip, C.Interact.NAME);
  controllerInteract.data.Message = 'Color + Material controller';
  controllerInteract.data.PromptCustomLabel = 'Color + Material controller';
  colorControllerChip.data.position = [35, 5, 2];
  const controllerTitle = scene.bricks.find(brick => brick.key === '[16,-1,-1,-1,6]');
  component(controllerTitle, C.TextDisplay.NAME).data.Text =
    '<size="96">TRUCK1 COLOR + MATERIAL CONTROLLER</>\r\nSaved appearance, temporary preview, terminal protocol, and body application';
  controllerTitle.data.position = [280, 260, 2];

  const materialLabel = one(all(C.TextDisplay.NAME,
    (data, brick) => brick.g === appearanceGrid && data.Text === 'Truck1Material'),
  'Truck1Material row label').brick;
  const colorLabel = one(all(C.TextDisplay.NAME,
    (data, brick) => brick.g === appearanceGrid && data.Text === 'Truck1Color'),
  'Truck1Color row label').brick;
  materialLabel.data.position = [0, -5, 2];
  materialGetter.data.position = [15, -5, 2];
  colorLabel.data.position = [0, 15, 2];
  colorGetter.data.position = [15, 15, 2];

  // Confirm the green board now exposes exactly the requested two appearance
  // getters plus the combined appearance and owner controller chips.
  assert(scene.bricks.filter(brick => brick.g === appearanceGrid
    && outerAppearance.includes(brick)).length === 0,
  'all loose appearance helpers moved into controller');
  assert(scene.bricks.filter(brick => brick.g === generalGrid
    && ownerBricks.includes(brick)).length === 0,
  'all owner logic removed from general vehicle chip');

  for (const grid of [generalGrid, appearanceGrid, materialGrid, controllerGrid]) fit(scene, grid);
  const metadata = {
    name: 'Scrap Runners - Truck1 Consolidated Appearance Logic v12',
    description: 'Leaves only Truck1Color and Truck1Material getters plus one combined appearance controller on the green upgrade board, and moves the complete owner/PlayerState chain into its own adjacent controller.',
    owner: owner(scene),
  };
  const written = writeTruck(scene, metadata);
  return {
    bytes: repack(written.bytes, donor, metadata),
    scene,
    remappedBrickHandles: written.remapped,
    grids: { generalGrid, appearanceGrid, ownerGrid: materialGrid, controllerGrid },
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
    visibleAppearanceBoard: 'Truck1Color getter + Truck1Material getter + one controller',
    ownerController: 'single dedicated chip on the green upgrade board',
  }, null, 2));
}
