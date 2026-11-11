'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const arranger = require('./sqm1-pitch-continuity-arranger.cjs');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');

const HERE = __dirname;
const V3_FILE = path.join(HERE, 'undertale-his-theme-single-quat-score-v3.json');
const V4_FILE = path.join(HERE, 'undertale-his-theme-single-quat-score-v4.json');

function lanes(document) {
  const values = document.array.values;
  return Array.from({length: values[0].Z}, (_, voice) => {
    const header = values[2 + voice];
    return structuredClone(values.slice(header.X, header.X + header.Y));
  });
}

function restoreOriginalNotes(document) {
  const notes = [];
  const identities = new Map();
  for (const [sourceVoice, lane] of lanes(document).entries()) {
    lane.forEach((value, sourceIndex) => {
      const note = {start: value.X, end: value.Y, pitch: value.Z, velocity: value.W,
        sourceVoice, sourceIndex};
      notes.push(note);
      const key = JSON.stringify([note.start, note.end, note.pitch, note.velocity]);
      if (!identities.has(key)) identities.set(key, []);
      identities.get(key).push(note);
    });
  }
  const restored = new Set();
  for (const record of document.arrangement.shortenedNoteRecords) {
    const key = JSON.stringify([record.startSeconds, record.arrangedEndSeconds,
      record.midiNote, record.velocity]);
    const note = (identities.get(key) || []).find(candidate => !restored.has(candidate));
    assert(note, `restore ${key}`);
    restored.add(note);
    assert.equal(arranger.roundSeconds(record.originalEndSeconds - note.end),
      record.secondsRemoved);
    note.end = record.originalEndSeconds;
  }
  assert.equal(restored.size, document.arrangement.shortenedNoteRecords.length);
  return notes.sort((a, b) => a.start - b.start || a.end - b.end
    || a.pitch - b.pitch || a.velocity - b.velocity
    || a.sourceVoice - b.sourceVoice || a.sourceIndex - b.sourceIndex);
}

function run() {
  const v3 = JSON.parse(fs.readFileSync(V3_FILE, 'utf8'));
  const v4 = JSON.parse(fs.readFileSync(V4_FILE, 'utf8'));
  const originalNotes = restoreOriginalNotes(v3);
  const first = arranger.buildScore(originalNotes, v3.source, {
    maxVoices: 24,
    releaseTailSeconds: 0.2,
    instrumentCode: v3.voices[0].instrumentCode,
    channel: v3.voices[0].channel,
    track: v3.voices[0].track,
    timing: v3.timing,
    warnings: v3.warnings,
    sourceDocument: v3,
  });
  assert.deepEqual(first.document.array.values, v4.array.values,
    'general allocator reproduces exact His Theme V4 score array');
  assert.deepEqual(first.document.voices, v4.voices, 'exact V4 voice table metadata');
  assert.deepEqual(first.arrangement.shortenedRecords,
    v4.arrangement.shortenedNoteRecords, 'exact V4 cuts and sustain loss');
  assert.deepEqual(first.arrangement.transitionMetrics,
    v4.arrangement.transitionMetrics, 'exact V4 pitch-continuity metrics');
  assert.equal(first.report.activeVoices, 24);
  assert.equal(first.report.preservedNoteOnsets, 1936);
  assert.equal(first.report.shortenedHeldNotes, 358);
  assert.equal(first.report.totalHeldSecondsRemoved, 216.100795475);
  assert.equal(first.report.transitionMetrics.jumpsAtLeast12Semitones, 162);
  assert.equal(first.report.transitionMetrics.shortGapJumpsAtLeast24Semitones, 2);
  assert.equal(first.report.qualityLabel, 'sustain-trimmed');
  assert.equal(first.report.playerSelectedInstrument, true);
  buildSongCartridge.validateScoreDocument(first.document, {
    maxActiveVoices: 24,
    maxArrayEntries: 65536,
  });

  const second = arranger.buildScore(originalNotes, v3.source, {
    maxVoices: 24, releaseTailSeconds: 0.2,
    instrumentCode: 0, channel: 0, track: 0,
  });
  const third = arranger.buildScore(originalNotes, v3.source, {
    maxVoices: 24, releaseTailSeconds: 0.2,
    instrumentCode: 0, channel: 0, track: 0,
  });
  assert.deepEqual(second, third, 'quality allocation is deterministic');

  const folded = arranger.buildScore([
    {startSeconds: 0, endSeconds: 1, pitch: 18, velocity: 90},
    {startSeconds: 0, endSeconds: 1, pitch: 120, velocity: 91},
    {startSeconds: 1.2, endSeconds: 2, pitch: 60, velocity: 92},
  ], {filename: 'fold.mid', sha256: '0'.repeat(64), trackCount: 1}, {
    maxVoices: 24, releaseTailSeconds: 0.2,
  });
  assert.deepEqual(folded.arrangement.foldedRecords.map(item => item.arrangedMidiNote),
    [30, 108]);
  assert.equal(folded.report.preservedNoteOnsets, 3);
  assert.equal(folded.report.shortenedHeldNotes, 0);
  assert.equal(folded.report.qualityLabel, 'octave-folded');
  assert.deepEqual(folded.document.array.values[1], {X: 34, Y: 0.2, Z: 30, W: 108});

  // Exercise the polynomial fallback with a 13-note onset twice. The second
  // chord reverses pitch order but must retain all onsets without cuts.
  const large = [];
  for (let index = 0; index < 13; index++) {
    large.push({start: 0, end: 0.5, pitch: 48 + index, velocity: 80 + index});
    large.push({start: 0.8, end: 1.3, pitch: 72 - index, velocity: 80 + index});
  }
  const largeResult = arranger.arrange(large, {maxVoices: 24, releaseTailSeconds: 0.2});
  assert.equal(largeResult.lanes.length, 13);
  assert.equal(largeResult.notes.length, 26);
  assert.equal(largeResult.shortenedRecords.length, 0);
  assert.equal(largeResult.transitionMetrics.transitions, 13);

  assert.throws(() => arranger.arrange(Array.from({length: 25}, (_, index) => ({
    start: 0, end: 1, pitch: 40 + (index % 60), velocity: 90,
  }))), /25 notes/);
  assert.throws(() => arranger.arrange([
    {start: 0, end: 1, pitch: 60, velocity: 90},
  ], {maxVoices: 25}), /1 to 24/);
  assert.throws(() => arranger.arrange([
    {start: 0, end: 1, pitch: 36, velocity: 100, channel: 9},
  ]), /percussion-channel/);
  const percussion = arranger.buildScore([
    {start: 0, end: 1, pitch: 36, velocity: 100, channel: 9, program: 10, track: 2},
  ], {filename: 'drums.mid', sha256: '1'.repeat(64), trackCount: 3}, {
    percussionPolicy: 'include', instrumentCode: 0, channel: 0, track: 0,
  });
  assert.equal(percussion.report.qualityLabel, 'percussion-flattened');
  assert.equal(percussion.report.percussionNotes, 1);
  assert.equal(percussion.document.voices[0].instrumentCode, 0,
    'percussion is explicitly flattened to player-selected instrument');
  assert.equal(percussion.document.voices[0].channelTrackCode, 0);
  assert.throws(() => arranger.arrange(Array(65503).fill({
    start: 0, end: 1, pitch: 60, velocity: 90,
  })), /65537 array entries/);

  console.log('SQM1 pitch-continuity arranger checks passed: exact His Theme V4 allocation, '
    + '1,936 preserved onsets, exact 358-cut sustain budget, octave folding, deterministic '
    + '24-lane score encoding, polynomial large-chord assignment and production validation.');
  return {first, folded, largeResult};
}

module.exports = run;
module.exports.restoreOriginalNotes = restoreOriginalNotes;

if (require.main === module) run();
