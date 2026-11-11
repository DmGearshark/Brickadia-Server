'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const converter = require('./sqm1-midi-cartridge-converter.cjs');
const validatePlacement = require('./validate-placement.cjs');

const HERE = __dirname;
const REPOSITORY = path.join(HERE, '..', '..');
const TEMPLATE = path.join(REPOSITORY, 'prefabs', 'sqm1-auto-zone-test-cartridge-v1.brz');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function vlq(value) {
  const bytes = [value & 0x7f];
  for (value >>= 7; value; value >>= 7) bytes.push(0x80 | (value & 0x7f));
  return Buffer.from(bytes.reverse());
}

function smallMidi() {
  const events = Buffer.concat([
    vlq(0), Buffer.from([0xff, 0x51, 3, 0x07, 0xa1, 0x20]),
    vlq(0), Buffer.from([0xc0, 0]),
    vlq(0), Buffer.from([0x90, 60, 100]),
    vlq(480), Buffer.from([0x80, 60, 0]),
    vlq(0), Buffer.from([0xff, 0x2f, 0]),
  ]);
  const header = Buffer.alloc(14);
  header.write('MThd');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);
  const track = Buffer.alloc(8);
  track.write('MTrk');
  track.writeUInt32BE(events.length, 4);
  return Buffer.concat([header, track, events]);
}

function findNamed(root, basename) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.name === basename) return candidate;
    }
  }
  return null;
}

function testPortableEndToEnd() {
  const bytes = smallMidi();
  const templateBytes = fs.readFileSync(TEMPLATE);
  const options = {
    bytes,
    filename: 'small-test.mid',
    title: 'Small Test',
    templateBytes,
  };
  const first = converter.convertMidiToCartridge(options);
  const second = converter.convertMidiToCartridge(options);
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes),
    'end-to-end cartridge output is deterministic');
  assert.equal(first.preset, 'v4-quality');
  assert.equal(first.filename, 'small-test-sqm1-cartridge.brz');
  assert.equal(first.source.sha256, sha256(bytes));
  assert.equal(first.score.source.sha256, sha256(bytes));
  assert.equal(first.score.timing.mode, 'ticksPerQuarter');
  assert.deepEqual(first.score.warnings, {
    unmatchedNoteOffs: 0,
    danglingNotesClosedAtEnd: 0,
    zeroLengthNotesExtendedOneTick: 0,
  });
  assert.equal(first.report.notes, 1);
  assert.equal(first.report.activeVoices, 1);
  assert.equal(first.report.durationSeconds, 0.5);
  assert.equal(first.report.qualityLabel, 'lossless');
  assert.equal(first.score.array.values.length, 35);
  assert(validatePlacement(first.bytes).strictOk, 'generated cartridge has strict placement');

  const adapter = converter.createConverterAdapter({templateBytes});
  const throughFactory = adapter.convertMidiToCartridge({
    bytes, filename: 'small-test.mid', title: 'Small Test',
    options: {voiceLimit: 1, releaseTailSeconds: 0.2},
  });
  assert.deepEqual(Buffer.from(throughFactory.bytes), Buffer.from(first.bytes));

  const strict = converter.convertMidiToScore({
    bytes, filename: 'small-test.mid', preset: 'strict',
  });
  assert.equal(strict.report.qualityLabel, 'strict-canonical');
  assert.equal(strict.score.array.values[34].Z, 60);
  assert.equal(strict.score.array.values[34].W, 100);

  assert.throws(() => converter.convertMidiToScore({...options, maxVoices: 25}), /1 to 24/);
  assert.throws(() => converter.convertMidiToScore({...options,
    maxArrayEntries: 65_537}), /34 to 65536/);
  assert.throws(() => converter.convertMidiToScore({...options,
    maxInputBytes: 32 * 1024 * 1024 + 1}), /14 to 33554432/);
  assert.throws(() => converter.convertMidiToScore({...options, channel: 16}),
    /channel.*0 to 15/i);
  assert.throws(() => converter.convertMidiToScore({...options, track: -1}),
    /track.*non-negative/i);
  assert.throws(() => converter.convertMidiToScore({...options, maxArrayEntries: 34}),
    /35 array entries|capacity/);
  assert.throws(() => converter.convertMidiToScore({...options,
    maxInputBytes: bytes.length - 1}), /bytes.*limit/);
  assert.throws(() => converter.convertMidiToCartridge({...options, templateBytes: null}),
    /template.*Uint8Array/i);
  assert.throws(() => converter.convertMidiToScore({...options, preset: 'mystery'}),
    /Unknown conversion preset/);
  return {bytes: first.bytes.length, sha256: sha256(first.bytes)};
}

function testKnownSongs() {
  const attachmentRoot = '/workspace/attachments';
  const cases = [
    {
      label: 'Megalovania',
      midi: 'undertale-megalovania-piano-ver-3.mid',
      score: 'undertale-megalovania-piano-single-quat-score.json',
      hash: 'a8cbc69ea2335f828bce54b13246f459107d1990488710e199ecc41b8c3d9d21',
      notes: 1816,
      voices: 16,
    },
    {
      label: 'Viva la Vida',
      midi: 'viva-la-vida-coldplay-viva-la-vida-piano-violin-duet.mid',
      score: 'viva-la-vida-single-quat-score.json',
      hash: 'a4f6ac10e617b39d89ff478ff1c6b88aabd08d561e592d5d30486112f54c2e06',
      notes: 3430,
      voices: 18,
    },
  ];
  const templateBytes = fs.readFileSync(TEMPLATE);
  const results = [];
  for (const fixture of cases) {
    const midiFile = findNamed(attachmentRoot, fixture.midi);
    if (!midiFile) continue;
    const bytes = fs.readFileSync(midiFile);
    const reference = JSON.parse(fs.readFileSync(path.join(HERE, fixture.score), 'utf8'));
    const strict = converter.convertMidiToCartridge({
      bytes,
      filename: fixture.midi,
      title: fixture.label,
      preset: 'strict',
      templateBytes,
    });
    assert.equal(strict.source.sha256, fixture.hash);
    assert.equal(strict.report.notes, fixture.notes);
    assert.equal(strict.report.activeVoices, fixture.voices);
    assert.deepEqual(strict.score.array.values, reference.array.values,
      `${fixture.label} strict preset preserves the canonical score exactly`);
    assert(validatePlacement(strict.bytes).strictOk,
      `${fixture.label} cartridge has strict placement`);
    results.push({label: fixture.label, notes: strict.report.notes,
      voices: strict.report.activeVoices, cartridgeBytes: strict.bytes.length});
  }

  const hisMidi = 'undertale-his-theme-toby-fox.mid';
  const hisFile = findNamed(attachmentRoot, hisMidi);
  if (hisFile) {
    const bytes = fs.readFileSync(hisFile);
    const reference = JSON.parse(fs.readFileSync(path.join(HERE,
      'undertale-his-theme-single-quat-score-v4.json'), 'utf8'));
    const options = {
      bytes,
      filename: hisMidi,
      title: 'His Theme',
      templateBytes,
    };
    const first = converter.convertMidiToCartridge(options);
    const second = converter.convertMidiToCartridge(options);
    assert.equal(first.source.sha256,
      '3c10cd933c76a6974484408208c6a21dc36fe07b2e281abd0c30117f6c2007a7');
    assert.deepEqual(first.score.array.values, reference.array.values,
      'raw His Theme MIDI reproduces the complete approved V4 score array');
    assert.equal(first.report.activeVoices, 24);
    assert.equal(first.report.preservedNoteOnsets, 1936);
    assert.equal(first.report.shortenedHeldNotes, 358);
    assert.equal(first.report.totalHeldSecondsRemoved, 216.100795475);
    assert.equal(first.report.transitionMetrics.jumpsAtLeast12Semitones, 162);
    assert.equal(first.report.transitionMetrics.shortGapJumpsAtLeast24Semitones, 2);
    assert.equal(first.report.octaveFoldedNotes, 8);
    assert.equal(first.report.maximumVoices, 24);
    assert(first.score.timing.tempoMap.length > 1, 'tempo map embedded in score');
    assert.equal(first.score.warnings.unsupportedEvents.total, 4,
      'MIDI warning diagnostics embedded in score');
    assert(validatePlacement(first.bytes).strictOk, 'His Theme cartridge has strict placement');
    assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes),
      'His Theme prefab is deterministic');
    assert.throws(() => converter.convertMidiToScore({...options, preset: 'strict'}),
      /range|MIDI 21|MIDI 26/);
    results.push({label: 'His Theme', notes: first.report.notes,
      voices: first.report.activeVoices, cartridgeBytes: first.bytes.length});
  }
  return {available: results.length, results};
}

function testCli() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqm1-converter-cli-'));
  try {
    const input = path.join(directory, 'tiny.mid');
    const output = path.join(directory, 'tiny.brz');
    const report = path.join(directory, 'tiny-report.json');
    fs.writeFileSync(input, smallMidi());
    const stdout = execFileSync(process.execPath, [
      path.join(HERE, 'sqm1-midi-cartridge-converter.cjs'),
      input,
      output,
      '--title', 'CLI Tiny',
      '--report', report,
    ], {encoding: 'utf8'});
    const summary = JSON.parse(stdout);
    assert.equal(summary.title, 'CLI Tiny');
    assert.equal(summary.preset, 'v4-quality');
    assert.equal(summary.report.notes, 1);
    assert.equal(summary.reportFile, report);
    assert(fs.statSync(output).size > 1_000);
    assert(validatePlacement(output).strictOk, 'CLI output has strict placement');
    const written = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(written.source.sha256, sha256(smallMidi()));
    assert.match(converter.cliHelp?.() || '', /input\.mid/);
    assert.deepEqual(converter.parseCliArguments([
      'in.mid', 'out.brz', '--preset', 'strict', '--max-voices', '18',
      '--release-tail', '0.1', '--report', 'report.json',
    ]), {
      preset: 'strict',
      maxVoices: 18,
      releaseTailSeconds: 0.1,
      reportFile: 'report.json',
      inputFile: 'in.mid',
      outputFile: 'out.brz',
    });
    return {outputBytes: fs.statSync(output).size};
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

function test() {
  const portable = testPortableEndToEnd();
  const known = testKnownSongs();
  const cli = testCli();
  if (process.env.SQM1_REQUIRE_KNOWN_MIDIS === '1') {
    assert.equal(known.available, 3,
      'all three user-supplied MIDI fixtures are required for release acceptance');
  }
  console.log('SQM1 MIDI cartridge adapter checks passed: browser-safe byte API, exact V4 '
    + 'pitch-continuity parity, strict canonical parity, deterministic automatic prefabs, '
    + '24-voice/capacity enforcement, strict placement and Node CLI reporting.');
  console.log(JSON.stringify({portable, known, cli}, null, 2));
  return {portable, known, cli};
}

module.exports = test;

if (require.main === module) test();
