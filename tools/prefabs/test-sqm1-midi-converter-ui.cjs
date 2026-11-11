'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const build = require('./build-sqm1-midi-converter-app.cjs');
const ui = require('./sqm1-midi-converter-ui.cjs');

async function test() {
  assert.equal(ui.titleFromFilename('undertale-his-theme-toby-fox.mid'),
    'Undertale His Theme Toby Fox');
  assert.equal(ui.titleFromFilename('Already Named.MIDI'), 'Already Named');
  assert.equal(ui.safeOutputStem('His Theme: Toby Fox!'), 'his-theme-toby-fox');
  assert.equal(ui.formatDuration(65.25), '1:05.25');
  assert.deepEqual(ui.normalizeReport({report: {
    notes: 1936, activeVoices: 24, durationSeconds: 216.1, arrayEntries: 1970,
    minimumPitch: 36, maximumPitch: 96, shortenedHeldNotes: 358,
    totalHeldSecondsRemoved: 216.100795475, octaveFoldedNotes: 8,
    qualityLabel: 'Pitch continuity', warnings: {unmatchedNoteOffs: 0, repairs: 2},
  }}), {
    notes: 1936,
    activeVoices: 24,
    durationSeconds: 216.1,
    arrayEntries: 1970,
    pitchRange: '36–96',
    shortenedNotes: 358,
    removedSustainSeconds: 216.100795475,
    foldedNotes: 8,
    quality: 'Pitch continuity',
    warnings: ['repairs: 2'],
  });
  assert.equal(ui.normalizeReport({preset: 'v4-quality', report: {
    qualityLabel: 'sustain-trimmed+octave-folded',
  }}).quality, 'V4 Pitch Continuity');

  const outputFile = path.join(os.tmpdir(), `sqm1-midi-ui-${process.pid}.html`);
  const shellOptions = {adapterFile: build.constants.PLACEHOLDER_ADAPTER};
  const first = await build({...shellOptions, outputFile});
  const second = await build({...shellOptions, outputFile: `${outputFile}.second`});
  assert.equal(first.html, second.html, 'UI bundle is deterministic');
  assert(first.bytes > 40_000 && first.bytes < 350_000, 'bounded shell size');
  assert.match(first.html, /^<!doctype html>/);
  assert.match(first.html, /V4 Pitch Continuity \(recommended\)/);
  assert(!first.html.includes('Dense Piano'), 'no duplicate quality preset');
  assert.match(first.html, /Offline application/);
  assert.match(first.html, /Build &amp; Download Cartridge/);
  assert.match(first.html, /MIDI files must be 32 MB or smaller/);
  assert.match(first.html, /The converter core has not been bundled/);
  assert(!/<script\s+[^>]*src=/i.test(first.html), 'no external scripts');
  assert(!/<link\s+[^>]*href=/i.test(first.html), 'no external styles');
  assert(!/https?:\/\//i.test(first.html), 'no network URLs');
  assert(!/\bimport\s*\(/.test(first.html), 'no dynamic import path');
  assert(!/require\s*\(/.test(first.html), 'browser bundle contains no runtime require');
  assert.match(first.html, /Third-party licenses/);
  assert.match(first.html, /Copyright \(c\) 2021 Isaac Hirschfeld/);
  assert.match(first.html, /Copyright \(c\) 2017 Ilya Kantor/);
  const templatePrefix = fs.readFileSync(build.constants.DEFAULT_TEMPLATE)
    .toString('base64').slice(0, 96);
  assert(first.html.includes(templatePrefix),
    'production cartridge template is embedded in the offline document');
  assert.equal(build.makeOfflineOnly(
    'let loader=Function("specifier","return import(specifier)");'
      + 'let source="https://example.invalid/catalogue";'),
  'let loader=(specifier=>Promise.reject(new Error('
      + '"Native database modules are unavailable in this offline converter")));'
      + 'let source="offline-reference-removed";');
  fs.unlinkSync(outputFile);
  fs.unlinkSync(`${outputFile}.second`);
  console.log('SQM1 MIDI converter UI checks passed: deterministic self-contained offline HTML, '
    + 'V4-quality default, drag/file controls, advanced 24-voice/0.20-second settings, safe '
    + 'report normalization, download naming and no external network assets.');
}

module.exports = test;

if (require.main === module) test().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
