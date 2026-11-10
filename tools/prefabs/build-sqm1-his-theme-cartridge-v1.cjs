'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');

const SCORE_DEFAULT = path.join(__dirname,
  'undertale-his-theme-single-quat-score.json');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-his-theme-cartridge-v1.brz');
const TEMPLATE_DEFAULT = buildSongCartridge.constants.TEMPLATE_DEFAULT;
const TITLE = 'His Theme - Toby Fox';
const BUILD_NAME = 'SQM1 His Theme Cartridge V1';
const SOURCE_MIDI_SHA256 =
  '3c10cd933c76a6974484408208c6a21dc36fe07b2e281abd0c30117f6c2007a7';
const EXPECTED = Object.freeze({
  sourceSha256: SOURCE_MIDI_SHA256,
  notes: 1936,
  arrayEntries: 1970,
  durationSeconds: 313.654575154,
  activeVoices: 18,
  releaseTailSeconds: 0.12,
  minimumPitch: 30,
  maximumPitch: 105,
});
const DESCRIPTION = 'Physics-root automatic cartridge containing the complete '
  + '1,936-onset His Theme piano arrangement. Dense held notes are fitted to '
  + 'the 18-voice SQM1 player while preserving every onset; eight sub-range '
  + 'bass notes are octave-folded. The cartridge is consumed only after the '
  + 'compatible player commits it.';

function validateSourceAndStatistics(score) {
  const {document, values, statistics} = score;
  assert.deepEqual(document.source, {
    filename: 'undertale-his-theme-toby-fox.mid',
    sha256: SOURCE_MIDI_SHA256,
    midiFormat: 1,
    trackCount: 2,
    trackNames: ['Piano', 'Piano'],
  }, 'Source MIDI identity');
  assert.equal(document.maximumVoices, 32, 'SQM1 maximum voices');
  assert.equal(document.voiceLimit, 18, 'Target player voice limit');
  assert.equal(document.activeVoices, 18, 'His Theme active voices');
  assert.equal(document.releaseTailSeconds, 0.12, 'Release reservation');
  assert.deepEqual(document.playableMidiRange, [30, 108], 'Player MIDI range');
  assert.deepEqual(document.warnings, {
    unmatchedNoteOffs: 0,
    danglingNotesClosedAtEnd: 0,
    zeroLengthNotesExtendedOneTick: 0,
  }, 'MIDI resolution warnings');
  assert.deepEqual(document.statistics, {
    notes: 1936,
    durationSeconds: 313.654575154,
    arrayEntries: 1970,
    minimumPitch: 30,
    maximumPitch: 105,
    allocatedVoices: 18,
    maximumKeyDownPolyphony: 18,
    maximumReservedPolyphony: 18,
    instrumentGroups: 1,
    droppedOutOfRangeNotes: 0,
  }, 'Exact arranged score statistics');
  assert.deepEqual(statistics, {
    notes: 1936,
    arrayEntries: 1970,
    activeVoices: 18,
    durationSeconds: 313.654575154,
    releaseTailSeconds: 0.12,
    minimumPitch: 30,
    maximumPitch: 105,
  }, 'Validated SQM1 statistics');
  assert.deepEqual(values[0], {X: 7701001, Y: 1, Z: 18, W: 313.654575154},
    'SQM1 global header');
  assert.deepEqual(values[1], {X: 34, Y: 0.12, Z: 30, W: 105},
    'SQM1 format header');
  assert.equal(document.voices.length, 18, 'Voice metadata rows');
  assert.equal(document.voices.reduce((sum, voice) => sum + voice.count, 0), 1936,
    'Voice metadata note count');

  const arrangement = document.arrangement;
  assert(arrangement, 'Arrangement metadata');
  assert.equal(arrangement.mode, 'oldest-held-note-reuse');
  assert.equal(arrangement.originalNotes, 1936);
  assert.equal(arrangement.preservedNoteOnsets, 1936);
  assert.equal(arrangement.originalTrackCount, 2);
  assert.equal(arrangement.mergedTrack, 0);
  assert.equal(arrangement.octaveFoldedNotes, 8);
  assert.equal(arrangement.shortenedHeldNotes, 651);
  assert.equal(arrangement.totalHeldSecondsRemoved, 488.026593986);
  assert.equal(arrangement.largestSimultaneousOnset, 5);
  assert.equal(arrangement.originalMaximumKeyDownPolyphony, 48);
  assert.equal(arrangement.arrangedMaximumKeyDownPolyphony, 18);
  assert.equal(arrangement.arrangedMaximumReservedPolyphony, 18);
  assert.equal(arrangement.foldedPitchRecords.length, 8);
  assert.equal(arrangement.shortenedNoteRecords.length, 651);
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
