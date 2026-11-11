'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const ENTRY = path.join(ROOT, 'sqm1-browser-cartridge-entry.cjs');
const OUTPUT_DEFAULT = path.join(ROOT, 'dist', 'sqm1-browser-cartridge.js');

async function build(outputFile = OUTPUT_DEFAULT) {
  fs.mkdirSync(path.dirname(outputFile), {recursive: true});
  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: outputFile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    alias: {
      fs: path.join(ROOT, 'sqm1-browser-fs-shim.cjs'),
      'assert/strict': path.join(ROOT, 'sqm1-browser-assert-shim.cjs'),
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });
  return {outputFile, bytes: fs.statSync(outputFile).size};
}
module.exports = build;
module.exports.constants = {ENTRY, OUTPUT_DEFAULT};

if (require.main === module) {
  build(process.argv[2] ? path.resolve(process.argv[2]) : OUTPUT_DEFAULT)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
