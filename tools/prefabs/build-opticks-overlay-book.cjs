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
  const { textPages, imagePages } = data;
  assert.equal(textPages.length, imagePages.length);
  assert.equal(data.placements.length, 57);

  const arrays = components(scene, TYPES.array);
  const getters = components(scene, TYPES.get);
  const imageArray = only(arrays.filter(item => item.brick.data.position[1] === -35), 'image array').component;
  const textArray = only(arrays.filter(item => item.brick.data.position[1] === -15), 'text array').component;
  const imageGet = only(getters.filter(item => item.brick.data.position[1] === -35), 'image getter').component;
  const textGet = only(getters.filter(item => item.brick.data.position[1] === -15), 'text getter').component;
  const cycle = only(components(scene, TYPES.cycle), 'cycle').component;
  const displays = components(scene, TYPES.text);
  const imageDisplay = only(displays.filter(item => item.component.data.Text === 'Images on these arrays.'), 'image display').component;
  const textDisplay = only(displays.filter(item => /^275\r\n/.test(item.component.data.Text || '')), 'text display').component;

  imageArray.data.Value.$array = imagePages.slice().reverse();
  textArray.data.Value.$array = textPages.slice().reverse();
  cycle.data.Count = textPages.length;
  cycle.data.Value = textPages.length - 1;
  for (const [getter, value] of [[imageGet, imagePages[0]], [textGet, textPages[0]]]) {
    getter.data.Index = textPages.length - 1;
    getter.data.Value = { $variant: 'str', value };
    getter.data.bOutOfBounds = false;
  }
  imageDisplay.data.Text = imagePages[0];
  textDisplay.data.Text = textPages[0];
  imageDisplay.data.WidthScale = data.layout.imageWidthScale;
  imageDisplay.data.LineHeight = data.layout.imageLineHeight;

  const assets = structuredClone(scene.r.externalAssets());
  let mono = assets.findIndex(asset => asset.type === 'BrickFontDescriptor' && asset.name === 'RobotoMono');
  if (mono < 0) {
    mono = assets.length;
    assets.push({ type: 'BrickFontDescriptor', name: 'RobotoMono' });
  }
  imageDisplay.data.Font = mono;
  textDisplay.data.Font = mono;

  const name = 'Newton Opticks - Braille Overlay Edition';
  const description = 'Complete Opticks text with contrast-normalized Braille figures overlaid into deliberately blank regions of the prose pages.';
  const generated = write(scene, { assets, name, description }).bytes;
  return { bytes: repack(generated, donor, { name, description }), data };
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
    mixedPages: result.data.imagePages.filter(Boolean).length,
  }, null, 2));
}
