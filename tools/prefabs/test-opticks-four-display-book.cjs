'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const [donorPath, outputPath, dataPath = `${__dirname}/opticks-four-display-pages.json`] = process.argv.slice(2);
if (!donorPath || !outputPath) {
  throw new Error('Usage: node test-opticks-four-display-book.cjs donor.brz output.brz [pages.json]');
}

const TYPES = {
  array: 'BrickComponentType_ArrayVar',
  cycle: 'BrickComponentType_Exec_Cycle',
  get: 'BrickComponentType_Exec_ArrayVar_Get',
  logicalOr: 'BrickComponentType_Expr_LogicalOR',
  text: 'Component_TextDisplay',
};
const BLANK = '\u2800';
const BAND_KEYS = ['imagePagesA', 'imagePagesB', 'imagePagesC', 'imagePagesD'];
const BAND_DISPLAY_Z = [10967, 10969, 10963, 10965];
const donor = read(fs.readFileSync(donorPath));
const outputBytes = fs.readFileSync(outputPath);
const output = read(outputBytes);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function components(scene, type) {
  return scene.bricks.flatMap((brick, brickIndex) => brick.comps
    .filter(component => component.type === type)
    .map(component => ({ brick, brickIndex, component, type })));
}

function one(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function edgesTo(scene, item, port) {
  return scene.edges.filter(edge => edge.z === item.brick.key
    && edge.zt === item.type && edge.q === port);
}

function edgesFrom(scene, item, port) {
  return scene.edges.filter(edge => edge.a === item.brick.key
    && edge.at === item.type && edge.p === port);
}

function endpoint(edge) {
  return JSON.stringify([edge.a, edge.at, edge.p]);
}

function normalizedRows(value) {
  if (!value) return [];
  return value.replaceAll(BLANK, ' ').split('\r\n').map(row => row.replace(/ +$/, ''));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optimalMaximumBandBytes(rows) {
  const prefix = [0];
  for (const row of rows) prefix.push(prefix.at(-1) + Buffer.byteLength(row, 'utf8'));
  const cost = (start, end) => start === end
    ? 0
    : 2 * start + prefix[end] - prefix[start] + 2 * (end - start - 1);
  let scores = Array(rows.length + 1).fill(Infinity);
  scores[0] = 0;
  for (let band = 0; band < 4; band += 1) {
    const next = Array(rows.length + 1).fill(Infinity);
    for (let end = 0; end <= rows.length; end += 1) {
      for (let start = 0; start <= end; start += 1) {
        if (scores[start] !== Infinity) {
          next[end] = Math.min(next[end], Math.max(scores[start], cost(start, end)));
        }
      }
    }
    scores = next;
  }
  return scores[rows.length];
}

const bands = BAND_KEYS.map(key => {
  assert(Array.isArray(data[key]), `Missing ${key}`);
  return data[key];
});
assert(Array.isArray(data.imagePages), 'Missing logical imagePages');
assert(Array.isArray(data.textPages), 'Missing textPages');
const pageCount = data.textPages.length;
assert(pageCount > 0);
assert.equal(data.imagePages.length, pageCount);
for (const [index, pages] of bands.entries()) {
  assert.equal(pages.length, pageCount, `${BAND_KEYS[index]} page count`);
}

assert.equal(data.layout.cellMode, 'braille');
assert.equal(data.layout.imageWidthScale, 1);
assert(Math.abs(data.layout.imageLineHeight - 0.075) < 1e-9);
assert.equal(data.layout.imageOutlineWidth, 4);
assert.equal(data.layout.maximumImageColumns, 600);
assert.equal(data.layout.maximumImageRows, 260);
assert.equal(data.layout.imageArrayCount, 4);
assert.equal(data.layout.bandStrategy, 'byte-balanced contiguous rows');
assert.equal(data.placements.length, 57);
assert.equal(data.detailViews.length, 0);
const figure3 = one(data.placements.filter(item => item.source.endsWith('fig3-1.jpg')), 'Figure 3 placement');
assert(figure3.columns >= 580, `Figure 3 only uses ${figure3.columns} of 600 columns`);
assert(figure3.rows >= 95 && figure3.rows <= data.layout.maximumImageRows);
assert(figure3.imageX >= 0 && figure3.imageX + figure3.columns <= data.layout.maximumImageColumns);

for (const [name, pages] of [['imagePages', data.imagePages], ...BAND_KEYS.map((key, index) => [key, bands[index]])]) {
  for (const [pageIndex, page] of pages.entries()) {
    assert(/^[\u2800-\u28ff \r\n]*$/u.test(page), `${name} page ${pageIndex + 1} contains a non-Braille glyph`);
  }
}
for (const [name, pages] of [...BAND_KEYS.map((key, index) => [key, bands[index]]), ['textPages', data.textPages]]) {
  for (const [pageIndex, page] of pages.entries()) {
    assert(Buffer.byteLength(page, 'utf8') < 32767,
      `${name} page ${pageIndex + 1} exceeds the 32,767-byte array entry limit`);
  }
}

// Each layer owns a vertical row band. Later layers retain their leading CRLFs
// so all four displays can share one physical origin without visible seams.
for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
  const expected = normalizedRows(data.imagePages[pageIndex]);
  const layerRows = bands.map(pages => normalizedRows(pages[pageIndex]));
  const ranges = data.imageBandRanges[pageIndex];
  const byteSizes = data.imageBandBytes[pageIndex];
  assert.equal(ranges.length, 4);
  assert.equal(byteSizes.length, 4);
  assert.equal(ranges[0][0], 0);
  for (let band = 0; band < 3; band += 1) assert.equal(ranges[band][1], ranges[band + 1][0]);
  assert.equal(ranges[3][1], expected.length);
  const actualByteSizes = bands.map(pages => Buffer.byteLength(pages[pageIndex], 'utf8'));
  assert.deepEqual(actualByteSizes, byteSizes, `Band byte metadata mismatch on page ${pageIndex + 1}`);
  assert.equal(Math.max(...actualByteSizes), optimalMaximumBandBytes(expected),
    `Row bands are not byte-balanced on page ${pageIndex + 1}`);
  for (let band = 0; band < 4; band += 1) {
    const [start, end] = ranges[band];
    const exactBand = start === end ? '' : '\r\n'.repeat(start) + expected.slice(start, end).join('\r\n');
    assert.equal(bands[band][pageIndex], exactBand,
      `Band ${BAND_KEYS[band].at(-1)} is not the declared row slice on page ${pageIndex + 1}`);
  }
  const rowCount = Math.max(expected.length, ...layerRows.map(rows => rows.length));
  const reconstructed = [];
  const extents = [];
  for (const rows of layerRows) {
    const inkRows = rows.map((row, index) => (row ? index : -1)).filter(index => index >= 0);
    extents.push(inkRows.length ? [inkRows[0], inkRows.at(-1)] : null);
  }
  let priorLast = -1;
  for (const extent of extents) {
    if (!extent) continue;
    assert(extent[0] > priorLast, `Row bands overlap or are out of order on page ${pageIndex + 1}`);
    priorLast = extent[1];
  }
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const candidates = layerRows.map(rows => rows[rowIndex] || '').filter(Boolean);
    assert(candidates.length <= 1,
      `Multiple displays own image row ${rowIndex} on page ${pageIndex + 1}`);
    reconstructed.push(candidates[0] || '');
  }
  while (reconstructed.at(-1) === '') reconstructed.pop();
  while (expected.at(-1) === '') expected.pop();
  assert.deepEqual(reconstructed, expected, `Four-band reconstruction mismatch on page ${pageIndex + 1}`);
}

const donorImageDisplays = components(donor, TYPES.text).filter(item => item.component.data.Face === 3);
assert.equal(donorImageDisplays.length, 2);
const imageDisplays = components(output, TYPES.text).filter(item => item.component.data.Face === 3)
  .sort((left, right) => left.brickIndex - right.brickIndex);
assert.equal(imageDisplays.length, 4);
assert.deepEqual(imageDisplays.map(item => item.brickIndex), [50, 51, 52, 53]);

const expectedZ = [10963, 10965, 10967, 10969];
const expectedOffsetY = [24.5, 22.5, 20.5, 18.5];
for (let index = 0; index < imageDisplays.length; index += 1) {
  const before = donor.bricks[50 + index];
  const item = imageDisplays[index];
  assert.deepEqual(item.brick.data, before.data, `Host brick ${50 + index} geometry changed`);
  assert.equal(item.brick.data.position[2], expectedZ[index]);
  assert.equal(item.component.data.Face, 3);
  assert.equal(item.component.data.WidthScale, 1);
  assert(Math.abs(item.component.data.LineHeight - 0.075) < 1e-6);
  assert.equal(item.component.data.LineOffset, -5.5);
  assert.equal(item.component.data.Kerning, -6);
  assert.equal(item.component.data.Skew, 0);
  assert.equal(item.component.data.OutlineWidth, 4);
  assert.equal(item.component.data.Offset.X, -12);
  assert.equal(item.component.data.Offset.Y, expectedOffsetY[index]);
  assert.equal(item.component.data.Offset.Z, 9.5);
  assert.equal(item.brick.data.position[2] + item.component.data.Offset.Y, 10987.5);
}
assert(imageDisplays.every(item => item.brick.data.position[0] === imageDisplays[0].brick.data.position[0]
  && item.brick.data.position[1] === imageDisplays[0].brick.data.position[1]),
'Image display hosts do not share the same X/Y position');

const arrays = components(output, TYPES.array);
const getters = components(output, TYPES.get);
const cycles = components(output, TYPES.cycle);
assert.equal(arrays.length, 5, 'Expected four image arrays and one prose array');
assert.equal(getters.length, 5, 'Expected four image getters and one prose getter');
const cycle = one(cycles, 'page cycle');
assert.equal(cycle.component.data.Count, pageCount);
assert.equal(cycle.component.data.Value, pageCount - 1);

function arrayForPages(pages, description) {
  const expected = pages.slice().reverse();
  return one(arrays.filter(item => item.component.data.Value.$elementType === 'str'
    && arraysEqual(item.component.data.Value.$array, expected)), description);
}

function getterForArray(array, description) {
  const referenceEdges = output.edges.filter(edge => edge.a === array.brick.key
    && edge.at === TYPES.array && edge.p === 'ArrayVarRef'
    && edge.zt === TYPES.get && edge.q === 'ArrayVarRef');
  const reference = one(referenceEdges, `${description} ArrayVarRef connection`);
  return one(getters.filter(item => item.brick.key === reference.z), `${description} getter`);
}

const imageArrays = bands.map((pages, index) => arrayForPages(pages, `image array ${BAND_KEYS[index].at(-1)}`));
const textArray = arrayForPages(data.textPages, 'prose array');
const imageGetters = imageArrays.map((array, index) => getterForArray(array, `image ${BAND_KEYS[index].at(-1)}`));
const textGetter = getterForArray(textArray, 'prose');
const allBindings = [...imageGetters.map((getter, index) => ({
  getter,
  pages: bands[index],
  display: one(imageDisplays.filter(item => item.brick.data.position[2] === BAND_DISPLAY_Z[index]),
    `image ${BAND_KEYS[index].at(-1)} display`),
  description: `image ${BAND_KEYS[index].at(-1)}`,
})), { getter: textGetter, pages: data.textPages, display: null, description: 'prose' }];

let commonExecSource;
for (const binding of allBindings) {
  const { getter, pages, description } = binding;
  assert.equal(getter.component.data.Index, pageCount - 1, `${description} getter index`);
  assert.equal(getter.component.data.Value.$variant, 'str');
  assert.equal(getter.component.data.Value.value, pages[0], `${description} getter initial value`);
  assert.equal(getter.component.data.bOutOfBounds, false);
  const indexEdge = one(edgesTo(output, getter, 'Index'), `${description} cycle index connection`);
  assert.equal(endpoint(indexEdge), JSON.stringify([cycle.brick.key, TYPES.cycle, 'Output']));
  const execEdge = one(edgesTo(output, getter, 'Exec'), `${description} refresh connection`);
  assert.equal(execEdge.at, TYPES.logicalOr);
  assert.equal(execEdge.p, 'bOutput');
  commonExecSource ??= endpoint(execEdge);
  assert.equal(endpoint(execEdge), commonExecSource, 'Getters do not share one page-change trigger');
}

const imageDisplayKeys = new Set();
for (const binding of allBindings.slice(0, 4)) {
  const valueEdge = one(edgesFrom(output, binding.getter, 'Value'), `${binding.description} display connection`);
  assert.equal(valueEdge.zt, TYPES.text);
  assert.equal(valueEdge.q, 'Text');
  assert.equal(valueEdge.z, binding.display.brick.key, `${binding.description} drives the wrong display`);
  assert(!imageDisplayKeys.has(valueEdge.z), 'Two image getters drive the same display');
  imageDisplayKeys.add(valueEdge.z);
  assert.equal(binding.display.component.data.Text, binding.pages[0]);
}
const textValueEdge = one(edgesFrom(output, textGetter, 'Value'), 'prose display connection');
assert.equal(textValueEdge.zt, TYPES.text);
assert.equal(textValueEdge.q, 'Text');
const proseDisplay = one(components(output, TYPES.text).filter(item => item.brick.key === textValueEdge.z), 'prose display');
assert.equal(proseDisplay.component.data.Face, 0);
assert.equal(proseDisplay.component.data.Text, data.textPages[0]);

const triggerKey = JSON.parse(commonExecSource)[0];
const trigger = one(components(output, TYPES.logicalOr).filter(item => item.brick.key === triggerKey), 'page-change trigger');
assert.deepEqual(trigger.brick.data.position, [-25, 5, 2]);
const triggerButtons = ['bInputA', 'bInputB'].map(port => endpoint(one(edgesTo(output, trigger, port), `trigger ${port}`))).sort();
const cycleButtons = ['Exec', 'ExecDown'].map(port => endpoint(one(edgesTo(output, cycle, port), `cycle ${port}`))).sort();
assert.deepEqual(triggerButtons, cycleButtons, 'Cycle and array refresh are driven by different navigation inputs');

const placement = validatePlacement(outputBytes);
assert(placement.strictOk, JSON.stringify(placement));
console.log(JSON.stringify({
  bytes: outputBytes.length,
  pages: pageCount,
  imageDisplays: imageDisplays.length,
  imageArrays: imageArrays.length,
  figure3Columns: figure3.columns,
  figure3Rows: figure3.rows,
  maxBandEntryBytes: Math.max(...bands.flatMap(pages => pages.map(page => Buffer.byteLength(page, 'utf8')))),
  imageLineHeight: imageDisplays[0].component.data.LineHeight,
  sharedImageOrigin: 10987.5,
  strictPlacement: placement.strictOk,
}, null, 2));
