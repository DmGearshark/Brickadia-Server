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

const donorImage = display(donor, 3);
const donorText = display(donor, 0);
const image = display(output, 3);
const text = display(output, 0);
for (const [before, after] of [[donorImage, image], [donorText, text]]) {
  assert.deepEqual(after.brick.data.position, before.brick.data.position);
  for (const key of ['Rotation', 'Skew', 'Kerning', 'LineOffset', 'Anchor', 'Face', 'Typeface']) {
    assert.deepEqual(after.component.data[key], before.component.data[key], `${key} changed`);
  }
  assert.equal(after.component.data.Offset.Y, before.component.data.Offset.Y);
  assert.equal(after.component.data.Offset.Z, before.component.data.Offset.Z);
}
assert.equal(image.component.data.WidthScale, 0.30000001192092896);
assert.equal(image.component.data.LineHeight, 0.15000000596046448);
assert.equal(image.component.data.Offset.X, text.component.data.Offset.X);
assert.equal(text.component.data.WidthScale, donorText.component.data.WidthScale);
assert.equal(text.component.data.LineHeight, donorText.component.data.LineHeight);
assert.equal(data.textPages.length, data.imagePages.length);
assert.equal(data.placements.length, 57);
assert(data.placements.every(item => item.columns <= 200 && item.rows <= 130));
assert(data.placements.find(item => item.source.endsWith('fig11-2.jpg')).labels.length >= 23);
for (const page of [...data.textPages, ...data.imagePages]) assert(page.length < 32767);

const arrays = components(output, 'BrickComponentType_ArrayVar');
for (const pages of [data.imagePages, data.textPages]) {
  assert(arrays.some(item => JSON.stringify(item.component.data.Value.$array.slice().reverse()) === JSON.stringify(pages)));
}
const placement = validatePlacement(outputBytes);
assert(placement.strictOk, JSON.stringify(placement));
console.log(JSON.stringify({
  bytes: outputBytes.length,
  pages: data.textPages.length,
  figures: data.placements.length,
  labels: data.placements.reduce((sum, item) => sum + item.labels.length, 0),
  imageWidthScale: image.component.data.WidthScale,
  maximumColumns: Math.max(...data.placements.map(item => item.columns)),
  maximumRows: Math.max(...data.placements.map(item => item.rows)),
  strictPlacement: placement.strictOk,
}, null, 2));
