'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');
const testV16 = require('./test-scrap-runners-color-terminal-v16.cjs');
const { C } = require('./loadboard-lib.cjs');

const DEFAULT_V16_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v16.brz');
const DEFAULT_V8_TRUCK = path.join(__dirname,
  '../../outputs/scrap-runners-truck1-color-enabled-v8.brz');
const DEFAULT_V17_TERMINAL = path.join(__dirname,
  '../../outputs/scrap-runners-color-terminal-v17.brz');
const DEFAULT_V17_BUILDER = path.join(__dirname,
  'build-scrap-runners-color-terminal-v17.cjs');
const V8_TRUCK_SHA256 = '698b8b21594f791ab6bc96cd65b7adad2b39daa0f5c6930a725af5ae88c1b621';

const valueOf = value => value && typeof value === 'object' && '$variant' in value
  ? value.value : value;

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function api(scene) {
  const bricks = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const rows = scene.bricks.flatMap(brick => brick.comps.map(comp => ({ brick, comp })));
  const all = (type, predicate = () => true) => rows.filter(item => item.comp.type === type
    && predicate(item.comp.data, item.brick));
  const one = (items, label) => {
    assert.equal(items.length, 1, `${label}: expected one, found ${items.length}`);
    return items[0];
  };
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && (!port || edge.p === port));
  const source = edge => bricks.get(edge.a);
  const target = edge => bricks.get(edge.z);
  return { scene, bricks, rows, all, one, incoming, outgoing, source, target };
}

function sourceOf(t, brick, type, port, label) {
  const edge = t.one(t.incoming(brick, type, port), label);
  const source = t.source(edge);
  return { edge, brick: source, comp: component(source, edge.at) };
}

function srgbToLinear(encoded) {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max ? delta / max : 0, max];
}

function hsvToRgb([degrees, saturation, value]) {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((degrees / 60) % 2) - 1));
  const m = value - chroma;
  let prime;
  if (degrees < 60) prime = [chroma, x, 0];
  else if (degrees < 120) prime = [x, chroma, 0];
  else if (degrees < 180) prime = [0, chroma, x];
  else if (degrees < 240) prime = [0, x, chroma];
  else if (degrees < 300) prime = [x, 0, chroma];
  else prime = [chroma, 0, x];
  return prime.map(channel => channel + m);
}

function bytesOf(score) {
  return [(score >> 16) & 255, (score >> 8) & 255, score & 255];
}

function renderedBytesFromHsv(hsv) {
  return hsvToRgb(hsv).map(channel => Math.round(channel * 255));
}

function assertV16RuntimeBug(v16) {
  const t = api(v16);
  const converters = t.all(C.Expr_ColorConvert.NAME,
    data => data.FromSpace === 1 && data.ToSpace === 3);
  assert.equal(converters.length, 2,
    'v16 reproduces both adapted Srgb-to-HSV double-gamma paths');

  const source = bytesOf(0xff5a00).map(byte => byte / 255);
  const doubleDecoded = source.map(srgbToLinear);
  const wrongHsv = rgbToHsv(doubleDecoded);
  const wrongBytes = renderedBytesFromHsv(wrongHsv);
  // Brickadia's runtime float path reports 6.1344909668 degrees. The JS
  // double-precision model differs only in the fifth decimal place.
  assert(Math.abs(wrongHsv[0] - 6.1344909668) < 0.001,
    `v16 runtime fixture Hue is 6.134 degrees, got ${wrongHsv[0]}`);
  assert.deepEqual(wrongBytes, [255, 26, 0],
    'v16 double gamma reproduces runtime #FF5A00 -> #FF1A00');

  const orange = bytesOf(0xffa100).map(byte => byte / 255);
  const wrongOrange = renderedBytesFromHsv(rgbToHsv(orange.map(srgbToLinear)));
  assert.equal(wrongOrange[0], 255);
  assert([90, 91].includes(wrongOrange[1]));
  assert.equal(wrongOrange[2], 0);
  return converters;
}

function assertV17Adapters(v17) {
  const t = api(v17);
  assert.equal(t.all(C.Expr_ColorConvert.NAME,
    data => data.FromSpace === 1 && data.ToSpace === 3).length, 0,
  'v17 removes both double-gamma converter modes');
  const converters = t.all(C.Expr_ColorConvert.NAME,
    data => data.FromSpace === 0 && data.ToSpace === 3);
  assert.equal(converters.length, 2,
    'v17 has exactly two raw normalized RGB-to-HSV paths');

  for (const [{ brick: converter }, pathIndex] of converters.map((item, index) => [item, index])) {
    const raw = sourceOf(t, converter, C.Expr_ColorConvert.NAME,
      'Input', `path ${pathIndex + 1} raw normalized RGB`).brick;
    assert(component(raw, C.Expr_MakeColor.NAME),
      `path ${pathIndex + 1} retains the raw numeric color container`);
    let split;
    for (const port of ['R', 'G', 'B']) {
      const divide = sourceOf(t, raw, C.Expr_MakeColor.NAME,
        port, `path ${pathIndex + 1} ${port} normalization`).brick;
      const divideData = component(divide, C.Expr_MathDivide.NAME)?.data;
      assert(divideData, `path ${pathIndex + 1} ${port} uses MathDivide`);
      assert.equal(valueOf(divideData.InputB), 255,
        `path ${pathIndex + 1} ${port} divides the proven byte by 255`);
      const byte = sourceOf(t, divide, C.Expr_MathDivide.NAME,
        'InputA', `path ${pathIndex + 1} ${port} byte`);
      assert.equal(byte.comp?.type, C.Expr_SplitColorSRGB.NAME);
      assert.equal(byte.edge.p, port);
      if (split) assert.equal(byte.brick.key, split.key,
        `path ${pathIndex + 1} shares one SplitColorSRGB`);
      split = byte.brick;
    }

    const hsvSplit = t.target(t.one(t.outgoing(converter,
      C.Expr_ColorConvert.NAME, 'Output').filter(edge =>
      edge.zt === C.Expr_SplitColor.NAME && edge.q === 'Input'),
    `path ${pathIndex + 1} HSV split`));
    for (const [port, factor] of [['R', 360], ['G', 100], ['B', 100]]) {
      const scale = t.target(t.one(t.outgoing(hsvSplit,
        C.Expr_SplitColor.NAME, port).filter(edge =>
        edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputA'
          && valueOf(component(t.target(edge), C.Expr_MathMultiply.NAME).data.InputB) === factor),
      `path ${pathIndex + 1} ${port} x${factor}`));
      assert(t.outgoing(scale, C.Expr_MathMultiply.NAME, 'Output').some(edge =>
        edge.zt === C.Exec_Var_Set.NAME && edge.q === 'Value'),
      `path ${pathIndex + 1} scaled ${port} still writes its canonical state Var`);
    }
  }

  const samples = [0xff5a00, 0xffa100, 0xff8700, 0xff0000, 0x00ff00, 0x0000ff,
    0x808080, 0x000000, 0xffffff];
  for (const score of samples) {
    const source = bytesOf(score);
    const hsv = rgbToHsv(source.map(byte => byte / 255));
    assert.deepEqual(renderedBytesFromHsv(hsv), source,
      `raw numeric RGB HSV exactly roundtrips #${score.toString(16).padStart(6, '0').toUpperCase()}`);
  }
  assert(Math.abs(rgbToHsv([1, 0x5a / 255, 0])[0] - 21.176470588235293) < 1e-9,
    '#FF5A00 Hue is 21.176 degrees');
  assert(Math.abs(rgbToHsv([1, 0xa1 / 255, 0])[0] - 37.88235294117647) < 1e-9,
    '#FFA100 Hue is 37.882 degrees');
  return converters;
}

function assertOnlyIntendedDelta(v16, v17) {
  assert.equal(v17.bricks.length, v16.bricks.length, 'v17 preserves every terminal brick');
  assert.equal(v17.edges.length, v16.edges.length, 'v17 preserves every terminal wire');
  assert.deepEqual(v17.edges, v16.edges, 'v17 wire topology is byte-for-byte structural equal');
  assert.deepEqual(v17.links, v16.links, 'v17 nested-chip links are unchanged');
  assert.deepEqual(v17.joints || [], v16.joints || [], 'v17 joints are unchanged');
  assert.equal(v17.bricks.length, 667);
  assert.equal(v17.edges.length, 925);

  const changes = [];
  v16.bricks.forEach((oldBrick, brickIndex) => {
    const newBrick = v17.bricks[brickIndex];
    assert.equal(newBrick.key, oldBrick.key, `brick ${brickIndex} identity`);
    assert.deepEqual(newBrick.data, oldBrick.data, `brick ${brickIndex} geometry/data`);
    assert.equal(newBrick.comps.length, oldBrick.comps.length, `brick ${brickIndex} components`);
    oldBrick.comps.forEach((oldComp, compIndex) => {
      const newComp = newBrick.comps[compIndex];
      assert.equal(newComp.type, oldComp.type);
      if (JSON.stringify(newComp.data) === JSON.stringify(oldComp.data)) return;
      changes.push({ oldComp, newComp, brickIndex, compIndex });
    });
  });
  assert.equal(changes.length, 2, 'v17 changes only the two defective converters');
  for (const { oldComp, newComp } of changes) {
    assert.equal(oldComp.type, C.Expr_ColorConvert.NAME);
    assert.equal(oldComp.data.FromSpace, 1);
    assert.equal(newComp.data.FromSpace, 0);
    assert.equal(oldComp.data.ToSpace, 3);
    assert.equal(newComp.data.ToSpace, 3);
    const expected = structuredClone(oldComp.data);
    expected.FromSpace = 0;
    assert.deepEqual(newComp.data, expected, 'only FromSpace changes from 1 to 0');
  }
}

function test({
  previousTerminal = DEFAULT_V16_TERMINAL,
  previousTruck = DEFAULT_V8_TRUCK,
  terminalOutput = DEFAULT_V17_TERMINAL,
  truckOutput = DEFAULT_V8_TRUCK,
  builder = DEFAULT_V17_BUILDER,
} = {}) {
  // v17 deliberately invalidates v16's FromSpace assertion, so run the full
  // inherited suite on the committed v16/v8 baseline first.
  testV16();

  const previousBytes = fs.readFileSync(previousTerminal);
  const previousTruckBytes = fs.readFileSync(previousTruck);
  const terminalBytes = fs.readFileSync(terminalOutput);
  const truckBytes = fs.readFileSync(truckOutput);
  const v16 = read(previousBytes);
  const v17 = read(terminalBytes);

  assert(validate(terminalBytes).strictOk, 'v17 terminal passes strict placement');
  assert(validate(truckBytes).strictOk, 'unchanged Truck1 v8 passes strict placement');
  assert.deepEqual(truckBytes, previousTruckBytes, 'v17 keeps exact Truck1 v8 bytes');
  assert.equal(crypto.createHash('sha256').update(truckBytes).digest('hex'),
    V8_TRUCK_SHA256, 'Truck1 v8 hash is unchanged');
  assertV16RuntimeBug(v16);
  const converters = assertV17Adapters(v17);
  assertOnlyIntendedDelta(v16, v17);

  delete require.cache[require.resolve(builder)];
  const build = require(builder);
  const first = build(); const second = build();
  assert.deepEqual(first.bytes, second.bytes, 'v17 generation is deterministic');
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(terminalBytes),
    'checked v17 output matches a fresh build');

  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = {
    terminalOutput,
    terminalBricks: v17.bricks.length,
    terminalWires: v17.edges.length,
    terminalSha256: sha256(terminalBytes),
    truckOutput,
    truckSha256: sha256(truckBytes),
    runtimeBugFixture: '#FF5A00 -> FromSpace1 double gamma -> Hue 6.134 -> #FF1A00',
    correctedRoundtrip: '#FF5A00 -> Hue 21.176 -> #FF5A00',
    correctedConverters: converters.length,
    topologyDelta: 'two ColorConvert FromSpace fields only',
    inheritedV16Regressions: 'passed on v16/v8 baseline',
    strictPlacement: true,
    deterministic: 'passed',
    checks: 'passed',
  };
  console.log(JSON.stringify(result, null, 2));
  return { terminal: v17, truck: read(truckBytes), result };
}

if (require.main === module) test({
  previousTerminal: process.argv[2] || DEFAULT_V16_TERMINAL,
  previousTruck: process.argv[3] || DEFAULT_V8_TRUCK,
  terminalOutput: process.argv[4] || DEFAULT_V17_TERMINAL,
  truckOutput: process.argv[5] || DEFAULT_V8_TRUCK,
  builder: process.argv[6] || DEFAULT_V17_BUILDER,
});

module.exports = test;
