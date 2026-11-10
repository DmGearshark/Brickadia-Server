'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const buildSongCartridge = require('./build-sqm1-song-cartridge-v1.cjs');
const fullHisThemeV3 = require('./build-sqm1-his-theme-cartridge-v3.cjs');

const SCORE_DEFAULT = fullHisThemeV3.constants.SCORE_DEFAULT;
const OUTPUT_DEFAULT = path.join(__dirname, '..', '..', 'prefabs',
  'sqm1-his-theme-finale-test-cartridge-v2.brz');
const TEMPLATE_DEFAULT = buildSongCartridge.constants.TEMPLATE_DEFAULT;
const TITLE = 'His Theme - Finale Test - 24 Voice';
const BUILD_NAME = 'SQM1 His Theme Finale Test Cartridge V2 - 24 Voice';
const SOURCE_MIDI_SHA256 = fullHisThemeV3.constants.SOURCE_MIDI_SHA256;

// Tick 184,320: the first onset of measure 97. The sustain pedal from the
// preceding bar lifts one MIDI tick later, so beginning at the pedal event
// would silently discard this four-note downbeat. Starting on the onset and
// excluding notes that began in the prior bar gives a clean, immediate test.
const SOURCE_START_SECONDS = 255.355088844;
const RELEASE_TAIL_SECONDS = 0.2;
const HEADER_LENGTH = 34;
const VOICE_TABLE_LENGTH = 32;
const EPSILON = 1e-9;
const EXPECTED = Object.freeze({
  sourceSha256: SOURCE_MIDI_SHA256,
  notes: 508,
  arrayEntries: 542,
  durationSeconds: 58.29948631,
  activeVoices: 24,
  releaseTailSeconds: RELEASE_TAIL_SECONDS,
  minimumPitch: 30,
  maximumPitch: 100,
});
const DESCRIPTION = 'Physics-root automatic acceptance cartridge containing '
  + 'the final 58.3 seconds in the 24-lane arrangement of His Theme, beginning on the measure-97 downbeat. '
  + 'It preserves all 508 finale onsets, pitches, velocities and the complete '
  + 'final chord from the 24-lane V3 score, with 200 ms lane reservations and no '
  + 'arranger-induced early endings in the final 13 seconds.';

function roundSeconds(value) {
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function maximumPolyphony(notes, tail = 0) {
  const events = notes.flatMap(note => [
    [note.X, 1],
    [roundSeconds(note.Y + tail), -1],
  ]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    assert(active >= 0, 'Polyphony sweep may not close before opening');
    maximum = Math.max(maximum, active);
  }
  assert.equal(active, 0, 'Polyphony sweep closes every note');
  return maximum;
}

function deriveFinaleScore(scoreFile = SCORE_DEFAULT) {
  const sourceScore = fullHisThemeV3.loadScore(scoreFile);
  const source = sourceScore.document;
  const sourceValues = sourceScore.values;
  const sourceEndSeconds = sourceValues[0].W;
  const sourceVoices = new Map(source.voices.map(voice => [voice.voice, voice]));
  const lanes = [];

  for (let sourceVoice = 0; sourceVoice < sourceValues[0].Z; sourceVoice++) {
    const header = sourceValues[2 + sourceVoice];
    const notes = sourceValues.slice(header.X, header.X + header.Y)
      .filter(note => note.X >= SOURCE_START_SECONDS - EPSILON)
      .map(note => Object.freeze({
        X: Math.max(0, roundSeconds(note.X - SOURCE_START_SECONDS)),
        Y: roundSeconds(note.Y - SOURCE_START_SECONDS),
        Z: note.Z,
        W: note.W,
      }));
    if (notes.length) {
      lanes.push(Object.freeze({
        sourceVoice,
        sourceMetadata: sourceVoices.get(sourceVoice),
        instrumentCode: header.Z,
        channelTrackCode: header.W,
        notes: Object.freeze(notes),
      }));
    }
  }

  assert(lanes.length > 0 && lanes.length <= 24, 'Finale uses 1..24 voices');
  const notes = lanes.flatMap(lane => lane.notes);
  const durationSeconds = roundSeconds(Math.max(...notes.map(note => note.Y)));
  const minimumPitch = Math.min(...notes.map(note => note.Z));
  const maximumPitch = Math.max(...notes.map(note => note.Z));
  const values = [
    {X: 7701001, Y: 1, Z: lanes.length, W: durationSeconds},
    {X: HEADER_LENGTH, Y: RELEASE_TAIL_SECONDS, Z: minimumPitch, W: maximumPitch},
  ];
  const voiceHeaders = [];
  const voices = [];
  let offset = HEADER_LENGTH;
  for (let voice = 0; voice < VOICE_TABLE_LENGTH; voice++) {
    if (voice < lanes.length) {
      const lane = lanes[voice];
      const metadata = lane.sourceMetadata;
      voiceHeaders.push({
        X: offset,
        Y: lane.notes.length,
        Z: lane.instrumentCode,
        W: lane.channelTrackCode,
      });
      voices.push({
        voice,
        sourceVoice: lane.sourceVoice,
        offset,
        count: lane.notes.length,
        instrumentCode: lane.instrumentCode,
        program: metadata.program,
        percussion: metadata.percussion,
        channel: metadata.channel,
        track: metadata.track,
        channelTrackCode: lane.channelTrackCode,
      });
      offset += lane.notes.length;
    } else {
      voiceHeaders.push({X: offset, Y: 0, Z: -1, W: -1});
    }
  }
  values.push(...voiceHeaders);
  for (const lane of lanes) values.push(...lane.notes);

  const crossingPriorNotes = sourceValues.slice(HEADER_LENGTH).filter(note =>
    note.X < SOURCE_START_SECONDS - EPSILON
      && note.Y > SOURCE_START_SECONDS + EPSILON).length;
  const maximumKeyDownPolyphony = maximumPolyphony(notes);
  const maximumReservedPolyphony = maximumPolyphony(notes, RELEASE_TAIL_SECONDS);
  const finalStartSeconds = Math.max(...notes.map(note => note.X));
  const finalChord = notes.filter(note => note.X === finalStartSeconds)
    .map(note => ({...note})).sort((left, right) => left.Z - right.Z);

  const document = {
    schema: source.schema,
    version: source.version,
    source: structuredClone(source.source),
    maximumVoices: VOICE_TABLE_LENGTH,
    voiceLimit: 24,
    activeVoices: lanes.length,
    releaseTailSeconds: RELEASE_TAIL_SECONDS,
    playableMidiRange: structuredClone(source.playableMidiRange),
    flags: structuredClone(source.flags),
    header: structuredClone(source.header),
    timing: {
      mode: 'absoluteSecondsExcerpt',
      sourceMode: source.timing.mode,
      sourceStartSeconds: SOURCE_START_SECONDS,
      sourceEndSeconds,
      excerptDurationSeconds: durationSeconds,
    },
    warnings: structuredClone(source.warnings),
    voices,
    array: {elementType: 'Quat', values},
    diagnostics: {droppedOutOfRangeNotes: []},
    statistics: {
      notes: notes.length,
      durationSeconds,
      arrayEntries: values.length,
      minimumPitch,
      maximumPitch,
      allocatedVoices: lanes.length,
      maximumKeyDownPolyphony,
      maximumReservedPolyphony,
      instrumentGroups: new Set(voices.map(voice => voice.instrumentCode)).size,
      droppedOutOfRangeNotes: 0,
    },
    arrangement: {
      mode: 'measure-97-finale-excerpt-from-24-lane-v3',
      sourceScore: path.basename(scoreFile),
      sourceStartSeconds: SOURCE_START_SECONDS,
      sourceEndSeconds,
      sourceNotes: source.statistics.notes,
      omittedPriorNotes: source.statistics.notes - notes.length,
      omittedPriorNotesStillReleasingAtBoundary: crossingPriorNotes,
      preservedNoteOnsets: notes.length,
      releaseTailSeconds: RELEASE_TAIL_SECONDS,
      sourceVoiceIndices: lanes.map(lane => lane.sourceVoice),
      finalChordStartSeconds: finalStartSeconds,
      finalChord,
    },
  };
  return buildSongCartridge.validateScoreDocument(document, {
    maxActiveVoices: 24,
    expected: EXPECTED,
  }).document;
}

function loadScore(scoreFile = SCORE_DEFAULT) {
  const document = deriveFinaleScore(scoreFile);
  return buildSongCartridge.validateScoreDocument(document, {
    maxActiveVoices: 24,
    expected: EXPECTED,
  });
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
  return {
    ...context,
    constants: {
      ...context.constants,
      TITLE,
      BUILD_NAME,
      SOURCE_MIDI_SHA256,
      SOURCE_START_SECONDS,
      RELEASE_TAIL_SECONDS,
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
build.deriveFinaleScore = deriveFinaleScore;
build.maximumPolyphony = maximumPolyphony;
build.constants = {
  TITLE, BUILD_NAME, SOURCE_MIDI_SHA256, SOURCE_START_SECONDS,
  RELEASE_TAIL_SECONDS, EXPECTED, SCORE_DEFAULT, TEMPLATE_DEFAULT,
  OUTPUT_DEFAULT, DESCRIPTION,
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
      sourceStartSeconds: SOURCE_START_SECONDS,
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
