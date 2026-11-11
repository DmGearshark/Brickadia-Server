'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const midi = require('./sqm1-midi-converter-core.cjs');

function vlq(value) {
  assert(Number.isInteger(value) && value >= 0 && value <= 0x0fffffff);
  const encoded = [value & 0x7f];
  for (value >>= 7; value; value >>= 7) encoded.push(0x80 | (value & 0x7f));
  return Buffer.from(encoded.reverse());
}

function track(events, endTick = undefined) {
  const stable = events.map((event, index) => ({...event, index}))
    .sort((a, b) => a.tick - b.tick || a.index - b.index);
  const pieces = [];
  let prior = 0;
  for (const event of stable) {
    pieces.push(vlq(event.tick - prior), Buffer.from(event.data));
    prior = event.tick;
  }
  endTick ??= prior;
  pieces.push(vlq(endTick - prior), Buffer.from([0xff, 0x2f, 0]));
  const payload = Buffer.concat(pieces);
  const header = Buffer.alloc(8);
  header.write('MTrk');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function smf(tracks, division = 480, format = tracks.length === 1 ? 0 : 1) {
  const header = Buffer.alloc(14);
  header.write('MThd');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(format, 8);
  header.writeUInt16BE(tracks.length, 10);
  header.writeUInt16BE(division, 12);
  return Buffer.concat([header, ...tracks]);
}

const tempo = value => Buffer.from([0xff, 0x51, 3,
  (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);

function comprehensiveFixture() {
  const conductor = track([
    {tick: 0, data: [0xff, 3, 9, ...Buffer.from('Conductor')]},
    {tick: 0, data: tempo(500_000)},
    {tick: 480, data: tempo(750_000)},
  ], 1200);
  const piano = track([
    {tick: 0, data: [0xff, 3, 5, ...Buffer.from('Piano')]},
    {tick: 0, data: [0xc0, 0]},
    {tick: 0, data: [0xb0, 64, 127]},
    {tick: 0, data: [0x90, 60, 100]},
    {tick: 120, data: [64, 90]}, // running note-on
    {tick: 240, data: [0x80, 60, 0]},
    {tick: 360, data: [64, 0]}, // running note-off
    {tick: 480, data: [0xb0, 64, 0]},
    {tick: 480, data: [0x90, 67, 80]},
    {tick: 720, data: [0xb0, 123, 0]},
  ], 1200);
  const strings = track([
    {tick: 0, data: [0xff, 3, 7, ...Buffer.from('Strings')]},
    {tick: 0, data: [0xc1, 40]},
    {tick: 480, data: [0x91, 55, 70]},
    {tick: 960, data: [0x81, 55, 0]},
  ], 1200);
  return smf([conductor, piano, strings]);
}

function testParserAndResolution() {
  const data = comprehensiveFixture();
  const parsed = midi.parseMidi(data);
  assert.deepEqual({format: parsed.midiFormat, tracks: parsed.trackCount,
    division: parsed.division, names: parsed.trackNames},
  {format: 1, tracks: 3, division: 480, names: ['Conductor', 'Piano', 'Strings']});
  const {notes, resolution} = midi.resolveNotes(parsed);
  assert.deepEqual(notes.map(note => ({pitch: note.pitch, program: note.program,
    start: note.startTick, end: note.endTick, track: note.track})), [
    {pitch: 60, program: 0, start: 0, end: 480, track: 1},
    {pitch: 64, program: 0, start: 120, end: 480, track: 1},
    {pitch: 67, program: 0, start: 480, end: 720, track: 1},
    {pitch: 55, program: 40, start: 480, end: 960, track: 2},
  ]);
  assert.deepEqual(resolution.timing.tempoMap, [
    {tick: 0, seconds: 0, microsecondsPerQuarter: 500000, bpm: 120},
    {tick: 480, seconds: 0.5, microsecondsPerQuarter: 750000, bpm: 80},
  ]);
  assert.deepEqual(resolution.warnings, {unmatchedNoteOffs: 0,
    danglingNotesClosedAtEnd: 0, zeroLengthNotesExtendedOneTick: 0});
}

function testNanosecondHalfEvenRounding() {
  // With 512 ticks per quarter at 120 BPM, one tick is exactly 1/1024
  // second: 976562.5 ns. The first tie rounds to the even lower nanosecond;
  // three ticks (2929687.5 ns) round to the even upper nanosecond.
  const data = smf([track([
    {tick: 0, data: [0x90, 60, 100]},
    {tick: 0, data: [0x90, 64, 100]},
    {tick: 1, data: [0x80, 60, 0]},
    {tick: 3, data: [0x80, 64, 0]},
  ], 3)], 512);
  const {notes} = midi.resolveNotes(midi.parseMidi(data));
  assert.deepEqual(notes.map(note => note.endSeconds), [0.000976562, 0.002929688]);
  assert.equal(midi.roundSeconds(14.1191105875), 14.119110587,
    'rounding retains the original binary value side of a decimal half-way point');
}

function testPythonParity() {
  const data = comprehensiveFixture();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sqm1-midi-js-'));
  try {
    const input = path.join(temporary, 'parity.mid');
    const output = path.join(temporary, 'parity.json');
    fs.writeFileSync(input, data);
    execFileSync('python3', [path.join(__dirname, 'convert-midi-single-array.py'),
      input, output, '--max-voices', '24', '--release-tail', '0.2'], {stdio: 'pipe'});
    const python = JSON.parse(fs.readFileSync(output, 'utf8'));
    const javascript = midi.convertMidi(data, {filename: 'parity.mid', maximumVoices: 24,
      releaseTailSeconds: 0.2}).score;
    assert.deepEqual(javascript, python, 'JavaScript score is byte-data-equivalent to Python');
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function testSustainAndChannelModes() {
  const data = smf([track([
    {tick: 0, data: [0xb0, 64, 127]},
    {tick: 0, data: [0x90, 60, 100]},
    {tick: 120, data: [0x80, 60, 0]},
    {tick: 240, data: [0x90, 62, 96]},
    {tick: 360, data: [0xb0, 123, 0]},
    {tick: 480, data: [0xb0, 121, 0]},
    {tick: 720, data: [0xb0, 64, 127]},
    {tick: 720, data: [0x90, 64, 80]},
    {tick: 840, data: [0x80, 64, 0]},
    {tick: 960, data: [0x90, 65, 72]},
    {tick: 1080, data: [0xb0, 120, 0]},
  ], 1200)]);
  const {notes} = midi.resolveNotes(midi.parseMidi(data));
  assert.deepEqual(notes.map(note => [note.pitch, note.startTick, note.endTick]), [
    [60, 0, 480], [62, 240, 480], [64, 720, 1080], [65, 960, 1080],
  ]);
}

function testSmpteAndRealtimeRunningStatus() {
  const division = ((-29 & 0xff) << 8) | 10;
  const data = smf([track([
    {tick: 0, data: [0x90, 60, 100]},
    {tick: 120, data: [0xf8]},
    {tick: 120, data: [62, 80]},
    {tick: 300, data: [0x80, 60, 0]},
    {tick: 300, data: [62, 0]},
  ], 300)], division);
  const result = midi.resolveNotes(midi.parseMidi(data));
  assert.equal(result.resolution.timing.mode, 'smpte');
  assert.deepEqual(result.notes.map(note => [note.pitch, note.startTick, note.endTick]),
    [[60, 0, 300], [62, 120, 300]]);
  assert.equal(result.notes[0].endSeconds, 1.001);
}

function testEncodingPoliciesAndLimits() {
  const voices = smf([track([
    {tick: 0, data: [0xc0, 1]}, {tick: 0, data: [0x90, 60, 100]},
    {tick: 96, data: [0x80, 60, 0]}, {tick: 96, data: [0xc0, 2]},
    {tick: 96, data: [0x90, 61, 100]}, {tick: 192, data: [0x80, 61, 0]},
    {tick: 192, data: [0xc1, 1]}, {tick: 192, data: [0x91, 62, 100]},
    {tick: 288, data: [0x81, 62, 0]}, {tick: 288, data: [0xc9, 0]},
    {tick: 288, data: [0x99, 36, 100]}, {tick: 384, data: [0x89, 36, 0]},
  ], 384)]);
  const converted = midi.convertMidi(voices, {filename: 'voices.mid',
    maximumVoices: 24, releaseTailSeconds: 0});
  assert.equal(converted.score.activeVoices, 4);
  assert.deepEqual(converted.score.array.values.slice(2, 6).map(value => value.Z),
    [1, 2, 1, 128]);
  assert.equal(converted.report.notes, 4);
  assert.equal(converted.score.source.sha256,
    crypto.createHash('sha256').update(voices).digest('hex'));

  const range = smf([track([
    {tick: 0, data: [0x90, 29, 80]}, {tick: 0, data: [0x90, 60, 100]},
    {tick: 0, data: [0x90, 109, 80]}, {tick: 96, data: [0x80, 29, 0]},
    {tick: 96, data: [0x80, 60, 0]}, {tick: 96, data: [0x80, 109, 0]},
  ], 96)]);
  assert.throws(() => midi.convertMidi(range), /29|109|range/);
  const dropped = midi.convertMidi(range, {outOfRange: 'drop'});
  assert.equal(dropped.report.notes, 1);
  assert.equal(dropped.report.droppedOutOfRangeNotes, 2);

  const events = [];
  for (let pitch = 40; pitch < 65; pitch++) events.push({tick: 0, data: [0x90, pitch, 80]});
  for (let pitch = 40; pitch < 65; pitch++) events.push({tick: 480, data: [0x80, pitch, 0]});
  const over = smf([track(events, 480)]);
  assert.throws(() => midi.convertMidi(over, {maximumVoices: 24}), /25.*voices|voices.*24/);
}

function testMalformedAndHash() {
  assert.equal(midi.sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => midi.parseMidi(Buffer.from('nope')), /Standard MIDI/);
  const badFormat = Buffer.from(smf([track([], 0)]));
  badFormat.writeUInt16BE(2, 8);
  assert.throws(() => midi.parseMidi(badFormat), /format 2/);
  assert.doesNotThrow(() => midi.parseMidi(Buffer.concat([
    smf([track([], 0)]), Buffer.alloc(32),
  ])));
  assert.throws(() => midi.parseMidi(Buffer.concat([
    smf([track([], 0)]), Buffer.from([0, 0, 1]),
  ])), /Unexpected non-zero data/);
}

function testUnsupportedDiagnosticsAndCaps() {
  const data = smf([track([
    {tick: 0, data: [0xb0, 0, 2]},       // bank select
    {tick: 0, data: [0xb0, 32, 4]},
    {tick: 0, data: [0xb0, 7, 100]},     // channel volume
    {tick: 0, data: [0xb0, 11, 90]},     // expression
    {tick: 0, data: [0xb0, 66, 127]},    // sostenuto
    {tick: 0, data: [0xb0, 1, 30]},      // other controller/mod wheel
    {tick: 0, data: [0xe0, 0, 80]},      // pitch bend
    {tick: 0, data: [0xa0, 60, 50]},     // poly aftertouch
    {tick: 0, data: [0xd0, 40]},         // channel aftertouch
    {tick: 0, data: [0xf0, 2, 1, 2]},    // SysEx
    {tick: 0, data: [0x90, 60, 100]},
    {tick: 96, data: [0x80, 60, 0]},
  ], 96)]);
  const converted = midi.convertMidi(data);
  const warning = converted.report.warnings.unsupportedEvents;
  assert.deepEqual({total: warning.total, pitchBend: warning.pitchBend,
    polyAftertouch: warning.polyAftertouch, channelAftertouch: warning.channelAftertouch,
    systemExclusive: warning.systemExclusive, bankSelect: warning.bankSelect,
    channelVolume: warning.channelVolume, expression: warning.expression,
    sostenuto: warning.sostenuto, otherControllers: warning.otherControllers},
  {total: 10, pitchBend: 1, polyAftertouch: 1, channelAftertouch: 1,
    systemExclusive: 1, bankSelect: 2, channelVolume: 1, expression: 1,
    sostenuto: 1, otherControllers: 1});
  assert.deepEqual(warning.controllers, {0: 1, 1: 1, 7: 1, 11: 1, 32: 1, 66: 1});
  assert.throws(() => midi.convertMidi(data, {strictUnsupported: true}),
    /10 unsupported expressive/);
  assert.throws(() => midi.convertMidi(data, {maxInputBytes: data.length - 1}),
    /bytes.*limit/);
  assert.throws(() => midi.convertMidi(data, {maxArrayEntries: 34}),
    /array entries|capacity/);
}

function test() {
  testParserAndResolution();
  testNanosecondHalfEvenRounding();
  testPythonParity();
  testSustainAndChannelModes();
  testSmpteAndRealtimeRunningStatus();
  testEncodingPoliciesAndLimits();
  testMalformedAndHash();
  testUnsupportedDiagnosticsAndCaps();
  console.log('SQM1 JavaScript MIDI converter core checks passed: format 0/1 parsing, '
    + 'running status, tempo and SMPTE timing, sustain/channel modes, stable instruments, '
    + 'range/voice policies, SHA-256, Python score parity and deterministic validation.');
}

module.exports = test;
module.exports.fixture = {vlq, track, smf, tempo, comprehensiveFixture};

if (require.main === module) test();
