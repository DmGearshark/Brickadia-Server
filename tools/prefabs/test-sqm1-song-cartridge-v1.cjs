'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');

const SCORE_FILE = path.join(__dirname, 'viva-la-vida-single-quat-score.json');
const EXPECTED = Object.freeze({
  sourceSha256: 'a4f6ac10e617b39d89ff478ff1c6b88aabd08d561e592d5d30486112f54c2e06',
  activeVoices: 18,
  notes: 3430,
  arrayEntries: 3464,
  durationSeconds: 239.998867144,
  releaseTailSeconds: 0.2,
  minimumPitch: 32,
  maximumPitch: 80,
});

function sourceDocument() {
  return JSON.parse(fs.readFileSync(SCORE_FILE, 'utf8'));
}

function rejected(label, mutate, pattern, options = {}) {
  const document = sourceDocument();
  mutate(document);
  assert.throws(() => buildSongCartridge.validateScoreDocument(document, options),
    pattern, label);
}

module.exports = function testSqm1SongCartridgeV1() {
  const valid = buildSongCartridge.validateScoreDocument(sourceDocument(), {
    expected: EXPECTED,
  });
  assert.equal(valid.values.length, 3464);
  assert.deepEqual(valid.statistics, {
    notes: 3430,
    arrayEntries: 3464,
    activeVoices: 18,
    durationSeconds: 239.998867144,
    releaseTailSeconds: 0.2,
    minimumPitch: 32,
    maximumPitch: 80,
  });

  rejected('bad magic', document => {
    document.array.values[0].X = 7701002;
  }, /SQM1 magic/);
  rejected('zero duration', document => {
    document.array.values[0].W = 0;
  }, /duration must be positive/);
  rejected('player voice cap', document => {
    document.array.values[0].Z = 19;
    document.activeVoices = 19;
  }, /active voice count must be 1\.\.18/);
  rejected('bad active voice offset', document => {
    document.array.values[3].X += 1;
  }, /Voice 1 contiguous note offset/);
  rejected('metadata drift', document => {
    document.statistics.notes -= 1;
  }, /Metadata note count/);
  rejected('wrong expected source', () => {}, /Expected source MIDI SHA-256/, {
    expected: {sourceSha256: '0'.repeat(64)},
  });
  rejected('release-tail overlap', document => {
    const firstHeader = document.array.values[2];
    const firstNote = document.array.values[firstHeader.X];
    const secondNote = document.array.values[firstHeader.X + 1];
    secondNote.X = firstNote.Y;
  }, /overlaps the reserved release tail/);

  // Reuse the exhaustive, game-facing Viva fixture against the generic path.
  // This covers physics-root placement, object-scoped request/ack, automatic
  // offering, direct ArrayVarRef transport, the missing manual button and every
  // serialized note. A second build proves that generic packaging is stable.
  const buildOptions = {
    scoreFile: SCORE_FILE,
    title: 'Viva La Vida - Piano and Violin Duet',
    buildName: 'SQM1 Generic Song Cartridge Regression',
    description: 'Generic SQM1 song-cartridge builder regression fixture.',
    preferredMode: 0,
    expected: EXPECTED,
  };
  const first = buildSongCartridge(buildOptions);
  first.constants.TITLE = buildOptions.title;
  first.constants.SOURCE_MIDI_SHA256 = EXPECTED.sourceSha256;
  require('./test-sqm1-viva-la-vida-cartridge-v1.cjs')(first);
  const second = buildSongCartridge(buildOptions);
  assert.deepEqual(second.bytes, first.bytes, 'Generic cartridge build is deterministic');

  console.log('Generic SQM1 cartridge helper checks passed: valid metadata accepted; '
    + 'bad magic, zero duration, over-cap voice count, malformed offsets, metadata drift, '
    + 'wrong source identity and release-tail overlap rejected; full Viva packaging regression '
    + 'and byte determinism passed.');
  return {statistics: valid.statistics, rejectedCases: 7, bytes: first.bytes.length};
};

if (require.main === module) module.exports();
