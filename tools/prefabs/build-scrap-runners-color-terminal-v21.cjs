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
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v20.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v21.brz'));

const clone = structuredClone;
const S = value => ({ $variant: 'str', value });

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

function halfSize(brick) {
  if (brick.data.size?.some(value => value > 0)) return brick.data.size;
  return bounds.assets[brick.data.asset]
    || (brick.data.asset.startsWith('PB_Gate_') ? [10, 5, 2] : undefined);
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
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
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
  const gateBase = clone(scene.bricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const gate = (kind, grid, position, data, key, hover) => {
    const definition = C[kind];
    assert(definition, kind);
    const brickData = clone(gateBase);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position,
      direction: 4,
      rotation: 0,
      size: definition.BRICK.startsWith('PB_Gate_') ? [10, 5, 2] : [0, 0, 0],
      color: [235, 150, 45],
      material_intensity: 5,
    });
    const result = {
      key: `v21:${grid}:${key}`,
      g: grid,
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

  const suffixes = rows.filter(item => item.comp.type === C.Expr_Select.NAME
    && item.comp.data.InputA?.$variant === 'str'
    && item.comp.data.InputA.value === '  </>'
    && item.comp.data.InputB?.$variant === 'str'
    && item.comp.data.InputB.value === ' <</>');
  assert.equal(suffixes.length, 6, 'six selectable-row suffix selectors');
  const coreGrid = suffixes[0].brick.g;

  suffixes.forEach(({ brick: suffix, comp }, index) => {
    const oldCondition = one(removeInput(suffix, C.Expr_Select.NAME, 'bSelectB'),
      `row ${index} old selected-and-blink condition`);
    assert.equal(oldCondition.at, C.Expr_LogicalAND.NAME,
      `row ${index} suffix was driven by selected AND blink`);
    const selectedAndBlink = bricks.get(oldCondition.a);
    const selection = one(incoming(selectedAndBlink,
      C.Expr_LogicalAND.NAME, 'bInputA'), `row ${index} selection comparison`);
    assert.equal(selection.at, C.Expr_CompareEqual.NAME,
      `row ${index} selection source is the existing row comparison`);

    // The outer selector now owns the selection state. Unselected is truly
    // empty. Selected routes an inner blink selector that always closes the
    // orange span, with or without the visible right-side marker.
    comp.data.InputA = S('');
    comp.data.InputB = S('');
    const marker = gate('Expr_Select', coreGrid, [15 + index * 10, -305, 2], {
      bSelectB: false,
      InputA: S('  </>'),
      InputB: S(' <</>'),
    }, `row_${index}_selected_suffix`,
    `Row ${index} selected close and blinking right marker`);
    add(bricks.get(selection.a), selection.at, selection.p, suffix,
      C.Expr_Select.NAME, 'bSelectB');
    add(selectedAndBlink, C.Expr_LogicalAND.NAME, 'bOutput', marker,
      C.Expr_Select.NAME, 'bSelectB');
    add(marker, C.Expr_Select.NAME, 'Output', suffix,
      C.Expr_Select.NAME, 'InputB');

    const formatterEdge = one(outgoing(suffix, C.Expr_Select.NAME, 'Output')
      .filter(edge => edge.zt === C.Expr_String_FormatText.NAME),
    `row ${index} formatter suffix input`);
    component(bricks.get(formatterEdge.z), C.Expr_String_FormatText.NAME)
      .data[formatterEdge.q] = S('');
  });

  fit(scene, coreGrid);
  const metadata = {
    name: 'Scrap Runners - Color Terminal v21 Clean Selection Marker',
    description: 'Removes the visible orphan rich-text closing tag from every unselected row while preserving orange selected text and its authorized 0.25-second right-side marker blink.',
    owner: owner(scene),
  };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, coreGrid };
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
  result.scene.bricks.forEach((brick, index) => finite(brick, `terminal[${index}]`));
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    unselectedRows: 'no marker and no visible orphan closing tag',
    selectedRows: 'orange text plus authorized 0.25-second blinking right <',
    truck: 'continue using Truck1 v11',
  }, null, 2));
}
