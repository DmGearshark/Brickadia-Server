'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');

const SCORE_DEFAULT = path.join(__dirname,
  'undertale-megalovania-piano-single-quat-score.json');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-megalovania-cartridge-v1.brz');
const TEMPLATE_DEFAULT = buildSongCartridge.constants.TEMPLATE_DEFAULT;
const TITLE = 'Megalovania - Piano Ver. 3';
const BUILD_NAME = 'SQM1 Megalovania Piano Cartridge V1';
const SOURCE_MIDI_SHA256 =
  'a8cbc69ea2335f828bce54b13246f459107d1990488710e199ecc41b8c3d9d21';
const EXPECTED = Object.freeze({
  sourceSha256: SOURCE_MIDI_SHA256,
  notes: 1816,
  arrayEntries: 1850,
  durationSeconds: 155.992708333,
  activeVoices: 16,
  releaseTailSeconds: 0.2,
  minimumPitch: 34,
  maximumPitch: 93,
});
const DESCRIPTION = 'Physics-root automatic cartridge containing the complete '
  + '1,816-note Megalovania Piano Ver. 3 arrangement. It offers one '
  + '1,850-Quaternion, 16-voice SQM1 score with a full 0.20-second release '
  + 'reservation and is consumed only after the compatible player commits it.';

function validateSourceAndStatistics(score) {
  const {document, values, statistics} = score;
  assert.equal(document.source.filename, 'undertale-megalovania-piano-ver-3.mid',
    'Source MIDI filename');
  assert.equal(document.source.sha256, SOURCE_MIDI_SHA256, 'Source MIDI SHA-256');
  assert.equal(document.source.midiFormat, 1, 'Source MIDI format');
  assert.equal(document.source.trackCount, 2, 'Source MIDI track count');
  assert.deepEqual(document.source.trackNames, ['Piano', 'Piano'],
    'Source MIDI track names');
  assert.equal(document.maximumVoices, 32, 'SQM1 maximum voices');
  assert.equal(document.voiceLimit, 18, 'Target player voice limit');
  assert.equal(document.activeVoices, 16, 'Megalovania active voices');
  assert.equal(document.releaseTailSeconds, 0.2, 'Full release reservation');
  assert.deepEqual(document.playableMidiRange, [30, 108], 'Player MIDI range');
  assert.deepEqual(document.flags, {
    absoluteSeconds: true,
    sustainResolved: true,
    releaseTailReserved: true,
    trueKeyOffInNoteEnd: true,
    stableInstrumentPerVoice: true,
  }, 'Converter guarantees');
  assert.deepEqual(document.timing, {
    mode: 'ticksPerQuarter',
    division: 480,
    tempoMap: [{
      tick: 0,
      seconds: 0,
      microsecondsPerQuarter: 500000,
      bpm: 120,
    }],
  }, 'Source MIDI tempo map');
  assert.deepEqual(document.warnings, {
    unmatchedNoteOffs: 0,
    danglingNotesClosedAtEnd: 0,
    zeroLengthNotesExtendedOneTick: 29,
  }, 'Known source repairs');
  assert.deepEqual(document.statistics, {
    notes: 1816,
    durationSeconds: 155.992708333,
    arrayEntries: 1850,
    minimumPitch: 34,
    maximumPitch: 93,
    allocatedVoices: 16,
    maximumKeyDownPolyphony: 5,
    maximumReservedPolyphony: 14,
    instrumentGroups: 2,
    droppedOutOfRangeNotes: 0,
  }, 'Exact source statistics');
  assert.deepEqual(statistics, {
    notes: 1816,
    arrayEntries: 1850,
    activeVoices: 16,
    durationSeconds: 155.992708333,
    releaseTailSeconds: 0.2,
    minimumPitch: 34,
    maximumPitch: 93,
  }, 'Validated SQM1 statistics');
  assert.deepEqual(values[0], {X: 7701001, Y: 1, Z: 16, W: 155.992708333},
    'SQM1 global header');
  assert.deepEqual(values[1], {X: 34, Y: 0.2, Z: 34, W: 93},
    'SQM1 format header');
  assert.equal(document.voices.length, 16, 'Voice metadata rows');
  assert.equal(document.voices.reduce((sum, voice) => sum + voice.count, 0), 1816,
    'Voice metadata note count');
  return score;
}

function loadScore(scoreFile = SCORE_DEFAULT) {
  return validateSourceAndStatistics(buildSongCartridge.loadScore(scoreFile, {
    maxActiveVoices: 18,
    expected: EXPECTED,
  }));
}

function build(scoreFile = SCORE_DEFAULT, templateFile = TEMPLATE_DEFAULT) {
  const score = loadScore(scoreFile);
  const context = buildSongCartridge({
    scoreDocument: score.document,
    scoreFile,
    templateFile,
    title: TITLE,
    buildName: BUILD_NAME,
    description: DESCRIPTION,
    preferredMode: 0,
    maxActiveVoices: 18,
    expected: EXPECTED,
  });
  validateSourceAndStatistics(context.score);
  return {
    ...context,
    constants: {
      ...context.constants,
      TITLE,
      BUILD_NAME,
      SOURCE_MIDI_SHA256,
      EXPECTED,
      SCORE_DEFAULT,
      TEMPLATE_DEFAULT,
      OUTPUT_DEFAULT,
      DESCRIPTION,
    },
  };
}

build.build = build;
build.loadScore = loadScore;
build.validateSourceAndStatistics = validateSourceAndStatistics;
build.constants = {
  TITLE, BUILD_NAME, SOURCE_MIDI_SHA256, EXPECTED,
  SCORE_DEFAULT, TEMPLATE_DEFAULT, OUTPUT_DEFAULT, DESCRIPTION,
};
module.exports = build;

if (require.main === module) {
  const [outputFile = OUTPUT_DEFAULT, scoreFile = SCORE_DEFAULT,
    templateFile = TEMPLATE_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(scoreFile, templateFile);
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, context.bytes);
    console.log(JSON.stringify({
      outputFile,
      bytes: context.bytes.length,
      bricks: context.scene.bricks.length,
      wires: context.scene.edges.length,
      title: TITLE,
      sourceSha256: SOURCE_MIDI_SHA256,
      ...context.score.statistics,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/')
        && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
