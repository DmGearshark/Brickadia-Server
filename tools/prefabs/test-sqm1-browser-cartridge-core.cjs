'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const crypto = require('crypto');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');
const browserCore = require('./sqm1-browser-cartridge-core.cjs');
const buildBundle = require('./build-sqm1-browser-cartridge-bundle.cjs');

const SCORE = path.join(__dirname, 'undertale-megalovania-piano-single-quat-score.json');
const TEMPLATE = buildSongCartridge.constants.TEMPLATE_DEFAULT;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function test() {
  const document = JSON.parse(fs.readFileSync(SCORE, 'utf8'));
  const templateBytes = fs.readFileSync(TEMPLATE);
  const options = {
    scoreValues: document.array.values,
    templateBytes,
    title: 'Browser Core Parity',
    preferredMode: 0,
    buildName: 'SQM1 Browser Core Parity',
    description: 'Browser cartridge core deterministic parity fixture.',
    maximumVoices: 24,
  };
  const direct = browserCore.buildAutomaticCartridge(options);
  const canonical = buildSongCartridge({
    scoreDocument: document,
    templateFile: TEMPLATE,
    title: options.title,
    preferredMode: options.preferredMode,
    buildName: options.buildName,
    description: options.description,
    maxActiveVoices: 24,
  });
  assert.deepEqual(Buffer.from(direct.bytes), Buffer.from(canonical.bytes),
    'pure byte-input core matches generic Node cartridge builder');
  assert.equal(direct.scene.bricks.length, canonical.scene.bricks.length);
  assert.equal(direct.scene.edges.length, canonical.scene.edges.length);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqm1-browser-bundle-'));
  const bundleFile = path.join(directory, 'cartridge.js');
  const bundle = await buildBundle(bundleFile);
  assert(bundle.bytes > 100_000 && bundle.bytes < 2_000_000,
    'offline browser bundle has a practical size');
  const sandbox = {
    console,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextEncoder,
    TextDecoder,
    structuredClone,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(bundleFile, 'utf8'), sandbox, {
    filename: 'sqm1-browser-cartridge.js',
  });
  assert.equal(typeof sandbox.SQM1Cartridge?.buildAutomaticCartridge, 'function',
    'browser bundle exposes cartridge builder');
  const bundled = sandbox.SQM1Cartridge.buildAutomaticCartridge({
    ...options,
    scoreValues: structuredClone(options.scoreValues),
    templateBytes: new Uint8Array(templateBytes),
  });
  assert.equal(sha256(bundled.bytes), sha256(direct.bytes),
    'browser-target bundle produces the exact canonical cartridge');
  assert.equal(sandbox.SQM1Cartridge.constants.PLAYER_MAX_VOICES, 24);
  return {
    sha256: sha256(direct.bytes),
    bytes: direct.bytes.length,
    bricks: direct.scene.bricks.length,
    wires: direct.scene.edges.length,
    bundleBytes: bundle.bytes,
  };
}
module.exports = test;

if (require.main === module) {
  test().then(result => {
    console.log('SQM1 browser cartridge core checks passed: exact generic-builder parity, '
      + '24-voice validation, byte-only template input, browser bundling and deterministic output.');
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
