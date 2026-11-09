'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function canonicalKey(key) {
  const [grid, x, y, z, index] = JSON.parse(key);
  return JSON.stringify([grid === 1 ? 'main' : 'chip', x, y, z, index]);
}

function geometrySnapshot(scene) {
  return {
    bricks: scene.bricks.map(brick => ({
      key: canonicalKey(brick.key),
      grid: brick.g === 1 ? 'main' : 'chip',
      data: brick.data,
      types: brick.comps.map(component => component.type),
    })),
    edges: scene.edges.map(edge => ({ ...edge, a: canonicalKey(edge.a), z: canonicalKey(edge.z) })),
    links: scene.links.map(link => ({ key: canonicalKey(link.key), grid: link.grid === 1 ? 'main' : 'chip' })),
    joints: scene.joints,
  };
}

function components(scene, type) {
  return scene.bricks.flatMap(brick => brick.comps.filter(component => component.type === type));
}

function dataByRole(scene) {
  const result = new Map();
  for (const brick of scene.bricks) for (const component of brick.comps) {
    const key = JSON.stringify([brick.g === 1 ? 'main' : 'chip', brick.data.position, component.type]);
    assert(!result.has(key), `Unique component ${key}`);
    result.set(key, component.data);
  }
  return result;
}

function test(input, output, pageData) {
  const beforeBytes = fs.readFileSync(input);
  const afterBytes = fs.readFileSync(output);
  const before = read(beforeBytes);
  const after = read(afterBytes);
  const data = JSON.parse(fs.readFileSync(pageData, 'utf8'));
  const { pages, illustrations, illustrationPages } = data;

  assert.deepEqual(geometrySnapshot(after), geometrySnapshot(before));
  assert.equal(after.bricks.length, before.bricks.length);
  assert.equal(after.edges.length, before.edges.length);
  assert.equal(after.links.length, before.links.length);

  const beforeData = dataByRole(before);
  const afterData = dataByRole(after);
  const changed = new Set([
    'BrickComponentType_ArrayVar',
    'BrickComponentType_Exec_Cycle',
    'BrickComponentType_Exec_ArrayVar_Get',
  ]);
  for (const [key, oldData] of beforeData) {
    const [, , type] = JSON.parse(key);
    const pageDisplay = type === 'Component_TextDisplay' && /^1\r\n/.test(oldData.Text || '');
    if (pageDisplay) {
      const saved = structuredClone(afterData.get(key));
      saved.Text = oldData.Text;
      saved.Font = oldData.Font;
      saved.WidthScale = oldData.WidthScale;
      assert.deepEqual(saved, oldData, 'Only the page text/font/width changed');
    } else if (!changed.has(type)) {
      assert.deepEqual(afterData.get(key), oldData, `Unrelated component unchanged: ${key}`);
    }
  }

  const array = components(after, 'BrickComponentType_ArrayVar');
  const cycle = components(after, 'BrickComponentType_Exec_Cycle');
  const getter = components(after, 'BrickComponentType_Exec_ArrayVar_Get');
  assert.equal(array.length, 1);
  assert.equal(cycle.length, 1);
  assert.equal(getter.length, 1);
  assert.deepEqual(array[0].data.Value.$array, pages.slice().reverse());
  assert.equal(cycle[0].data.Count, pages.length);
  assert.equal(cycle[0].data.Value, pages.length - 1);
  assert.equal(getter[0].data.Index, pages.length - 1);
  assert.equal(getter[0].data.Value.value, pages[0]);

  const displays = components(after, 'Component_TextDisplay').filter(component => component.data.Text === pages[0]);
  assert.equal(displays.length, 1);
  const assets = after.r.externalAssets();
  assert.equal(assets[displays[0].data.Font]?.type, 'BrickFontDescriptor');
  assert.equal(assets[displays[0].data.Font]?.name, 'RobotoMono');
  assert(Math.abs(displays[0].data.WidthScale - 0.82) < 1e-6);

  assert.equal(pages.length, 275);
  assert.equal(illustrations.length, 57);
  assert.equal(new Set(illustrations.map(item => item.source)).size, 57);
  assert.equal(illustrationPages.length, 57);
  illustrationPages.forEach((page, index) => {
    assert(pages[page - 1].includes(`ILLUSTRATION ${index + 1} OF 57`));
    assert(illustrations[index].rows > 0 && illustrations[index].columns > 0);
  });
  assert(pages.every(page => page.split('\r\n').length <= 50));

  const figureSet = new Set(illustrationPages);
  const narrative = pages
    .filter((_, index) => !figureSet.has(index + 1))
    .map(page => page.replace(/^\d+\r\n\r\n/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  assert.equal(narrative.length, 557393);
  assert.equal(hash(narrative), '9ba56c637ecee8f3b1432f5b836c39b75344a5cdded589df3ee9a7ca733f52d5');

  const placement = validatePlacement(afterBytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  const bundle = JSON.parse(Buffer.from(after.r.fs.readFile('Meta/Bundle.json')));
  const donorBundle = JSON.parse(Buffer.from(before.r.fs.readFile('Meta/Bundle.json')));
  assert.equal(bundle.name, 'Newton Opticks - Illustrated Text Edition');
  assert.equal(bundle.gameVersion, donorBundle.gameVersion);
  assert.equal(afterBytes[4], beforeBytes[4]);
  assert.equal(after.r.fs.listPaths().includes('Meta/Thumbnail.png'), before.r.fs.listPaths().includes('Meta/Thumbnail.png'));

  return {
    sha256: hash(afterBytes),
    bytes: afterBytes.length,
    pages: pages.length,
    illustrations: illustrations.length,
    bricks: after.bricks.length,
    wires: after.edges.length,
    strictPlacement: placement.strictOk,
    gameVersion: bundle.gameVersion,
  };
}

module.exports = test;

if (require.main === module) {
  const [input, output, pageData = path.join(__dirname, 'opticks-pages.json')] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node test-opticks-book.cjs donor.brz output.brz [pages.json]');
  console.log(JSON.stringify(test(input, output, pageData), null, 2));
}
