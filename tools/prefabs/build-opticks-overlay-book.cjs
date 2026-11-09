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

const components = (scene, type) => scene.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({ brick, component })));

function only(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function build(input, dataFile = path.join(__dirname, 'opticks-overlay-pages.json')) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const { textPages, imagePagesA, imagePagesB } = data;
  assert.equal(textPages.length, imagePagesA.length);
  assert.equal(textPages.length, imagePagesB.length);
  assert.equal(data.placements.length, 57);

  const arrays = components(scene, TYPES.array);
  const getters = components(scene, TYPES.get);
  const imageArrayA = only(arrays.filter(item => item.brick.data.position[1] === -55), 'image array A').component;
  const imageArrayB = only(arrays.filter(item => item.brick.data.position[1] === -35), 'image array B').component;
  const textArray = only(arrays.filter(item => item.brick.data.position[1] === -15), 'text array').component;
  const imageGetA = only(getters.filter(item => item.brick.data.position[1] === -55), 'image getter A').component;
  const imageGetB = only(getters.filter(item => item.brick.data.position[1] === -35), 'image getter B').component;
  const textGet = only(getters.filter(item => item.brick.data.position[1] === -15), 'text getter').component;
  const cycle = only(components(scene, TYPES.cycle), 'cycle').component;
  const displays = components(scene, TYPES.text);
  const contentDisplays = displays.filter(item => item.component.data.Face === 0 || item.component.data.Face === 3);
  const imageDisplays = contentDisplays.filter(item => item.component.data.Face === 3)
    .sort((a, b) => a.brick.data.position[2] - b.brick.data.position[2]);
  assert.equal(imageDisplays.length, 2, `Expected two image displays, found ${imageDisplays.length}`);
  const textDisplay = only(contentDisplays.filter(item => item.component.data.Face === 0
    && String(item.component.data.Text || '').length > 100), 'text display').component;

  imageArrayA.data.Value.$array = imagePagesA.slice().reverse();
  imageArrayB.data.Value.$array = imagePagesB.slice().reverse();
  textArray.data.Value.$array = textPages.slice().reverse();
  cycle.data.Count = textPages.length;
  cycle.data.Value = textPages.length - 1;
  for (const [getter, value] of [[imageGetA, imagePagesA[0]], [imageGetB, imagePagesB[0]], [textGet, textPages[0]]]) {
    getter.data.Index = textPages.length - 1;
    getter.data.Value = { $variant: 'str', value };
    getter.data.bOutOfBounds = false;
  }
  textDisplay.data.Text = textPages[0];
  for (const [index, item] of imageDisplays.entries()) {
    item.component.data.Text = (index === 0 ? imagePagesA : imagePagesB)[0];
    item.component.data.WidthScale = 1;
    item.component.data.LineOffset = -5.5;
    item.component.data.Kerning = -6;
    item.component.data.Skew = 0;
  }
  textDisplay.data.WidthScale = data.layout.textWidthScale;
  textDisplay.data.LineHeight = data.layout.textLineHeight;

  const assets = structuredClone(scene.r.externalAssets());
  let mono = assets.findIndex(asset => asset.type === 'BrickFontDescriptor' && asset.name === 'RobotoMono');
  if (mono < 0) {
    mono = assets.length;
    assets.push({ type: 'BrickFontDescriptor', name: 'RobotoMono' });
  }
  for (const item of imageDisplays) item.component.data.Font = mono;
  textDisplay.data.Font = mono;

  const quadrant = data.layout.cellMode === 'quadrant';
  const hybrid = data.layout.glyphMode === 'hybrid';
  const name = quadrant ? 'Newton Opticks - Square Pixel Overlay Edition'
    : hybrid ? 'Newton Opticks - Hybrid Line Overlay Edition'
      : 'Newton Opticks - Refined Braille Overlay Edition';
  const description = quadrant
    ? 'Complete Opticks text with high-resolution Unicode quadrant-block figures split across two synchronized image arrays.'
    : hybrid
      ? 'Complete Opticks text with refined Braille figures and conservative Unicode line glyphs split across two synchronized image arrays.'
      : 'Complete Opticks text with refined, label-cleaned Braille figures split across two synchronized image arrays.';
  const generated = write(scene, { assets, name, description }).bytes;
  // The edited donor contains a 637 KB screenshot thumbnail. Omitting that
  // preview keeps the prefab well below the size that previously failed to
  // place, without changing any brick, display or circuit data.
  return { bytes: repack(generated, donor, { name, description, preserveThumbnail: false }), data };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-opticks-overlay-book.cjs donor.brz output.brz');
  const result = build(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    bytes: result.bytes.length,
    pages: result.data.textPages.length,
    figures: result.data.placements.length,
    mixedPages: result.data.imagePagesA.filter((page, index) => page || result.data.imagePagesB[index]).length,
  }, null, 2));
}
