'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const [donorPath, outputPath, dataPath = `${__dirname}/opticks-overlay-pages.json`] = process.argv.slice(2);
if (!donorPath || !outputPath) throw new Error('Usage: node test-opticks-overlay-book.cjs donor.brz output.brz [pages.json]');
const donor = read(fs.readFileSync(donorPath));
const outputBytes = fs.readFileSync(outputPath);
const output = read(outputBytes);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function components(scene, type) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({ brick, component })));
}
function one(items, name) {
  assert.equal(items.length, 1, `Expected one ${name}, found ${items.length}`);
  return items[0];
}
function display(scene, face) {
  return one(components(scene, 'Component_TextDisplay').filter(item =>
    item.component.data.Face === face && (face === 3 || String(item.component.data.Text || '').length > 100)), `Face ${face} page display`);
}

const donorText = display(donor, 0);
const text = display(output, 0);
const donorImages = components(donor, 'Component_TextDisplay').filter(item => item.component.data.Face === 3)
  .sort((a, b) => a.brick.data.position[2] - b.brick.data.position[2]);
const images = components(output, 'Component_TextDisplay').filter(item => item.component.data.Face === 3)
  .sort((a, b) => a.brick.data.position[2] - b.brick.data.position[2]);
assert.equal(donorImages.length, 2);
assert.equal(images.length, 2);
for (const [before, after] of [[donorText, text], ...donorImages.map((item, index) => [item, images[index]])]) {
  assert.deepEqual(after.brick.data.position, before.brick.data.position);
  for (const key of ['Rotation', 'Skew', 'Kerning', 'LineOffset', 'Anchor', 'Face', 'Typeface']) {
    assert.deepEqual(after.component.data[key], before.component.data[key], `${key} changed`);
  }
  if (after.component.data.Face === 0) assert.equal(after.component.data.Offset.Y, before.component.data.Offset.Y);
  assert.equal(after.component.data.Offset.Z, before.component.data.Offset.Z);
}
for (const image of images) {
  assert.equal(image.component.data.WidthScale, 0.30000001192092896);
  assert.equal(image.component.data.LineHeight, 0.15000000596046448);
  assert.equal(image.component.data.Offset.X, text.component.data.Offset.X);
  assert.equal(image.component.data.Offset.Y, 20.5);
}
assert.equal(text.component.data.WidthScale, donorText.component.data.WidthScale);
assert.equal(text.component.data.LineHeight, donorText.component.data.LineHeight);
assert.equal(data.textPages.length, data.imagePagesA.length);
assert.equal(data.textPages.length, data.imagePagesB.length);
assert.equal(data.placements.length, 57);
assert(data.placements.every(item => item.columns <= 200 && item.rows <= 130));
assert(data.placements.find(item => item.source.endsWith('fig11-2.jpg')).labels.length >= 23);
for (const page of [...data.textPages, ...data.imagePagesA, ...data.imagePagesB]) assert(Buffer.byteLength(page, 'utf8') < 32767);

const arrays = components(output, 'BrickComponentType_ArrayVar');
for (const pages of [data.imagePagesA, data.imagePagesB, data.textPages]) {
  assert(arrays.some(item => JSON.stringify(item.component.data.Value.$array.slice().reverse()) === JSON.stringify(pages)));
}
const placement = validatePlacement(outputBytes);
assert(placement.strictOk, JSON.stringify(placement));
console.log(JSON.stringify({
  bytes: outputBytes.length,
  pages: data.textPages.length,
  figures: data.placements.length,
  labels: data.placements.reduce((sum, item) => sum + item.labels.length, 0),
  imageWidthScale: images[0].component.data.WidthScale,
  maximumColumns: Math.max(...data.placements.map(item => item.columns)),
  maximumRows: Math.max(...data.placements.map(item => item.rows)),
  strictPlacement: placement.strictOk,
}, null, 2));
