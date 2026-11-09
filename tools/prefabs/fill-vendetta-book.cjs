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

function build(input, pageData = path.join(__dirname, 'vendetta-pages.json')) {
  const donorBytes = fs.readFileSync(input);
  const scene = read(donorBytes);
  const { pages } = JSON.parse(fs.readFileSync(pageData, 'utf8'));

  assert.equal(pages.length, 48, 'The supplied Global Grey edition has 48 story pages');
  pages.forEach((page, index) => {
    const number = index + 1;
    assert(page.startsWith(`${number}\r\n\r\n`), `Page ${number} label/CRLF prefix`);
    assert(!page.replaceAll('\r\n', '').includes('\n'), `Page ${number} uses CRLF only`);
    assert(!page.includes('I\'m Julie'), `Page ${number} excludes publisher promotion`);
  });
  assert(pages.at(-1).endsWith('THE END'), 'Final page ends with the novel');

  const pageArray = only(components(scene, TYPES.array), 'page Array Var').component;
  const cycle = only(components(scene, TYPES.cycle), 'page Cycle').component;
  const getter = only(components(scene, TYPES.get), 'page Array Get').component;
  const pageDisplay = only(components(scene, TYPES.text)
    .filter(({ component }) => /^1\r\n\r\nChapter I\. Prologue/.test(component.data.Text || '')),
  'visible page Text Display').component;

  const originalFive = pageArray.data.Value.$array.slice().reverse();
  assert.equal(originalFive.length, 5, 'Input contains the five partially entered pages');
  assert.deepEqual(pages.slice(0, 5), originalFive, 'Preserve the user-entered first five pages exactly');

  pageArray.data.Value.$array = pages.slice().reverse();
  cycle.data.Count = pages.length;
  cycle.data.Value = pages.length - 1;
  getter.data.Index = pages.length - 1;
  getter.data.Value = { $variant: 'str', value: pages[0] };
  getter.data.bOutOfBounds = false;
  pageDisplay.data.Text = pages[0];

  const description = 'Complete 48-page text of The Vendetta by Honore de Balzac, using the original book controls and PDF page layout.';
  const generated = write(scene, {
    name: 'The Vendetta - Complete Book',
    description,
  }).bytes;
  const bytes = repack(generated, donorBytes, {
    name: 'The Vendetta - Complete Book',
    description,
  });

  return { bytes, pages, donorBytes };
}

module.exports = build;

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error('Usage: node fill-vendetta-book.cjs "Book test.brz" output.brz');
  }
  const result = build(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    pages: result.pages.length,
    characters: result.pages.reduce((sum, page) => sum + page.length, 0),
    bytes: result.bytes.length,
  }, null, 2));
}
