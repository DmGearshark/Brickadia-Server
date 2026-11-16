'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const { WorldReader, brdb } = require('brs-js');
const { read } = require('./reskin-loadboard.cjs');
const { C } = require('./loadboard-lib.cjs');

const GEARSHARK_ID = 'afee2120-d5ad-44d5-97ef-b3a20552e7cf';

function components(scene, type, grid) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(comp => comp.type === type && (grid === undefined || brick.g === grid))
    .map(comp => ({ brick, comp })));
}

function incoming(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.z === brick.key && edge.zt === type && edge.q === port);
}

function outgoing(scene, brick, type, port) {
  return scene.edges.filter(edge => edge.a === brick.key && edge.at === type && edge.p === port);
}

function compOn(scene, key, type) {
  return scene.bricks.find(brick => brick.key === key)
    ?.comps.find(comp => comp.type === type);
}

function assertGearsharkOwnership(reader) {
  const owners = reader.owners();
  const ids = owners.UserIds.map(brdb.guidToUuid).map(id => id.toLowerCase());
  const ownerIndex = ids.indexOf(GEARSHARK_ID);
  assert(ownerIndex >= 0, 'Gearshark is present in the owner table');
  assert.equal(owners.UserNames[ownerIndex], 'Gearshark');

  for (const grid of reader.gridIds()) {
    for (const chunk of reader.brickChunkIndex(grid)) {
      const soa = reader.brickChunkSoa(grid, chunk.index);
      assert(soa.OwnerIndices.every(index => index === ownerIndex),
        `grid ${grid} current brick ownership is Gearshark`);
      assert(soa.OriginalOwnerIndices.every(index => index === ownerIndex),
        `grid ${grid} original brick ownership is Gearshark`);
    }
  }

  const entities = [...reader.entities()];
  assert(entities.length > 0, 'prefab has dynamic entities');
  assert(entities.every(entity => entity.ownerIndex === ownerIndex),
    'all current entity ownership is Gearshark');
  assert(entities.every(entity => entity.originalOwnerIndex === ownerIndex),
    'all original entity ownership is Gearshark');

  const bundle = JSON.parse(Buffer.from(reader.fs.readFile('Meta/Bundle.json')).toString());
  assert((bundle.authors || []).some(author =>
    (author.iD || author.id || '').toLowerCase() === GEARSHARK_ID),
  'Gearshark remains a bundle author');
  return ownerIndex;
}

function findFormat(formats, label) {
  const pattern = new RegExp(`\\b${label}\\b`, 'i');
  return formats.find(({ comp }) => pattern.test(comp.data.FormatString)
    && ['{A}', '{B}', '{C}'].every(token => comp.data.FormatString.includes(token))
    && !comp.data.FormatString.includes('W/S SELECT'));
}

function test(input) {
  const bytes = typeof input === 'string' ? fs.readFileSync(input) : Buffer.from(input);
  const reader = WorldReader.from(bytes);
  const scene = read(bytes);

  assert.equal(scene.links.length, 2, 'outer and hidden-logic microchip links');
  const outerLink = scene.links.find(link =>
    scene.bricks.find(brick => brick.key === link.key)?.g === 1);
  assert(outerLink, 'outer microchip link');
  const mainGrid = outerLink.grid;
  const nestedLink = scene.links.find(link =>
    scene.bricks.find(brick => brick.key === link.key)?.g === mainGrid);
  assert(nestedLink, 'hidden-logic chip is inside the outer chip');
  const innerGrid = nestedLink.grid;

  // All eight values are normal W/S-selectable rows. RGB and HSV are not
  // relegated to modal entry alone.
  const formats = components(scene, C.Expr_String_FormatText.NAME, mainGrid);
  const rows = new Map();
  for (const label of [
    'RED', 'GREEN', 'BLUE',
    'HUE', 'SATURATION', 'VALUE',
    'MATERIAL', 'INTENSITY',
  ]) {
    const format = findFormat(formats, label);
    assert(format, `${label} has its own editable row formatter`);
    rows.set(label, format);
    for (const port of ['InputA', 'InputB', 'InputC']) {
      assert.equal(incoming(scene, format.brick, C.Expr_String_FormatText.NAME, port).length, 1,
        `${label} row ${port} is wired`);
    }
  }
  assert.equal(new Set([...rows.values()].map(({ brick }) => brick.key)).size, 8,
    'the eight selectable rows use eight distinct formatters');

  const annotatedLabels = new Set(components(scene, C.Interact.NAME, mainGrid)
    .map(({ comp }) => comp.data.PromptCustomLabel));
  for (const label of [
    'Red row format', 'Green row format', 'Blue row format',
    'Hue row format', 'Saturation row format', 'Value row format',
    'Material row format', 'Intensity row format',
  ]) assert(annotatedLabels.has(label), `editable label: ${label}`);

  const moduloEight = components(scene, C.Expr_MathModuloFloored.NAME, innerGrid)
    .filter(({ comp }) => comp.data.InputB?.value === 8);
  assert.equal(moduloEight.length, 2, 'W and S wrap through all eight rows');
  const moduloFive = components(scene, C.Expr_MathModuloFloored.NAME, innerGrid)
    .filter(({ comp }) => comp.data.InputB?.value === 5);
  assert.equal(moduloFive.length, 0, 'obsolete five-row navigation is gone');

  // C/Q/E are supplemental direct-entry shortcuts. They stay single-press
  // edge triggered; Space remains unused.
  const [splitter] = components(scene, C.InputSplitter.NAME, innerGrid);
  assert(splitter, 'seat input splitter');
  assert.equal(outgoing(scene, splitter.brick, C.InputSplitter.NAME, 'InputForward').length, 2,
    'W/S has distinct up and down threshold paths');
  assert.equal(outgoing(scene, splitter.brick, C.InputSplitter.NAME, 'InputRight').length, 2,
    'A/D has distinct decrement and increment threshold paths');
  for (const [port, mode] of [
    ['bPressedC', 'Hex'], ['bPressedQ', 'RGB'], ['bPressedE', 'HSV'],
  ]) {
    const edges = outgoing(scene, splitter.brick, C.InputSplitter.NAME, port);
    assert.equal(edges.length, 1, `${mode} has one dedicated shortcut`);
    assert(compOn(scene, edges[0].z, C.Expr_EdgeDetectorExec.NAME),
      `${mode} shortcut is edge detected`);
  }
  assert.equal(outgoing(scene, splitter.brick, C.InputSplitter.NAME, 'InputUp').length, 0,
    'Space has no obsolete Apply path');

  const boxes = components(scene, C.Exec_PlayerState_ShowTextInputBox.NAME, innerGrid);
  assert.equal(boxes.length, 3, 'Hex, RGB, and HSV entry dialogs');
  const dialogMessages = new Map([
    ['ENTER HEX COLOR', /6 RGB digits/i],
    ['ENTER RGB COLOR', /R\s*,\s*G\s*,\s*B|255\s*,\s*0\s*,\s*0/i],
    ['ENTER HSV COLOR', /H\s*,\s*S\s*,\s*V|0\s*,\s*100\s*,\s*100/i],
  ]);
  for (const { brick, comp } of boxes) {
    const expected = dialogMessages.get(comp.data.Title);
    assert(expected, `known dialog title ${comp.data.Title}`);
    assert(expected.test(comp.data.Message), `${comp.data.Title} explains its accepted format`);
    const accepted = outgoing(scene, brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'OkClicked');
    assert.equal(accepted.length, 1, `${comp.data.Title} has one OK path`);
    assert.equal(outgoing(scene, brick, C.Exec_PlayerState_ShowTextInputBox.NAME, 'Declined').length, 0,
      `${comp.data.Title} cancel is a no-op`);
    assert(compOn(scene, accepted[0].z, C.Exec_PlayerState_GetFromEntity.NAME),
      `${comp.data.Title} rechecks the current sitter before applying`);
  }
  assert.deepEqual(new Set(boxes.map(({ comp }) => comp.data.Title)), new Set(dialogMessages.keys()));
  assert.equal(components(scene, C.Exec_PlayerState_GetFromEntity.NAME, innerGrid).length, 6,
    'every direct-entry dialog has open and confirmation sitter lookups');
  assert.equal(components(scene, C.Exec_PlayerState_ShowStatusMessage.NAME, innerGrid).length, 3,
    'each invalid entry mode reports an error');

  const splitStrings = components(scene, C.Expr_String_Split.NAME, innerGrid);
  assert(splitStrings.length >= 4, 'RGB and HSV triples are split into numeric fields');
  assert(splitStrings.every(({ comp }) => comp.data.Delimiter === ','),
    'direct RGB/HSV triples are comma-delimited');
  const parsers = [
    ...components(scene, C.Expr_String_ParseInt.NAME, innerGrid),
    ...components(scene, C.Expr_String_ParseNumber.NAME, innerGrid),
  ];
  assert.equal(parsers.length, 6, 'three RGB and three HSV numeric fields are parsed');
  assert(components(scene, C.Expr_CompareGreaterOrEqual.NAME, innerGrid).length >= 6,
    'six numeric inputs have lower-bound checks');
  assert(components(scene, C.Expr_CompareLessOrEqual.NAME, innerGrid).length >= 6,
    'six numeric inputs have upper-bound checks');

  // RGB display and editing are synchronized with the HSV values that already
  // drive the physical Color output. Editing RGB converts back to HSV, so a
  // later Hue/Saturation/Value adjustment cannot snap to stale state.
  const splitSrgb = components(scene, C.Expr_SplitColorSRGB.NAME, innerGrid);
  assert(splitSrgb.length >= 1, 'current color is split into live sRGB channels');
  const liveSplit = splitSrgb.find(({ brick }) => ['RED', 'GREEN', 'BLUE'].every((label, index) => {
    const valueEdge = incoming(scene, rows.get(label).brick, C.Expr_String_FormatText.NAME, 'InputB')[0];
    const roundBrick = scene.bricks.find(candidate => candidate.key === valueEdge?.a);
    const round = roundBrick?.comps.find(comp => comp.type === C.Expr_Round.NAME);
    if (!round) return false;
    const expectedPort = ['R', 'G', 'B'][index];
    return incoming(scene, roundBrick, C.Expr_Round.NAME, 'Input')
      .some(edge => edge.a === brick.key && edge.p === expectedPort);
  }));
  assert(liveSplit, 'all three RGB rows read one live SplitColorSRGB result');

  const makeSrgb = components(scene, C.Expr_MakeColorSRGB.NAME, innerGrid);
  assert(makeSrgb.length >= 1, 'RGB editing is assembled into an sRGB color');
  const toHsv = components(scene, C.Expr_ColorConvert.NAME, innerGrid)
    .filter(({ comp }) => comp.data.ToSpace === 3);
  assert(toHsv.length >= 2, 'Hex and RGB changes both synchronize back into HSV');
  assert(toHsv.some(({ brick }) => incoming(scene, brick, C.Expr_ColorConvert.NAME, 'Input')
    .some(edge => compOn(scene, edge.a, C.Expr_MakeColorSRGB.NAME))),
  'an RGB color conversion feeds authoritative HSV state');
  const convertedSplits = components(scene, C.Expr_SplitColor.NAME, innerGrid)
    .filter(({ brick }) => incoming(scene, brick, C.Expr_SplitColor.NAME, 'Input')
      .some(edge => toHsv.some(({ brick: converter }) => converter.key === edge.a)));
  assert(convertedSplits.length >= 2, 'Hex and RGB conversions are split into H/S/V values');

  const hexReadout = formats.find(({ comp }) => comp.data.FormatString.includes('CURRENT HEX'));
  assert(hexReadout, 'current Hex remains visible');
  assert.equal(incoming(scene, hexReadout.brick, C.Expr_String_FormatText.NAME, 'InputA').length, 1,
    'current Hex readout is wired');
  assert.equal(components(scene, C.Expr_ColorToHex.NAME, innerGrid).length, 1,
    'current color is converted back to Hex');

  const master = formats.find(({ comp }) =>
    comp.data.FormatString.includes('W/S SELECT')
      && /C\s+(?:ENTER\s+)?HEX/.test(comp.data.FormatString)
      && /Q\s+(?:ENTER\s+)?RGB/.test(comp.data.FormatString)
      && /E\s+(?:ENTER\s+)?HSV/.test(comp.data.FormatString));
  assert(master, 'master menu advertises row controls and all direct-entry shortcuts');

  const screen = components(scene, C.TextDisplay.NAME)
    .find(({ comp }) => /COLOR[ _]CUSTOMIZER/i.test(comp.data.Text));
  assert(screen, 'public CRT screen');
  for (const text of [
    'RED', 'GREEN', 'BLUE', 'HUE', 'SATURATION', 'VALUE',
    'MATERIAL', 'INTENSITY', 'CURRENT HEX',
  ]) assert(screen.comp.data.Text.includes(text), `screen includes ${text}`);
  assert(/C\s+(?:ENTER\s+)?HEX/.test(screen.comp.data.Text));
  assert(/Q\s+(?:ENTER\s+)?RGB/.test(screen.comp.data.Text));
  assert(/E\s+(?:ENTER\s+)?HSV/.test(screen.comp.data.Text));
  assert(!/APPLY|SPACE/i.test(screen.comp.data.Text), 'screen contains no dead Apply control');

  const ownerIndex = assertGearsharkOwnership(reader);
  assert(!scene.bricks.some(brick => brick.comps.some(comp => /Leaderboard/i.test(comp.type))),
    'public utility has no player-stat dependency');
  assert(!scene.bricks.some(brick => brick.comps.some(comp =>
    /(?:truck|car|vehicle)/i.test(JSON.stringify(comp.data)))),
  'public utility has no vehicle-specific configuration');

  return { scene, mainGrid, innerGrid, ownerIndex };
}

module.exports = test;

if (require.main === module) {
  const input = process.argv[2];
  assert(input, 'Usage: node test-color-customizer-rgb-hsv.cjs output.brz');
  const checked = test(input);
  console.log(JSON.stringify({
    ok: true,
    mainGrid: checked.mainGrid,
    innerGrid: checked.innerGrid,
    ownerIndex: checked.ownerIndex,
    bricks: checked.scene.bricks.length,
    wires: checked.scene.edges.length,
  }, null, 2));
}
