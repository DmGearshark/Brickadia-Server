'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {parseScore, build, verify} = require('./build-single-quat-midi-player.cjs');

const q = (X, Y, Z, W) => ({X, Y, Z, W});

function fixture() {
  const values = [
    q(7701001, 1, 2, 1.2),
    q(34, 0.2, 60, 72),
    q(34, 2, 0, 0),
    q(36, 1, 40, 1),
  ];
  while (values.length < 34) values.push(q(37, 0, -1, -1));
  values.push(
    q(0, 0.5, 60, 100),
    q(0.8, 1.2, 64, 90),
    q(0, 1, 72, 80),
  );
  return {
    schema: 'brickadia-midi-single-quat-array',
    version: 1,
    source: {filename: 'synthetic-sine-test.mid'},
    maximumVoices: 32,
    activeVoices: 2,
    releaseTailSeconds: 0.2,
    flags: {releaseTailReserved: true},
    array: {elementType: 'Quat', values},
  };
}

function withScore(raw, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brickadia-midi-test-'));
  const file = path.join(directory, 'score.json');
  try {
    fs.writeFileSync(file, JSON.stringify(raw));
    return callback(file);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

withScore(fixture(), file => {
  const score = parseScore(file);
  assert.equal(score.totalNotes, 3);
  assert.equal(score.activeVoices, 2);
  assert.equal(score.releaseTail, 0.2);

  const first = build(score);
  const checked = verify(score, first);
  const second = build(score);
  assert(Buffer.from(first.bytes).equals(Buffer.from(second.bytes)),
    'identical scores must build byte-for-byte deterministically');
  assert.equal(checked.arrays, 1);
  assert.equal(checked.emitters, 4, 'three piano sine layers plus one second-instrument sine');
  assert.equal(checked.getters, 2);
  assert.equal(checked.splits, 2);
  assert.equal(checked.placement.strictOk, true);
  assert.deepEqual(first.externalAssets, [
    {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'},
  ]);
});

const overlapping = fixture();
overlapping.array.values[35].X = 0.6;
withScore(overlapping, file => {
  assert.throws(() => parseScore(file), /reserved release tail/);
});

const outOfRange = fixture();
outOfRange.array.values[34].Z = 29;
outOfRange.array.values[1].Z = 29;
withScore(outOfRange, file => {
  assert.throws(() => parseScore(file), /outside 0\.1\.\.10/);
});

console.log('single-quat MIDI builder tests passed');
