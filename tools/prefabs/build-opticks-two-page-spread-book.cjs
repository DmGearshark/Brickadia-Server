'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');

const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  button: 'Component_Button',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  logicalOr: 'BrickComponentType_Expr_LogicalOR',
  text: 'Component_TextDisplay',
};

const DATA_FILE = path.join(__dirname, 'opticks-four-display-pages-v27-live-geometry.json');
const LOGIC_DONOR = path.join(__dirname, '../../prefabs/newton-opticks-pure-braille-v27-live-geometry.brz');
const PAGE_KEYS = ['textPages', 'imagePagesA', 'imagePagesB', 'imagePagesC', 'imagePagesD'];

// The new leaf is about 1.6 times wider than the live-tested single-page
// parchment. Scaling LineHeight by that ratio keeps the v27 aspect correction
// and fills the larger page while preserving every calibrated WidthScale.
// It also matches the shell's own guide: 50 source rows at 0.8 occupy the same
// height as its 27-row, 1.5-LineHeight calibration text.
const DISPLAY_SCALE = 1.6;

const components = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({ brick, component, type })));

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function componentBrick(scene, type) {
  const bricks = scene.bricks.filter(brick => brick.comps.some(component => component.type === type));
  assert(bricks.length > 0, `Missing ${type} template brick`);
  return bricks[0];
}

function splitSpreads(pages) {
  const left = [];
  const right = [];
  for (let index = 0; index < pages.length; index += 2) {
    left.push(pages[index]);
    right.push(pages[index + 1] ?? '');
  }
  return { left, right };
}

function validateData(data) {
  assert(Array.isArray(data.textPages) && data.textPages.length > 1,
    'Opticks data must contain at least two pages');
  for (const key of PAGE_KEYS) {
    assert(Array.isArray(data[key]), `Missing ${key}`);
    assert.equal(data[key].length, data.textPages.length, `${key} page count`);
    for (const [index, value] of data[key].entries()) {
      assert.equal(typeof value, 'string', `${key}[${index}] must be a string`);
      assert(Buffer.byteLength(value, 'utf8') < 32767,
        `${key}[${index}] exceeds Brickadia's string limit`);
    }
  }
  assert.equal(data.layout?.imageFont, 'IosevkaTerm');
  assert.equal(data.layout?.imageArrayCount, 4);
}

function build(input, dataFile = DATA_FILE) {
  const donorBytes = fs.readFileSync(input);
  const scene = read(donorBytes);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const logicDonor = read(fs.readFileSync(LOGIC_DONOR));
  validateData(data);

  assert.equal(scene.edges.length, 0, 'The two-page shell must start unwired');
  assert.equal(components(scene, TYPES.cycle).length, 0, 'The shell already contains page logic');
  const chipLink = one(scene.links, 'microchip link');
  const logicGrid = chipLink.grid;
  assert(!scene.bricks.some(brick => brick.g === logicGrid),
    'The shell microchip is not blank');

  const displays = components(scene, TYPES.text);
  assert.equal(displays.length, 12, 'Expected six displays on each physical page');
  const buttons = components(scene, TYPES.button);
  assert.equal(buttons.length, 2, 'Expected the shell page-turn buttons');
  const leftButton = one(buttons.filter(item => /right/i.test(item.component.data.PromptCustomLabel || '')),
    'Turn page Right button');
  const rightButton = one(buttons.filter(item => /left/i.test(item.component.data.PromptCustomLabel || '')),
    'Turn page Left button');

  const externalAssets = structuredClone(scene.r.externalAssets());
  function externalAsset(type, name) {
    let index = externalAssets.findIndex(asset => asset.type === type && asset.name === name);
    if (index < 0) {
      index = externalAssets.length;
      externalAssets.push({ type, name });
    }
    return index;
  }
  const proseFont = externalAsset('BrickFontDescriptor', 'RobotoMono');
  const imageFont = externalAsset('BrickFontDescriptor', data.layout.imageFont);

  const templateCycle = componentBrick(logicDonor, TYPES.cycle);
  const templateArray = componentBrick(logicDonor, TYPES.array);
  const templateGet = componentBrick(logicDonor, TYPES.get);
  const templateOr = componentBrick(logicDonor, TYPES.logicalOr);
  let nextLogicIndex = 0;
  function addLogic(template, componentType, position, componentData, role) {
    const brick = structuredClone(template);
    brick.key = `opticks:spread:${role}`;
    brick.g = logicGrid;
    brick.data.position = position;
    const component = one(brick.comps.filter(item => item.type === componentType),
      `${role} component`);
    component.data = componentData;
    // Keep deterministic keys even if a role name changes punctuation later.
    brick.key = JSON.stringify([logicGrid, -1, -1, -1, nextLogicIndex]);
    nextLogicIndex += 1;
    scene.bricks.push(brick);
    return { brick, component, type: componentType, role };
  }

  const spreadCount = Math.ceil(data.textPages.length / 2);
  const cycle = addLogic(templateCycle, TYPES.cycle, [0, 20, 2], {
    Count: spreadCount,
    Value: spreadCount - 1,
  }, 'cycle');
  const refresh = addLogic(templateOr, TYPES.logicalOr, [0, -20, 2], {
    bInputA: false,
    bInputB: false,
  }, 'refresh');

  const sideState = {};
  for (const [sideIndex, side] of ['left', 'right'].entries()) {
    const hostX = side === 'left' ? -20 : 20;
    const sideDisplays = displays.filter(item => item.brick.data.position[0] === hostX);
    assert.equal(sideDisplays.length, 6, `${side} page display count`);
    const background = one(sideDisplays.filter(item => item.component.data.Text === '■'),
      `${side} background display`);
    const prose = one(sideDisplays.filter(item => /page limit/i.test(item.component.data.Text || '')),
      `${side} prose display`);
    const imageDisplays = sideDisplays
      .filter(item => /^This is brail \d$/i.test(item.component.data.Text || ''))
      .sort((a, b) => b.brick.data.position[2] - a.brick.data.position[2]);
    assert.equal(imageDisplays.length, 4, `${side} image display count`);

    background.component.data.bEnabled = true;
    prose.component.data.Text = data.textPages[sideIndex] ?? '';
    prose.component.data.Font = proseFont;
    prose.component.data.WidthScale = data.layout.textWidthScale;
    prose.component.data.LineHeight = data.layout.textLineHeight * DISPLAY_SCALE;
    prose.component.data.OutlineWidth = 2;
    prose.component.data.Offset.Y = -3;
    prose.component.data.Offset.Z = 1;

    const arrays = [];
    const getters = [];
    for (const [pageKeyIndex, pageKey] of PAGE_KEYS.entries()) {
      const spread = splitSpreads(data[pageKey]);
      const pages = spread[side];
      assert.equal(pages.length, spreadCount, `${side} ${pageKey} spread count`);
      const logicY = 20 - pageKeyIndex * 10;
      const logicX = side === 'left' ? -20 : 20;
      const array = addLogic(templateArray, TYPES.array, [logicX, logicY, 2], {
        Value: { $elementType: 'str', $array: pages.slice().reverse() },
      }, `${side}-${pageKey}-array`);
      const getter = addLogic(templateGet, TYPES.get,
        [logicX + (side === 'left' ? 10 : -10), logicY, 2], {
        Index: spreadCount - 1,
        Value: { $variant: 'str', value: pages[0] },
        bOutOfBounds: false,
      }, `${side}-${pageKey}-get`);
      arrays.push(array);
      getters.push(getter);
    }

    const imageOffsetTarget = prose.brick.data.position[2] + prose.component.data.Offset.Y;
    for (const [index, display] of imageDisplays.entries()) {
      display.component.data.Text = data[PAGE_KEYS[index + 1]][sideIndex] ?? '';
      display.component.data.Font = imageFont;
      display.component.data.WidthScale = data.layout.imageWidthScale;
      display.component.data.LineHeight = data.layout.imageLineHeight * DISPLAY_SCALE;
      display.component.data.LineOffset = -5.5;
      display.component.data.Kerning = data.layout.imageKerning;
      display.component.data.Skew = 0;
      display.component.data.OutlineWidth = data.layout.imageOutlineWidth;
      display.component.data.Offset.Y = imageOffsetTarget - display.brick.data.position[2];
      display.component.data.Offset.Z = 1;
    }
    sideState[side] = { prose, imageDisplays, arrays, getters };
  }

  function wire(source, output, target, input) {
    scene.edges.push({
      a: source.brick.key,
      at: source.type,
      p: output,
      z: target.brick.key,
      zt: target.type,
      q: input,
    });
  }

  // The outer-left control turns its page right to the previous spread. The
  // outer-right control turns its page left to the next spread, matching the
  // shell's existing interaction labels and the proven single-page cycle.
  wire(leftButton, 'bHeld', cycle, 'Exec');
  wire(rightButton, 'bHeld', cycle, 'ExecDown');
  wire(leftButton, 'bHeld', refresh, 'bInputA');
  wire(rightButton, 'bHeld', refresh, 'bInputB');

  for (const side of ['left', 'right']) {
    const state = sideState[side];
    const boundDisplays = [state.prose, ...state.imageDisplays];
    for (let index = 0; index < PAGE_KEYS.length; index += 1) {
      wire(state.arrays[index], 'ArrayVarRef', state.getters[index], 'ArrayVarRef');
      wire(cycle, 'Output', state.getters[index], 'Index');
      wire(refresh, 'bOutput', state.getters[index], 'Exec');
      wire(state.getters[index], 'Value', boundDisplays[index], 'Text');
    }
  }

  const name = 'Newton Opticks - Large Two-Page Live Geometry Edition';
  const description = 'Complete Isaac Newton Opticks text and source-derived live-geometry Braille figures in a large synchronized two-page spread. Each page turn advances two source pages.';
  const generated = write(scene, { assets: externalAssets, name, description }).bytes;
  return {
    bytes: repack(generated, donorBytes, { name, description }),
    data,
    spreadCount,
  };
}

module.exports = build;
module.exports.PAGE_KEYS = PAGE_KEYS;
module.exports.DISPLAY_SCALE = DISPLAY_SCALE;
module.exports.splitSpreads = splitSpreads;

if (require.main === module) {
  const [input, output, dataFile] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error('Usage: node build-opticks-two-page-spread-book.cjs shell.brz output.brz [pages.json]');
  }
  const result = build(input, dataFile);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    bytes: result.bytes.length,
    sourcePages: result.data.textPages.length,
    spreads: result.spreadCount,
    displays: 10,
  }, null, 2));
}
