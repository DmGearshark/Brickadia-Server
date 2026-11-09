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

function only(items, description) {
  assert.equal(items.length, 1, `Expected one ${description}, found ${items.length}`);
  return items[0];
}

function components(scene, type) {
  return scene.bricks.flatMap(brick => brick.comps
    .filter(component => component.type === type)
    .map(component => ({ brick, component })));
}

function build(input, pageData = path.join(__dirname, 'opticks-pages.json')) {
  const donorBytes = fs.readFileSync(input);
  const scene = read(donorBytes);
  const data = JSON.parse(fs.readFileSync(pageData, 'utf8'));
  const { pages, illustrations, illustrationPages } = data;

  assert.equal(pages.length, 275);
  assert.equal(illustrations.length, 57);
  assert.equal(illustrationPages.length, 57);
  pages.forEach((page, index) => {
    assert(page.startsWith(`${index + 1}\r\n\r\n`), `Page ${index + 1} prefix`);
    assert(page.split('\r\n').length <= 50, `Page ${index + 1} row limit`);
  });

  const pageArray = only(components(scene, TYPES.array), 'page Array Var').component;
  const cycle = only(components(scene, TYPES.cycle), 'page Cycle').component;
  const getter = only(components(scene, TYPES.get), 'page Array Get').component;
  const pageDisplay = only(components(scene, TYPES.text)
    .filter(({ component }) => /^1\r\n/.test(component.data.Text || '')),
  'visible page Text Display').component;

  const assets = structuredClone(scene.r.externalAssets());
  let monoFont = assets.findIndex(asset => asset.type === 'BrickFontDescriptor' && asset.name === 'RobotoMono');
  if (monoFont < 0) {
    monoFont = assets.length;
    assets.push({ type: 'BrickFontDescriptor', name: 'RobotoMono' });
  }

  pageArray.data.Value.$array = pages.slice().reverse();
  cycle.data.Count = pages.length;
  cycle.data.Value = pages.length - 1;
  getter.data.Index = pages.length - 1;
  getter.data.Value = { $variant: 'str', value: pages[0] };
  getter.data.bOutOfBounds = false;
  pageDisplay.data.Text = pages[0];
  pageDisplay.data.Font = monoFont;
  pageDisplay.data.WidthScale = 0.82;

  const description = 'Complete text of Isaac Newton\'s Opticks. All 57 original figures are included as monospaced ASCII line-art pages because Brickadia prefabs cannot store custom images.';
  const generated = write(scene, {
    assets,
    name: 'Newton Opticks - Illustrated Text Edition',
    description,
  }).bytes;
  const bytes = repack(generated, donorBytes, {
    name: 'Newton Opticks - Illustrated Text Edition',
    description,
  });
  return { bytes, data, donorBytes };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-opticks-book.cjs donor-book.brz output.brz');
  const result = build(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    pages: result.data.pages.length,
    illustrations: result.data.illustrations.length,
    characters: result.data.pages.reduce((sum, page) => sum + page.length, 0),
    bytes: result.bytes.length,
  }, null, 2));
}
