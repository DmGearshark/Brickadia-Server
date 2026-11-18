'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { brdb } = require('brs-js');
const { read, write } = require('./reskin-loadboard.cjs');
const repack = require('./repack-with-donor-metadata.cjs');
const { C } = require('./loadboard-lib.cjs');

const INPUT = path.resolve(process.argv[2]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v16.brz'));
const OUTPUT = path.resolve(process.argv[3]
  || path.join(__dirname, '../../outputs/scrap-runners-color-terminal-v17.brz'));

function owner(scene) {
  const owners = scene.r.owners();
  const index = owners.UserNames.findIndex(name => name !== 'PUBLIC');
  assert(index >= 0, 'Prefab owner');
  return {
    id: brdb.guidToUuid(owners.UserIds[index]),
    name: owners.UserNames[index],
    display_name: owners.DisplayNames[index],
  };
}

function component(brick, type) {
  return brick?.comps.find(saved => saved.type === type);
}

function build(input = INPUT) {
  const donor = fs.readFileSync(input);
  const scene = read(donor);
  scene.entityOverrides = new Map();

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && (!port || edge.q === port));

  // v16 already extracts the real sRGB bytes, divides them by 255, and packs
  // those normalized byte values into a raw Expr_MakeColor numeric container.
  // Marking that container as Srgb (1) makes ColorConvert gamma-decode the
  // values a second time. Runtime proof: #FF5A00 becomes Hue 6.134 degrees and
  // reconstructs as #FF1A00. FromSpace 0 treats the already-normalized numbers
  // directly for HSV arithmetic, which exactly roundtrips the source sRGB.
  const converters = scene.bricks.flatMap(brick => brick.comps
    .filter(saved => saved.type === C.Expr_ColorConvert.NAME)
    .map(saved => ({ brick, saved })))
    .filter(({ saved }) => saved.data.FromSpace === 1 && saved.data.ToSpace === 3);
  assert.equal(converters.length, 2,
    'vehicle/saved sync and accepted-hex sRGB adapters');

  for (const [index, { brick, saved }] of converters.entries()) {
    const sourceEdge = incoming(brick, C.Expr_ColorConvert.NAME, 'Input');
    assert.equal(sourceEdge.length, 1, `HSV path ${index + 1} source`);
    const raw = byKey.get(sourceEdge[0].a);
    assert(component(raw, C.Expr_MakeColor.NAME),
      `HSV path ${index + 1} uses raw normalized sRGB container`);
    for (const port of ['R', 'G', 'B']) {
      const channel = incoming(raw, C.Expr_MakeColor.NAME, port);
      assert.equal(channel.length, 1, `HSV path ${index + 1} ${port} source`);
      const divide = byKey.get(channel[0].a);
      const divideData = component(divide, C.Expr_MathDivide.NAME)?.data;
      assert(divideData, `HSV path ${index + 1} ${port} normalization`);
      assert.equal(divideData.InputB?.value, 255,
        `HSV path ${index + 1} ${port} divides by 255`);
      const byte = incoming(divide, C.Expr_MathDivide.NAME, 'InputA');
      assert.equal(byte.length, 1, `HSV path ${index + 1} ${port} byte source`);
      assert(component(byKey.get(byte[0].a), C.Expr_SplitColorSRGB.NAME),
        `HSV path ${index + 1} reads proven sRGB bytes`);
    }
    saved.data.FromSpace = 0;
  }

  const metadata = {
    name: 'Scrap Runners - Color Terminal v17 Exact sRGB HSV',
    description: 'Treats the already-extracted normalized sRGB channels as raw RGB during both HSV conversions, preventing the v16 double-gamma red shift while preserving live entry synchronization, retained CURRENT COLOR, and seat-safe purchases.',
    owner: owner(scene),
  };
  const bytes = repack(write(scene, metadata).bytes, donor, metadata);
  return { bytes, scene, correctedConverters: converters.map(item => item.brick.key) };
}

function finite(value, name) {
  if (typeof value === 'number') assert(Number.isFinite(value), `Non-finite ${name}`);
  else if (Array.isArray(value)) value.forEach((child, index) =>
    finite(child, `${name}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value)
    .forEach(([key, child]) => finite(child, `${name}.${key}`));
}

module.exports = build;
if (require.main === module) {
  const result = build();
  result.scene.bricks.forEach((brick, index) => finite(brick, `terminal[${index}]`));
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, result.bytes);
  console.log(JSON.stringify({
    output: OUTPUT,
    bricks: result.scene.bricks.length,
    wires: result.scene.edges.length,
    correctedConverters: result.correctedConverters.length,
    fix: 'normalized sRGB numeric RGB -> HSV without second gamma decode',
  }, null, 2));
}
