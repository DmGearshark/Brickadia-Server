'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');

const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  text: 'Component_TextDisplay',
};

// The existing A/B paths keep their donor wiring. C/D use the two unused
// backing bricks immediately behind them. Offset.Y compensates for each
// brick's Z position so all four displays occupy the same plane.
const IMAGE_BANDS = [
  { name: 'A', pagesKey: 'imagePagesA', logicY: -55, displayZ: 10967, displayOffsetY: 20.5 },
  { name: 'B', pagesKey: 'imagePagesB', logicY: -35, displayZ: 10969, displayOffsetY: 18.5 },
  { name: 'C', pagesKey: 'imagePagesC', logicY: -75, displayZ: 10963, displayOffsetY: 24.5 },
  { name: 'D', pagesKey: 'imagePagesD', logicY: -95, displayZ: 10965, displayOffsetY: 22.5 },
];

const components = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({ brick, component })));

function only(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function atLogicY(items, y, description) {
  return only(items.filter(item => item.brick.data.position[1] === y), description);
}

function cloneLogicBrick(template, key, y) {
  const clone = structuredClone(template);
  clone.key = key;
  clone.data.position[1] = y;
  return clone;
}

function assertPages(data) {
  assert(Array.isArray(data.textPages) && data.textPages.length > 0, 'textPages must be non-empty');
  assert(Array.isArray(data.imagePages), 'imagePages must contain the unsplit pure-Braille pages');
  for (const band of IMAGE_BANDS) {
    const pages = data[band.pagesKey];
    assert(Array.isArray(pages), `${band.pagesKey} must be an array`);
    assert.equal(pages.length, data.textPages.length, `${band.pagesKey} page count`);
    for (const [index, page] of pages.entries()) {
      assert.equal(typeof page, 'string', `${band.pagesKey}[${index}] must be a string`);
      assert(Buffer.byteLength(page, 'utf8') < 32767,
        `${band.pagesKey}[${index}] exceeds Brickadia's string limit`);
      assert(/^[\u2800-\u28ff \r\n]*$/u.test(page),
        `${band.pagesKey}[${index}] contains a non-Braille image glyph`);
    }
  }
  assert.equal(data.imagePages.length, data.textPages.length, 'imagePages page count');
  for (const [index, page] of data.textPages.entries()) {
    assert.equal(typeof page, 'string', `textPages[${index}] must be a string`);
    assert(Buffer.byteLength(page, 'utf8') < 32767,
      `textPages[${index}] exceeds Brickadia's string limit`);
  }
  assert.equal(data.layout?.imageLineHeight, 0.075,
    'Four-display data must use the calibrated 0.075 image line height');
  assert.equal(data.layout?.imageWidthScale, 1.2,
    'Four-display data must use the native Braille font width calibration');
  assert.equal(data.layout?.imageOutlineWidth, 4,
    'Four-display data must retain the donor image outline weight');
  assert.equal(data.layout?.imageFont, 'IosevkaTerm',
    'Four-display data must use a font with native fixed-advance Braille');
  assert.equal(data.layout?.imageKerning, -6,
    'Four-display data must retain the calibrated image kerning');
}

function build(input, dataFile = path.join(__dirname, 'opticks-four-display-pages.json')) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assertPages(data);

  const arrays = components(scene, TYPES.array);
  const getters = components(scene, TYPES.get);
  const imageArrayA = atLogicY(arrays, -55, 'image array A');
  const imageArrayB = atLogicY(arrays, -35, 'image array B');
  const textArray = atLogicY(arrays, -15, 'text array');
  const imageGetA = atLogicY(getters, -55, 'image getter A');
  const imageGetB = atLogicY(getters, -35, 'image getter B');
  const textGet = atLogicY(getters, -15, 'text getter');
  assert.equal(arrays.filter(item => [-75, -95].includes(item.brick.data.position[1])).length, 0,
    'Donor already contains the new image arrays');
  assert.equal(getters.filter(item => [-75, -95].includes(item.brick.data.position[1])).length, 0,
    'Donor already contains the new image getters');

  const newArrayCBrick = cloneLogicBrick(imageArrayA.brick, 'opticks:image-array-c', -75);
  const newArrayDBrick = cloneLogicBrick(imageArrayB.brick, 'opticks:image-array-d', -95);
  const newGetCBrick = cloneLogicBrick(imageGetA.brick, 'opticks:image-get-c', -75);
  const newGetDBrick = cloneLogicBrick(imageGetB.brick, 'opticks:image-get-d', -95);
  scene.bricks.push(newArrayCBrick, newArrayDBrick, newGetCBrick, newGetDBrick);

  const imageArrayC = only(newArrayCBrick.comps.filter(component => component.type === TYPES.array),
    'new image array C component');
  const imageArrayD = only(newArrayDBrick.comps.filter(component => component.type === TYPES.array),
    'new image array D component');
  const imageGetC = only(newGetCBrick.comps.filter(component => component.type === TYPES.get),
    'new image getter C component');
  const imageGetD = only(newGetDBrick.comps.filter(component => component.type === TYPES.get),
    'new image getter D component');

  const donorImageDisplays = components(scene, TYPES.text)
    .filter(item => item.component.data.Face === 3);
  assert.equal(donorImageDisplays.length, 2,
    `Expected two donor image displays, found ${donorImageDisplays.length}`);
  const displayTemplate = donorImageDisplays[0].component;
  for (const band of IMAGE_BANDS.filter(item => item.name === 'C' || item.name === 'D')) {
    const backing = only(scene.bricks.filter(brick => brick.g === 1
      && brick.data.position[0] === 5883
      && brick.data.position[1] === -74872
      && brick.data.position[2] === band.displayZ), `image ${band.name} backing brick`);
    assert.equal(backing.comps.filter(component => component.type === TYPES.text).length, 0,
      `Image ${band.name} backing brick already has a TextDisplay`);
    backing.comps.push({ type: TYPES.text, data: structuredClone(displayTemplate.data) });
  }

  const imageDisplays = components(scene, TYPES.text).filter(item => item.component.data.Face === 3);
  assert.equal(imageDisplays.length, 4, `Expected four image displays, found ${imageDisplays.length}`);
  const textDisplay = only(components(scene, TYPES.text).filter(item => item.component.data.Face === 0
    && String(item.component.data.Text || '').length > 100), 'text display').component;
  const cycle = only(components(scene, TYPES.cycle), 'cycle').component;

  const bandParts = new Map([
    ['A', { array: imageArrayA.component, getter: imageGetA.component }],
    ['B', { array: imageArrayB.component, getter: imageGetB.component }],
    ['C', { array: imageArrayC, getter: imageGetC }],
    ['D', { array: imageArrayD, getter: imageGetD }],
  ]);
  const pageCount = data.textPages.length;
  for (const band of IMAGE_BANDS) {
    const pages = data[band.pagesKey];
    const parts = bandParts.get(band.name);
    parts.array.data.Value.$array = pages.slice().reverse();
    parts.getter.data.Index = pageCount - 1;
    parts.getter.data.Value = { $variant: 'str', value: pages[0] };
    parts.getter.data.bOutOfBounds = false;

    const display = only(imageDisplays.filter(item => item.brick.data.position[2] === band.displayZ),
      `image display ${band.name}`).component;
    display.data.Text = pages[0];
    display.data.WidthScale = data.layout.imageWidthScale;
    display.data.LineHeight = 0.075;
    display.data.LineOffset = -5.5;
    display.data.Kerning = data.layout.imageKerning;
    display.data.Skew = 0;
    display.data.OutlineWidth = data.layout.imageOutlineWidth;
    display.data.Offset.X = -12;
    display.data.Offset.Y = band.displayOffsetY;
    display.data.Offset.Z = 9.5;
  }

  textArray.component.data.Value.$array = data.textPages.slice().reverse();
  textGet.component.data.Index = pageCount - 1;
  textGet.component.data.Value = { $variant: 'str', value: data.textPages[0] };
  textGet.component.data.bOutOfBounds = false;
  cycle.data.Count = pageCount;
  cycle.data.Value = pageCount - 1;
  textDisplay.data.Text = data.textPages[0];
  textDisplay.data.WidthScale = data.layout.textWidthScale ?? textDisplay.data.WidthScale;
  textDisplay.data.LineHeight = data.layout.textLineHeight ?? textDisplay.data.LineHeight;

  const getAKey = imageGetA.brick.key;
  const arrayToGet = only(scene.edges.filter(edge => edge.z === getAKey
    && edge.zt === TYPES.get && edge.q === 'ArrayVarRef'), 'array A to getter A wire');
  const cycleToGet = only(scene.edges.filter(edge => edge.z === getAKey
    && edge.zt === TYPES.get && edge.q === 'Index'), 'cycle to getter A wire');
  const refreshToGet = only(scene.edges.filter(edge => edge.z === getAKey
    && edge.zt === TYPES.get && edge.q === 'Exec'), 'refresh to getter A wire');
  const getToDisplay = only(scene.edges.filter(edge => edge.a === getAKey
    && edge.at === TYPES.get && edge.p === 'Value'
    && edge.zt === TYPES.text && edge.q === 'Text'), 'getter A to image display A wire');
  for (const { arrayBrick, getBrick, displayZ } of [
    { arrayBrick: newArrayCBrick, getBrick: newGetCBrick, displayZ: 10963 },
    { arrayBrick: newArrayDBrick, getBrick: newGetDBrick, displayZ: 10965 },
  ]) {
    const display = only(imageDisplays.filter(item => item.brick.data.position[2] === displayZ),
      `new image display at Z ${displayZ}`);
    scene.edges.push(
      { ...arrayToGet, a: arrayBrick.key, z: getBrick.key },
      { ...cycleToGet, z: getBrick.key },
      { ...refreshToGet, z: getBrick.key },
      { ...getToDisplay, a: getBrick.key, z: display.brick.key },
    );
  }

  const assets = structuredClone(scene.r.externalAssets());
  let imageFont = assets.findIndex(asset => asset.type === 'BrickFontDescriptor'
    && asset.name === data.layout.imageFont);
  if (imageFont < 0) {
    imageFont = assets.length;
    assets.push({ type: 'BrickFontDescriptor', name: data.layout.imageFont });
  }
  let mono = assets.findIndex(asset => asset.type === 'BrickFontDescriptor' && asset.name === 'RobotoMono');
  if (mono < 0) {
    mono = assets.length;
    assets.push({ type: 'BrickFontDescriptor', name: 'RobotoMono' });
  }
  for (const item of imageDisplays) item.component.data.Font = imageFont;
  textDisplay.data.Font = mono;

  const name = 'Newton Opticks - Native Braille Detail Edition';
  const description = 'Complete Opticks text with aligned native-font source-derived Unicode Braille figures, plus an enlarged Figure 3 center detail, distributed across four synchronized image arrays.';
  const generated = write(scene, { assets, name, description }).bytes;
  return {
    bytes: repack(generated, donor, { name, description, preserveThumbnail: false }),
    data,
  };
}

module.exports = build;
module.exports.IMAGE_BANDS = IMAGE_BANDS;

if (require.main === module) {
  const [input, output, dataFile] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error('Usage: node build-opticks-four-display-book.cjs donor.brz output.brz [pages.json]');
  }
  const result = build(input, dataFile);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    bytes: result.bytes.length,
    pages: result.data.textPages.length,
    figures: result.data.placements?.length ?? 0,
    detailViews: result.data.detailViews?.length ?? 0,
    imageDisplays: IMAGE_BANDS.length,
    pagesWithImages: result.data.imagePages.filter(Boolean).length,
  }, null, 2));
}
