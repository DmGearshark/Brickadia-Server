'use strict';

// The live-tested Opticks builder became data-driven when optional name and
// description fields were added.  Keep one implementation of the calibrated
// wiring and expose this neutral entry point for the rest of Newton's books.
const fs = require('fs');
const path = require('path');
const build = require('./build-opticks-four-display-book.cjs');

module.exports = build;

if (require.main === module) {
  const [input, output, dataFile] = process.argv.slice(2);
  if (!input || !output || !dataFile) {
    throw new Error('Usage: node build-newton-four-display-book.cjs donor.brz output.brz pages.json');
  }
  const result = build(input, dataFile);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.bytes);
  console.log(JSON.stringify({
    output,
    bytes: result.bytes.length,
    pages: result.data.textPages.length,
    figures: result.data.placements?.length ?? 0,
    detailViews: result.data.detailViews?.length ?? 0,
    imageDisplays: 4,
    pagesWithImages: result.data.imagePages.filter(Boolean).length,
  }, null, 2));
}
