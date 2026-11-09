'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const [prefabPath, dataPath = `${__dirname}/standalone-character-braille-page.json`] = process.argv.slice(2);
if (!prefabPath) throw new Error('Usage: node test-standalone-character-braille-page.cjs page.brz [data.json]');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const bytes = fs.readFileSync(prefabPath);
const scene = read(bytes);
const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  text: 'Component_TextDisplay',
};
const components = type => scene.bricks.flatMap(brick => brick.comps
  .filter(component => component.type === type)
  .map(component => ({ brick, component })));

assert.equal(data.textPages.length, 1);
assert.equal(components(TYPES.array).length, 5);
assert.equal(components(TYPES.get).length, 5);
assert.equal(components(TYPES.cycle).length, 1);
assert.equal(components(TYPES.cycle)[0].component.data.Count, 1);
assert.equal(components(TYPES.cycle)[0].component.data.Value, 0);
const imageDisplays = components(TYPES.text).filter(item => item.component.data.Face === 3);
assert.equal(imageDisplays.length, 4);
assert(imageDisplays.every(item => item.component.data.LineHeight === 0.07500000298023224));
assert(imageDisplays.every(item => item.component.data.OutlineWidth === 4));
const assets = scene.r.externalAssets();
const imageFont = assets.findIndex(asset => asset.type === 'BrickFontDescriptor'
  && asset.name === 'IosevkaTerm');
assert(imageFont >= 0);
assert(imageDisplays.every(item => item.component.data.Font === imageFont));
const placement = validatePlacement(bytes);
assert(placement.strictOk, JSON.stringify(placement));
console.log(JSON.stringify({
  bytes: bytes.length,
  pages: data.textPages.length,
  imageDisplays: imageDisplays.length,
  portrait: data.portrait,
  maxBandBytes: Math.max(...data.imageBandBytes[0]),
  strictPlacement: placement.strictOk,
}, null, 2));
