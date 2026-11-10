'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');

const SCORE_DEFAULT = path.join(__dirname,
  'undertale-his-theme-single-quat-score-v4.json');
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-his-theme-pitch-continuity-v4.brz');
const TEMPLATE_DEFAULT = buildSongCartridge.constants.TEMPLATE_DEFAULT;
const TITLE = 'His Theme - Pitch Continuity V4';
const BUILD_NAME = 'SQM1 His Theme Pitch-Continuity Cartridge V4';
const SOURCE_MIDI_SHA256 =
  '3c10cd933c76a6974484408208c6a21dc36fe07b2e281abd0c30117f6c2007a7';
const EXPECTED = Object.freeze({
  sourceSha256: SOURCE_MIDI_SHA256,
  notes: 1936,
  arrayEntries: 1970,
  durationSeconds: 313.654575154,
  activeVoices: 24,
  releaseTailSeconds: 0.2,
  minimumPitch: 30,
  maximumPitch: 105,
});
const EXPECTED_TRANSITIONS = Object.freeze({
  transitions: 1912,
  samePitchTransitions: 1202,
  jumpsAtLeast12Semitones: 162,
  jumpsAtLeast24Semitones: 50,
  jumpsAtLeast36Semitones: 17,
  shortGapSeconds: 0.4,
  shortGapJumpsAtLeast12Semitones: 12,
  shortGapJumpsAtLeast24Semitones: 2,
  maximumJumpSemitones: 60,
  minimumGapSeconds: 0.2,
});
const BASELINE_TRANSITIONS = Object.freeze({
  transitions: 1912,
  samePitchTransitions: 514,
  jumpsAtLeast12Semitones: 686,
  jumpsAtLeast24Semitones: 339,
  jumpsAtLeast36Semitones: 122,
  shortGapSeconds: 0.4,
  shortGapJumpsAtLeast12Semitones: 216,
  shortGapJumpsAtLeast24Semitones: 111,
  maximumJumpSemitones: 63,
  minimumGapSeconds: 0.2,
});
const DESCRIPTION = 'Experimental full-song His Theme cartridge for the 24-lane '
  + 'SQM1 player. It preserves all 1,936 V3 onsets and the exact V3 sustain-loss '
  + 'budget, then assigns notes to the closest previous lane pitch. This isolates '
  + 'large physical-emitter retunes as a cause of buzz-like transition artifacts.';

function validateSourceAndStatistics(score) {
  const {document, values, statistics} = score;
  assert.deepEqual(document.source, {
    filename: 'undertale-his-theme-toby-fox.mid',
    sha256: SOURCE_MIDI_SHA256,
    midiFormat: 1,
    trackCount: 2,
    trackNames: ['Piano', 'Piano'],
  }, 'Source MIDI identity');
  assert.equal(document.maximumVoices, 32);
  assert.equal(document.voiceLimit, 24);
  assert.equal(document.activeVoices, 24);
  assert.equal(document.releaseTailSeconds, 0.2);
  assert.deepEqual(document.playableMidiRange, [30, 108]);
  assert.deepEqual(document.statistics, {
    notes: 1936,
    durationSeconds: 313.654575154,
    arrayEntries: 1970,
    minimumPitch: 30,
    maximumPitch: 105,
    allocatedVoices: 24,
    maximumKeyDownPolyphony: 24,
    maximumReservedPolyphony: 24,
    instrumentGroups: 1,
    droppedOutOfRangeNotes: 0,
  });
  assert.deepEqual(statistics, {
    notes: 1936,
    arrayEntries: 1970,
    activeVoices: 24,
    durationSeconds: 313.654575154,
    releaseTailSeconds: 0.2,
    minimumPitch: 30,
    maximumPitch: 105,
  });
  assert.deepEqual(values[0], {X: 7701001, Y: 1, Z: 24, W: 313.654575154});
  assert.deepEqual(values[1], {X: 34, Y: 0.2, Z: 30, W: 105});
  assert.equal(document.voices.length, 24);
  assert.equal(document.voices.reduce((sum, voice) => sum + voice.count, 0), 1936);

  const arrangement = document.arrangement;
  assert.equal(arrangement.mode, 'pitch-continuity-revoice-from-v3');
  assert.equal(arrangement.sourceScore,
    'undertale-his-theme-single-quat-score-v3.json');
  assert.deepEqual(arrangement.allocationObjectives, [
    'minimum-shortened-note-count',
    'minimum-removed-sustain',
    'minimum-lane-pitch-distance',
  ]);
  assert.equal(arrangement.originalNotes, 1936);
  assert.equal(arrangement.preservedNoteOnsets, 1936);
  assert.equal(arrangement.octaveFoldedNotes, 8);
  assert.equal(arrangement.shortenedHeldNotes, 358);
  assert.equal(arrangement.totalHeldSecondsRemoved, 216.100795475);
  assert.equal(arrangement.largestSimultaneousOnset, 5);
  assert.equal(arrangement.originalMaximumKeyDownPolyphony, 48);
  assert.equal(arrangement.arrangedMaximumKeyDownPolyphony, 24);
  assert.equal(arrangement.arrangedMaximumReservedPolyphony, 24);
  assert.deepEqual(arrangement.baselineTransitionMetrics, BASELINE_TRANSITIONS);
  assert.deepEqual(arrangement.transitionMetrics, EXPECTED_TRANSITIONS);
  assert.equal(arrangement.foldedPitchRecords.length, 8);
  assert.equal(arrangement.shortenedNoteRecords.length, 358);
  return score;
}

function loadScore(scoreFile = SCORE_DEFAULT) {
  return validateSourceAndStatistics(buildSongCartridge.loadScore(scoreFile, {
    maxActiveVoices: 24,
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
    maxActiveVoices: 24,
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
      EXPECTED_TRANSITIONS,
      BASELINE_TRANSITIONS,
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
  EXPECTED_TRANSITIONS, BASELINE_TRANSITIONS,
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
      transitionMetrics: context.score.document.arrangement.transitionMetrics,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/')
        && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
