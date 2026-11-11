'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const buildRelease = require('./build-sqm1-midi-converter-release.cjs');
const converter = require('./sqm1-midi-cartridge-converter.cjs');
const browserCore = require('./sqm1-browser-cartridge-core.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {fixture} = require('./test-sqm1-midi-converter-core.cjs');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_BUFFER = 16 * 1024 * 1024;

async function test() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqm1-release-'));
  try {
    const firstZip = path.join(directory, 'first.zip');
    const secondZip = path.join(directory, 'second.zip');
    const first = await buildRelease({
      outputFile: firstZip,
      htmlOutputFile: path.join(directory, 'first.html'),
    });
    const second = await buildRelease({
      outputFile: secondZip,
      htmlOutputFile: path.join(directory, 'second.html'),
    });
    const firstBytes = fs.readFileSync(firstZip);
    const secondBytes = fs.readFileSync(secondZip);
    assert.deepEqual(firstBytes, secondBytes, 'release ZIP is byte deterministic');
    assert.equal(first.sha256, sha256(firstBytes));
    assert.equal(first.sha256, second.sha256);

    const listing = execFileSync('unzip', ['-Z1', firstZip], {encoding: 'utf8'})
      .trim().split(/\r?\n/);
    assert.deepEqual(listing, [
      'README.md',
      'SHA256SUMS.txt',
      'SQM1-MIDI-Cartridge-Converter.html',
      'THIRD-PARTY-NOTICES.txt',
      'sqm1-midi-cartridge-converter.cjs',
    ]);
    execFileSync('unzip', ['-t', firstZip], {stdio: 'pipe'});
    const checksumText = execFileSync('unzip', ['-p', firstZip, 'SHA256SUMS.txt'],
      {encoding: 'utf8'});
    for (const name of listing.filter(name => name !== 'SHA256SUMS.txt')) {
      const data = execFileSync('unzip', ['-p', firstZip, name], {maxBuffer: MAX_BUFFER});
      assert(checksumText.includes(`${sha256(data)}  ${name}\n`), `${name} checksum`);
    }
    const html = execFileSync('unzip', ['-p', firstZip,
      'SQM1-MIDI-Cartridge-Converter.html'], {encoding: 'utf8', maxBuffer: MAX_BUFFER});
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /V4 Pitch Continuity \(recommended\)/);
    assert(!/<script\s+[^>]*src=/i.test(html));
    assert(!/https?:\/\//i.test(html));
    assert(!/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/.test(html));
    assert(!/return import\s*\(|\brequire\s*\(/.test(html));

    const extracted = path.join(directory, 'clean-extracted-release');
    fs.mkdirSync(extracted);
    execFileSync('unzip', ['-q', firstZip, '-d', extracted], {stdio: 'pipe'});
    assert.equal(fs.existsSync(path.join(extracted, 'node_modules')), false,
      'release CLI must not need node_modules');
    const cliFile = path.join(extracted, 'sqm1-midi-cartridge-converter.cjs');
    const midiFile = path.join(directory, 'release-parity.mid');
    const cliOutput = path.join(directory, 'release-parity-cli.brz');
    const title = 'Release Parity';
    const midiBytes = fixture.comprehensiveFixture();
    fs.writeFileSync(midiFile, midiBytes);
    const cliSummary = JSON.parse(execFileSync(process.execPath, [
      cliFile, midiFile, cliOutput, '--title', title,
    ], {cwd: extracted, encoding: 'utf8'}));
    assert.equal(cliSummary.title, title);
    assert.equal(cliSummary.preset, 'v4-quality');
    assert.match(cliSummary.templateFile, /^embedded:[0-9a-f]{64}$/);
    const cliBytes = fs.readFileSync(cliOutput);
    const templateBytes = fs.readFileSync(buildRelease.constants.TEMPLATE);
    const adapter = converter.convertMidiToCartridge({
      bytes: midiBytes,
      templateBytes,
      filename: path.basename(midiFile),
      title,
      preset: 'v4-quality',
    });
    const browser = browserCore.buildAutomaticCartridge({
      scoreValues: adapter.score.array.values,
      templateBytes,
      title,
      preferredMode: 0,
      buildName: `SQM1 ${title} Cartridge`,
      description: `Physics-root automatic SQM1 cartridge containing ${title}; converted with v4-quality.`,
      maximumVoices: 24,
    });
    assert.deepEqual(cliBytes, Buffer.from(adapter.bytes),
      'extracted single-file CLI matches the canonical adapter byte for byte');
    assert.deepEqual(cliBytes, Buffer.from(browser.bytes),
      'extracted single-file CLI matches the browser cartridge core byte for byte');
    const placement = validatePlacement(cliBytes);
    assert.equal(placement.strictOk, true, 'extracted CLI output has strict placement');
    assert.deepEqual({invalid: placement.invalidBricks.length,
      confirmed: placement.confirmedPairs.length,
      uncertain: placement.uncertainPairs.length,
      warnings: placement.warnings.length},
    {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});
    console.log(`SQM1 converter release checks passed: deterministic ${first.bytes}-byte ZIP, `
      + 'fixed stored entries, verified checksums, self-contained offline HTML, embedded-template '
      + 'Node CLI, exact adapter/browser parity and strict placement.');
    console.log(JSON.stringify({sha256: first.sha256, files: first.files,
      cliParitySha256: sha256(cliBytes)}, null, 2));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

module.exports = test;

if (require.main === module) test().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
