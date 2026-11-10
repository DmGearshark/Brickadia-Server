'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const [outputPath, dataPath] = process.argv.slice(2);
if (!outputPath || !dataPath) {
  throw new Error('Usage: node test-newton-four-display-book.cjs output.brz pages.json');
}

const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  text: 'Component_TextDisplay',
};
const BAND_SPECS = [
  { y: -55, key: 'imagePagesA', z: 10967 },
  { y: -35, key: 'imagePagesB', z: 10969 },
  { y: -75, key: 'imagePagesC', z: 10963 },
  { y: -95, key: 'imagePagesD', z: 10965 },
];

const bytes = fs.readFileSync(outputPath);
const scene = read(bytes);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function components(type) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({ brick, component })));
}

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function approx(actual, expected, description) {
  assert(Math.abs(actual - expected) < 1e-5, `${description}: ${actual} != ${expected}`);
}

const pageCount = data.textPages.length;
const arrays = components(TYPES.array);
const getters = components(TYPES.get);
const displays = components(TYPES.text);
const cycle = one(components(TYPES.cycle), 'page cycle').component;
assert.equal(cycle.data.Count, pageCount);
assert.equal(cycle.data.Value, pageCount - 1);

const imageDisplays = displays.filter(item => item.component.data.Face === 3);
assert.equal(imageDisplays.length, 4);
for (const spec of BAND_SPECS) {
  const array = one(arrays.filter(item => item.brick.data.position[1] === spec.y), `${spec.key} array`).component;
  const getter = one(getters.filter(item => item.brick.data.position[1] === spec.y), `${spec.key} getter`).component;
  const display = one(imageDisplays.filter(item => item.brick.data.position[2] === spec.z), `${spec.key} display`).component;
  const pages = data[spec.key];
  assert.deepEqual(array.data.Value.$array, pages.slice().reverse());
  assert.equal(getter.data.Index, pageCount - 1);
  assert.equal(getter.data.Value.value, pages[0]);
  assert.equal(display.data.Text, pages[0]);
  approx(display.data.WidthScale, data.layout.imageWidthScale, `${spec.key} width scale`);
  approx(display.data.LineHeight, data.layout.imageLineHeight, `${spec.key} line height`);
  assert.equal(display.data.Kerning, data.layout.imageKerning);
  approx(display.data.OutlineWidth, data.layout.imageOutlineWidth, `${spec.key} outline width`);
}

const textArray = one(arrays.filter(item => item.brick.data.position[1] === -15), 'text array').component;
const textGetter = one(getters.filter(item => item.brick.data.position[1] === -15), 'text getter').component;
assert.deepEqual(textArray.data.Value.$array, data.textPages.slice().reverse());
assert.equal(textGetter.data.Index, pageCount - 1);
assert.equal(textGetter.data.Value.value, data.textPages[0]);
const proseDisplay = one(displays.filter(item => item.component.data.Face === 0
  && item.component.data.Text === data.textPages[0]), 'prose display').component;
approx(proseDisplay.data.LineHeight, data.layout.textLineHeight, 'prose line height');
approx(proseDisplay.data.WidthScale, data.layout.textWidthScale, 'prose width scale');

const assets = scene.r.externalAssets();
assert(assets.some(asset => asset.type === 'BrickFontDescriptor'
  && asset.name === data.layout.imageFont));
assert(assets.some(asset => asset.type === 'BrickFontDescriptor' && asset.name === 'RobotoMono'));

const placement = validatePlacement(bytes);
assert(placement.strictOk, JSON.stringify(placement));
console.log(JSON.stringify({
  output: outputPath,
  bytes: bytes.length,
  pages: pageCount,
  figures: data.placements.length,
  detailViews: data.detailViews.length,
  imageDisplays: imageDisplays.length,
  maxBandBytes: Math.max(...data.imageBandBytes.flat()),
  strictPlacement: placement.strictOk,
}, null, 2));
