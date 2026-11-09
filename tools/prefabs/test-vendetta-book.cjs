'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { read } = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshot(scene) {
  const canonicalKey = key => {
    const [grid, x, y, z, index] = JSON.parse(key);
    return JSON.stringify([grid === 1 ? 'main' : 'chip', x, y, z, index]);
  };
  return {
    bricks: scene.bricks.map(brick => ({
      key: canonicalKey(brick.key),
      g: brick.g === 1 ? 'main' : 'chip',
      data: brick.data,
      componentTypes: brick.comps.map(component => component.type),
    })),
    edges: scene.edges.map(edge => ({
      ...edge,
      a: canonicalKey(edge.a),
      z: canonicalKey(edge.z),
    })),
    links: scene.links.map(link => ({
      key: canonicalKey(link.key),
      grid: link.grid === 1 ? 'main' : 'chip',
    })),
    joints: scene.joints,
  };
}

function componentDataByRole(scene) {
  const result = new Map();
  for (const brick of scene.bricks) {
    const grid = brick.g === 1 ? 'main' : 'chip';
    for (const component of brick.comps) {
      const key = JSON.stringify([grid, brick.data.position, component.type]);
      assert(!result.has(key), `Unique component identity ${key}`);
      result.set(key, component.data);
    }
  }
  return result;
}

function find(scene, type) {
  return scene.bricks.flatMap(brick => brick.comps.filter(component => component.type === type));
}

function test(input, output, pageData) {
  const beforeBytes = fs.readFileSync(input);
  const afterBytes = fs.readFileSync(output);
  const before = read(beforeBytes);
  const after = read(afterBytes);
  const { pages } = JSON.parse(fs.readFileSync(pageData, 'utf8'));

  assert.deepEqual(snapshot(after), snapshot(before), 'Geometry, wires, links, and component inventory are unchanged');
  assert.equal(after.bricks.length, before.bricks.length);
  assert.equal(after.edges.length, before.edges.length);
  assert.equal(after.links.length, before.links.length);
  assert.equal(after.joints.length, before.joints.length);

  const beforeData = componentDataByRole(before);
  const afterData = componentDataByRole(after);
  const allowed = new Set([
    'BrickComponentType_ArrayVar',
    'BrickComponentType_Exec_Cycle',
    'BrickComponentType_Exec_ArrayVar_Get',
  ]);
  for (const [key, data] of beforeData) {
    const [, , type] = JSON.parse(key);
    const changedPageDisplay = type === 'Component_TextDisplay'
      && /^1\r\n\r\nChapter I\. Prologue/.test(data.Text || '');
    if (changedPageDisplay) {
      const updated = structuredClone(afterData.get(key));
      updated.Text = data.Text;
      assert.deepEqual(updated, data, 'Page display formatting and placement remain unchanged');
    } else if (!allowed.has(type)) {
      assert.deepEqual(afterData.get(key), data, `Unrelated component data unchanged: ${key}`);
    }
  }

  const arrays = find(after, 'BrickComponentType_ArrayVar');
  const cycles = find(after, 'BrickComponentType_Exec_Cycle');
  const getters = find(after, 'BrickComponentType_Exec_ArrayVar_Get');
  assert.equal(arrays.length, 1);
  assert.equal(cycles.length, 1);
  assert.equal(getters.length, 1);
  assert.deepEqual(arrays[0].data.Value.$array, pages.slice().reverse());
  assert.equal(cycles[0].data.Count, pages.length);
  assert.equal(cycles[0].data.Value, pages.length - 1);
  assert.equal(getters[0].data.Index, pages.length - 1);
  assert.equal(getters[0].data.Value.value, pages[0]);

  const visible = find(after, 'Component_TextDisplay')
    .filter(component => component.data.Text === pages[0]);
  assert.equal(visible.length, 1, 'Saved display opens on page 1');

  const placement = validatePlacement(afterBytes);
  assert(placement.strictOk, JSON.stringify(placement, null, 2));
  assert.equal(after.r.globalData().GameVersion, before.r.globalData().GameVersion);
  assert.equal(afterBytes[4], beforeBytes[4], 'Donor container compression method retained');
  assert.equal(after.r.fs.listPaths().includes('Meta/Thumbnail.png'), before.r.fs.listPaths().includes('Meta/Thumbnail.png'));

  const bundle = JSON.parse(Buffer.from(after.r.fs.readFile('Meta/Bundle.json')));
  const donorBundle = JSON.parse(Buffer.from(before.r.fs.readFile('Meta/Bundle.json')));
  assert.equal(bundle.name, 'The Vendetta - Complete Book');
  assert.equal(bundle.gameVersion, donorBundle.gameVersion, 'Current donor game version retained');
  assert.equal(pages.length, 59);
  assert(pages.at(-1).endsWith('THE END'));
  assert(!pages.some(page => page.includes('I\'m Julie')));
  assert(pages.reduce((sum, page) => sum + page.split('\r\n').filter(line => line === '').length, 0) > 500,
    'Paragraph breaks are retained across the book');
  const canonicalStory = pages
    .map(page => page.replace(/^\d+\r\n\r\n/, ''))
    .join('\n')
    .replace(/\bTHE END\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/— /g, '—')
    .replace(/- /g, '-')
    .trim();
  assert.equal(canonicalStory.length, 141873);
  assert.equal(hash(canonicalStory), '3601a5cf09b54f96603b45379e019156570974d49d9c79b32ba3fc66a0b8548c');

  return {
    sha256: hash(afterBytes),
    bytes: afterBytes.length,
    pages: pages.length,
    bricks: after.bricks.length,
    wires: after.edges.length,
    strictPlacement: placement.strictOk,
    gameVersion: bundle.gameVersion,
  };
}

module.exports = test;

if (require.main === module) {
  const [input, output, pageData = path.join(__dirname, 'vendetta-pages.json')] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node test-vendetta-book.cjs input.brz output.brz [pages.json]');
  console.log(JSON.stringify(test(input, output, pageData), null, 2));
}
