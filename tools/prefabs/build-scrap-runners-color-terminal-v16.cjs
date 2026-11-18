'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C, N } = require('./loadboard-lib.cjs');
const bounds = require('./native-brick-half-extents.json');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v15.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v16.brz'));

const clone = structuredClone;
const I = value => ({ $variant: 'i64', value });

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

function graph(scene, prefix) {
  let sequence = 0;
  const component = (brick, type) => {
    const result = brick?.comps.find(saved => saved.type === type);
    assert(result, `Missing ${type}`);
    return result;
  };
  const rows = () => scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows().filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected 1, got ${items.length}`);
    return items[0];
  };
  const row = (type, predicate = () => true, label = type) => one(all(type, predicate), label);
  const brick = key => one(scene.bricks.filter(item => item.key === key), `brick ${key}`);
  const incoming = (target, type, port) => scene.edges.filter(edge => edge.z === target.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (source, type, port) => scene.edges.filter(edge => edge.a === source.key
    && edge.at === type && (!port || edge.p === port));
  const add = (source, sourceType, sourcePort, target, targetType, targetPort) => {
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === targetPort), `Duplicate driver ${target.key}.${targetPort}`);
    scene.edges.push({ a: source.key, at: sourceType, p: sourcePort,
      z: target.key, zt: targetType, q: targetPort });
  };
  const removeInput = (target, type, port) => {
    const previous = incoming(target, type, port);
    scene.edges = scene.edges.filter(edge => !(edge.z === target.key
      && edge.zt === type && edge.q === port));
    return previous;
  };
  const label = text => one(scene.bricks.filter(brick => brick.comps.some(comp =>
    comp.type === C.Interact.NAME && (comp.data.PromptCustomLabel === text
      || comp.data.Message === text))), `label ${text}`);
  const base = clone(scene.bricks.find(brick =>
    brick.data.asset.startsWith('B_1x1_Gate_')).data);
  const gate = (kind, grid, data, name, color = [70, 145, 205], hover = name) => {
    const definition = C[kind];
    assert(definition, kind);
    const procedural = definition.BRICK.startsWith('PB_Gate_');
    const brickData = clone(base);
    Object.assign(brickData, {
      asset: definition.BRICK,
      position: [0, 0, 2],
      direction: 4,
      rotation: 0,
      size: procedural ? [10, 5, 2] : [0, 0, 0],
      color,
      material_intensity: 5,
    });
    const comps = [{ type: definition.NAME, data: clone(data) }];
    if (hover && !procedural) comps.push({
      type: C.Interact.NAME,
      data: {
        InteractSound: 0,
        Message: hover,
        ConsoleTag: '',
        bAllowNearbyInteraction: true,
        bHiddenInteraction: false,
        PromptCustomLabel: hover,
      },
    });
    const result = { key: `${prefix}:${grid}:${name}:${sequence++}`, g: grid,
      data: brickData, comps };
    scene.bricks.push(result);
    return result;
  };
  return { component, rows, all, one, row, brick, incoming, outgoing,
    add, removeInput, label, gate };
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
  copy.data.PlaneCenter = { X: (low[0] + high[0]) / 2,
    Y: (low[1] + high[1]) / 2, Z: 0 };
  copy.data.PlaneExtent = { X: (high[0] - low[0]) / 2 + 10,
    Y: (high[1] - low[1]) / 2 + 10, Z: 0 };
  scene.entityOverrides.set(grid, copy);
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();
  const g = graph(scene, 'v16');

  // The retained packed score already receives both accepted live replies and
  // the seated leaderboard fallback. It remains unchanged while H/S/B preview
  // controls are edited, so it is the exact baseline/current-color Var the UI
  // needs. Stop displaying the independent seated getter as CURRENT COLOR.
  const scoreState = g.label('Live packed color snapshot');
  const terminalGrid = scoreState.g;
  const currentColorGet = g.one(g.all(C.Exec_Gamemode_GetLeaderboardValue.NAME,
    (data, brick) => brick.g === terminalGrid && data.Key === ''
      && g.outgoing(brick, C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
        .some(edge => edge.zt === C.Expr_MathMax.NAME)),
  'current-color leaderboard display getter').brick;
  const currentClampEdge = g.one(g.outgoing(currentColorGet,
    C.Exec_Gamemode_GetLeaderboardValue.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_MathMax.NAME && edge.q === 'InputA'),
  'CURRENT COLOR clamp input');
  const currentClamp = g.brick(currentClampEdge.z);
  g.removeInput(currentClamp, C.Expr_MathMax.NAME, 'InputA');
  g.add(scoreState, C.Var.NAME, 'Value', currentClamp,
    C.Expr_MathMax.NAME, 'InputA');

  // A successful purchase is the only preview edit that advances the retained
  // baseline. Commit it after the leaderboard write succeeds and before the
  // Scrap debit, preserving the established transaction order.
  const colorWrite = g.row(C.Exec_Gamemode_SetLeaderboardValue.NAME,
    (_data, brick) => brick.g === terminalGrid, 'saved-color write').brick;
  const purchaseValue = g.one(g.incoming(colorWrite,
    C.Exec_Gamemode_SetLeaderboardValue.NAME, 'Value'), 'purchased packed color');
  const scrapDebit = g.row(C.Exec_Gamemode_IncrementLeaderboardValue.NAME,
    data => data.Key === 'Scrap', 'purchase Scrap debit').brick;
  const oldDebitExec = g.one(g.removeInput(scrapDebit,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec'),
  'saved-color write before Scrap debit');
  assert.equal(oldDebitExec.a, colorWrite.key);
  assert.equal(oldDebitExec.at, C.Exec_Gamemode_SetLeaderboardValue.NAME);
  assert.equal(oldDebitExec.p, 'ExecOut');
  const purchaseBaseline = g.gate('Exec_Var_Set', terminalGrid,
    { bChangeType: false, Value: I(0) }, 'purchase_baseline', [145, 95, 215],
    'Update CURRENT COLOR after successful purchase');
  g.add(scoreState, C.Var.NAME, 'VarRef', purchaseBaseline,
    C.Exec_Var_Set.NAME, 'VarRef');
  g.add(g.brick(purchaseValue.a), purchaseValue.at, purchaseValue.p,
    purchaseBaseline, C.Exec_Var_Set.NAME, 'Value');
  g.add(colorWrite, C.Exec_Gamemode_SetLeaderboardValue.NAME, 'ExecOut',
    purchaseBaseline, C.Exec_Var_Set.NAME, 'Exec');
  g.add(purchaseBaseline, C.Exec_Var_Set.NAME, 'ExecOut', scrapDebit,
    C.Exec_Gamemode_IncrementLeaderboardValue.NAME, 'Exec');

  // Expr_ColorConvert operates on the numeric channels of its LinearColor
  // input. v15 fed linear-light channels directly into HSV, then rebuilt them
  // through the terminal's sRGB-byte HSB renderer. That maps live #FFA100 to
  // roughly #FF5A00. Explicitly extract sRGB bytes, normalize them to 0..1,
  // package those raw sRGB channels, and only then convert Srgb -> Hsv.
  const hsvConversions = g.all(C.Expr_ColorConvert.NAME,
    data => data.ToSpace === 3);
  assert.equal(hsvConversions.length, 2, 'sync and accepted-hex HSV conversions');
  const coreGrid = hsvConversions[0].brick.g;
  assert(hsvConversions.every(item => item.brick.g === coreGrid),
    'both HSV conversions share the color core');
  const colorRows = [];
  for (const [index, conversion] of hsvConversions.entries()) {
    assert.equal(conversion.comp.data.FromSpace, 0,
      `HSV conversion ${index + 1} previously consumed linear RGB`);
    conversion.comp.data.FromSpace = 1;
    const oldInput = g.one(g.removeInput(conversion.brick,
      C.Expr_ColorConvert.NAME, 'Input'), `HSV conversion ${index + 1} source`);
    const splitSrgb = g.gate('Expr_SplitColorSRGB', coreGrid,
      { Input: { R: 1, G: 1, B: 1, A: 1 } }, `hsv_srgb_split_${index}`,
      [145, 95, 215], `Read sRGB bytes for HSV path ${index + 1}`);
    const normalized = ['R', 'G', 'B'].map(channel => g.gate('Expr_MathDivide',
      coreGrid, { InputA: N(0), InputB: N(255) },
      `hsv_srgb_${channel.toLowerCase()}_${index}`, [145, 95, 215],
      `Normalize sRGB ${channel} for HSV path ${index + 1}`));
    const makeSrgb = g.gate('Expr_MakeColor', coreGrid,
      { R: 0, G: 0, B: 0, A: 1 }, `hsv_srgb_color_${index}`,
      [145, 95, 215], `Pack normalized sRGB for HSV path ${index + 1}`);
    g.add(g.brick(oldInput.a), oldInput.at, oldInput.p, splitSrgb,
      C.Expr_SplitColorSRGB.NAME, 'Input');
    ['R', 'G', 'B'].forEach((channel, channelIndex) => {
      g.add(splitSrgb, C.Expr_SplitColorSRGB.NAME, channel,
        normalized[channelIndex], C.Expr_MathDivide.NAME, 'InputA');
      g.add(normalized[channelIndex], C.Expr_MathDivide.NAME, 'Output',
        makeSrgb, C.Expr_MakeColor.NAME, channel);
    });
    g.add(makeSrgb, C.Expr_MakeColor.NAME, 'Output', conversion.brick,
      C.Expr_ColorConvert.NAME, 'Input');
    colorRows.push([splitSrgb, ...normalized, makeSrgb]);
  }

  rowAt([purchaseBaseline], 320, -105);
  colorRows.forEach((row, index) => rowAt(row, 600, -85 - index * 20));
  fit(scene, terminalGrid);
  fit(scene, coreGrid);

  const metadata = {
    name: 'Scrap Runners - Color Terminal v16 sRGB Baseline Sync',
    description: 'Roundtrips live and hex colors through sRGB HSV, displays the retained entering-vehicle baseline as CURRENT COLOR, and preserves v15 synchronization and seat-safe purchases.',
    owner: owner(scene),
  };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, grids: { terminalGrid, coreGrid } };
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
    currentColor: 'retained entering-vehicle/purchased baseline',
    hsvInput: 'LinearColor -> sRGB bytes -> normalized sRGB -> HSV',
  }, null, 2));
}
