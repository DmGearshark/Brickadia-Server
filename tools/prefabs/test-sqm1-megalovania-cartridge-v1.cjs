'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

const EXPECTED = Object.freeze({
  title: 'Megalovania - Piano Ver. 3',
  sourceFilename: 'undertale-megalovania-piano-ver-3.mid',
  sourceSha256: 'a8cbc69ea2335f828bce54b13246f459107d1990488710e199ecc41b8c3d9d21',
  notes: 1816,
  entries: 1850,
  durationSeconds: 155.992708333,
  activeVoices: 16,
  releaseTailSeconds: 0.2,
  minimumPitch: 34,
  maximumPitch: 93,
  maximumKeyDownPolyphony: 5,
  maximumReservedPolyphony: 14,
  instrumentGroups: 2,
});

const PLAYER_MAX_VOICES = 18;
const PLAYER_MAX_SCORE_LENGTH = 65536;
const HEADER_LENGTH = 34;
const VOICE_HEADER_COUNT = 32;
const SCORE_MAGIC = 7701001;
const SCORE_FORMAT = 1;
const TRANSPORT_MAGIC = 7702001;
const EPSILON = 1e-9;

function maximumHalfOpenPolyphony(notes, releaseTail = 0) {
  const events = [];
  for (const note of notes) {
    events.push([note.X, 1]);
    events.push([note.Y + releaseTail, -1]);
  }
  // Ends sort before starts at an identical instant, matching half-open note
  // intervals and allowing a released lane to be reused at that instant.
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let current = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    current += delta;
    assert(current >= 0, 'Polyphony sweep may never close a note before it opens');
    maximum = Math.max(maximum, current);
  }
  assert.equal(current, 0, 'Polyphony sweep must close every note');
  return maximum;
}

module.exports = function testSqm1MegalovaniaCartridgeV1(context) {
  const {scene, bytes, score, constants} = context;
  assert(scene && ArrayBuffer.isView(bytes) && score?.document && Array.isArray(score.values),
    'Builder must return scene, bytes and its loaded canonical score');

  const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const compOf = type => bricksOf(type).map(brick => ({brick, comp: component(brick, type)}));
  const one = (items, label) => {
    assert.equal(items.length, 1, label);
    return items[0];
  };
  const marked = label => one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `MWIC1:${label}`), `MWIC1:${label}`);
  const incoming = (brick, type, port) => scene.edges.filter(candidate =>
    candidate.z === brick.key && candidate.zt === type && candidate.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(candidate =>
    candidate.a === brick.key && candidate.at === type && candidate.p === port);
  const edge = (source, sourceType, sourcePort, target, targetType, targetPort) =>
    scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
      && candidate.p === sourcePort && candidate.z === target.key
      && candidate.zt === targetType && candidate.q === targetPort);
  const scalar = value => value && typeof value === 'object' && 'value' in value
    ? value.value : value;
  const brickByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));

  assert.equal(constants.TITLE, EXPECTED.title);
  assert.equal(constants.SOURCE_MIDI_SHA256, EXPECTED.sourceSha256);
  if (constants.OUTPUT_DEFAULT) {
    assert(fs.existsSync(constants.OUTPUT_DEFAULT),
      `Packaged artifact must exist at ${constants.OUTPUT_DEFAULT}`);
    assert.deepEqual(new Uint8Array(fs.readFileSync(constants.OUTPUT_DEFAULT)),
      new Uint8Array(bytes), 'Packaged .brz must exactly match a clean deterministic build');
  }

  const document = score.document;
  assert.equal(document.schema, 'brickadia-midi-single-quat-array');
  assert.equal(document.version, 1);
  assert.deepEqual(document.source, {
    filename: EXPECTED.sourceFilename,
    sha256: EXPECTED.sourceSha256,
    midiFormat: 1,
    trackCount: 2,
    trackNames: ['Piano', 'Piano'],
  });
  assert.equal(document.maximumVoices, VOICE_HEADER_COUNT);
  assert.equal(document.voiceLimit, PLAYER_MAX_VOICES);
  assert.equal(document.activeVoices, EXPECTED.activeVoices);
  assert(document.activeVoices >= 1 && document.activeVoices <= PLAYER_MAX_VOICES,
    'Score must fit the current 18-voice player');
  assert.equal(document.releaseTailSeconds, EXPECTED.releaseTailSeconds);
  assert.deepEqual(document.playableMidiRange, [30, 108]);
  assert.deepEqual(document.flags, {
    absoluteSeconds: true,
    sustainResolved: true,
    releaseTailReserved: true,
    trueKeyOffInNoteEnd: true,
    stableInstrumentPerVoice: true,
  });
  assert.deepEqual(document.header, {
    length: HEADER_LENGTH,
    globalIndex: 0,
    globalFields: ['magic', 'version', 'activeVoiceCount', 'durationSeconds'],
    formatIndex: 1,
    formatFields: ['headerLength', 'releaseTailSeconds', 'scoreMinMidi', 'scoreMaxMidi'],
    voiceTableStart: 2,
    voiceTableCount: VOICE_HEADER_COUNT,
    voiceTableFields: ['absoluteNoteOffset', 'noteCount', 'instrumentCode',
      'channelTrackCode'],
    noteFields: ['startSeconds', 'endSeconds', 'midiNote', 'velocity'],
  });
  assert.deepEqual(document.warnings, {
    unmatchedNoteOffs: 0,
    danglingNotesClosedAtEnd: 0,
    zeroLengthNotesExtendedOneTick: 29,
  });
  assert.deepEqual(document.statistics, {
    notes: EXPECTED.notes,
    durationSeconds: EXPECTED.durationSeconds,
    arrayEntries: EXPECTED.entries,
    minimumPitch: EXPECTED.minimumPitch,
    maximumPitch: EXPECTED.maximumPitch,
    allocatedVoices: EXPECTED.activeVoices,
    maximumKeyDownPolyphony: EXPECTED.maximumKeyDownPolyphony,
    maximumReservedPolyphony: EXPECTED.maximumReservedPolyphony,
    instrumentGroups: EXPECTED.instrumentGroups,
    droppedOutOfRangeNotes: 0,
  });
  assert.equal(document.array.elementType, 'Quat');
  assert.deepEqual(document.array.values, score.values,
    'Loaded score values must be the canonical conversion output');
  assert.equal(score.values.length, EXPECTED.entries);
  assert(score.values.length >= HEADER_LENGTH && score.values.length <= PLAYER_MAX_SCORE_LENGTH,
    'Score must fit the current 65,536-Quaternion player capacity');

  for (let index = 0; index < score.values.length; index++) {
    const value = score.values[index];
    assert(value && ['X', 'Y', 'Z', 'W'].every(field => Number.isFinite(value[field])),
      `Score q${index} must have finite X/Y/Z/W fields`);
    assert.deepEqual(Object.keys(value).sort(), ['W', 'X', 'Y', 'Z'],
      `Score q${index} must contain only X/Y/Z/W`);
  }
  assert.deepEqual(score.values[0], {
    X: SCORE_MAGIC,
    Y: SCORE_FORMAT,
    Z: EXPECTED.activeVoices,
    W: EXPECTED.durationSeconds,
  });
  assert.deepEqual(score.values[1], {
    X: HEADER_LENGTH,
    Y: EXPECTED.releaseTailSeconds,
    Z: EXPECTED.minimumPitch,
    W: EXPECTED.maximumPitch,
  });

  assert.equal(document.voices.length, EXPECTED.activeVoices);
  let expectedOffset = HEADER_LENGTH;
  let countedNotes = 0;
  const allNotes = [];
  for (let voiceIndex = 0; voiceIndex < VOICE_HEADER_COUNT; voiceIndex++) {
    const header = score.values[2 + voiceIndex];
    if (voiceIndex >= EXPECTED.activeVoices) {
      assert.deepEqual(header, {X: EXPECTED.entries, Y: 0, Z: -1, W: -1},
        `Inactive voice header ${voiceIndex}`);
      continue;
    }

    const voice = document.voices[voiceIndex];
    assert.equal(voice.voice, voiceIndex);
    assert.equal(voice.offset, expectedOffset);
    assert(Number.isInteger(voice.count) && voice.count > 0);
    assert(Number.isInteger(voice.instrumentCode) && voice.instrumentCode >= 0);
    assert(Number.isInteger(voice.program) && voice.program >= 0 && voice.program <= 127);
    assert.equal(typeof voice.percussion, 'boolean');
    assert(Number.isInteger(voice.channel) && voice.channel >= 0 && voice.channel <= 15);
    assert(Number.isInteger(voice.track)
      && voice.track >= 0 && voice.track < document.source.trackCount);
    assert.equal(voice.channelTrackCode, voice.channel + voice.track * 16);
    assert.deepEqual(header, {
      X: voice.offset,
      Y: voice.count,
      Z: voice.instrumentCode,
      W: voice.channelTrackCode,
    }, `Active voice header ${voiceIndex}`);

    const notes = score.values.slice(header.X, header.X + header.Y);
    assert.equal(notes.length, header.Y, `Voice ${voiceIndex} note slice`);
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const note = notes[noteIndex];
      assert(note.X >= 0 && note.X < EXPECTED.durationSeconds,
        `Voice ${voiceIndex} note ${noteIndex} start`);
      assert(note.Y > note.X && note.Y <= EXPECTED.durationSeconds,
        `Voice ${voiceIndex} note ${noteIndex} end`);
      assert(Number.isInteger(note.Z)
        && note.Z >= document.playableMidiRange[0]
        && note.Z <= document.playableMidiRange[1],
      `Voice ${voiceIndex} note ${noteIndex} pitch`);
      assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127,
        `Voice ${voiceIndex} note ${noteIndex} velocity`);
      if (noteIndex > 0) {
        const previous = notes[noteIndex - 1];
        assert(note.X + EPSILON >= previous.Y + EXPECTED.releaseTailSeconds,
          `Voice ${voiceIndex} note ${noteIndex} must preserve the release tail`);
      }
      allNotes.push(note);
    }
    expectedOffset += header.Y;
    countedNotes += header.Y;
  }
  assert.equal(expectedOffset, EXPECTED.entries, 'Active voice lanes exactly fill the score');
  assert.equal(countedNotes, EXPECTED.notes);
  assert.equal(countedNotes, score.values.length - HEADER_LENGTH);
  assert.equal(Math.min(...allNotes.map(note => note.X)), 0);
  assert.equal(Math.max(...allNotes.map(note => note.Y)), EXPECTED.durationSeconds);
  assert.equal(Math.min(...allNotes.map(note => note.Z)), EXPECTED.minimumPitch);
  assert.equal(Math.max(...allNotes.map(note => note.Z)), EXPECTED.maximumPitch);
  assert.equal(maximumHalfOpenPolyphony(allNotes), EXPECTED.maximumKeyDownPolyphony);
  assert.equal(maximumHalfOpenPolyphony(allNotes, EXPECTED.releaseTailSeconds),
    EXPECTED.maximumReservedPolyphony);

  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  const prefab = scene.r.prefabJson();
  assert.equal(prefab.bIsPhysicsGrid, true,
    'PrefabSpawner must own the visible cartridge physics root');
  assert.equal(prefab.bFreezePhysicsGrid, false);
  assert.equal([...scene.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid').length, 0,
  'Visible cartridge must not be hidden in a child dynamic entity');
  const rootBricks = scene.bricks.filter(brick => brick.g === 1);
  assert.equal(rootBricks.length, 2, 'Physics root contains only the title plate and root chip');
  const rootChip = one(rootBricks.filter(brick => component(brick, C.Microchip.NAME)),
    'Physics-root microchip');
  const rootTitle = one(rootBricks.filter(brick => component(brick, C.TextDisplay.NAME)),
    'Physics-root title plate');
  assert.equal(component(rootTitle, C.TextDisplay.NAME).data.Text, EXPECTED.title);
  assert.equal(scene.links.filter(link => link.key === rootChip.key).length, 1,
    'Root chip must link to exactly one nested logic grid');
  assert.equal(bricksOf(C.Button.NAME).length, 0,
    'Automatic cartridge must not contain a manual offer button');

  const scoreBrick = marked('score');
  const savedScore = component(scoreBrick, C.ArrayVar.NAME).data.Value;
  assert.equal(savedScore.$elementType, 'Quat');
  assert.equal(savedScore.$array.length, EXPECTED.entries);
  assert.deepEqual(savedScore.$array, score.values,
    'Packaged ArrayVar must exactly preserve every canonical score Quaternion');

  const objectReceivers = compOf(C.Event_CustomGlobal.NAME);
  assert.equal(objectReceivers.length, 2, 'Cartridge has only request and acknowledgment receivers');
  const request = one(objectReceivers
    .filter(({comp}) => comp.data.EventName === 'SQM1.Request'), 'Request receiver').brick;
  const ack = one(objectReceivers
    .filter(({comp}) => comp.data.EventName === 'SQM1.Ack'), 'Acknowledgment receiver').brick;
  for (const {comp} of objectReceivers) {
    assert.equal(comp.data.bIsObjectEvent, true,
      `${comp.data.EventName} must be scoped to the cartridge physics object`);
  }
  const offer = one(compOf(C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Offer'), 'Offer sender').brick;
  assert.equal(incoming(offer, C.Exec_SendCustomEventGlobal.NAME, 'Target').length, 0,
    'Offer remains broadcast for the live-proven ArrayVarRef transport path');
  assert(edge(scoreBrick, C.ArrayVar.NAME, 'ArrayVarRef', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'),
  'Offer must transmit the score by direct ArrayVar reference');
  const offerData = component(offer, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(offerData.DataIn1), TRANSPORT_MAGIC);
  assert.equal(scalar(offerData.DataIn2), 1);
  assert.equal(scalar(offerData.DataIn6), EXPECTED.title);
  assert.equal(scalar(offerData.DataIn7), 0);
  assert.equal(scalar(offerData.DataIn8), SCORE_FORMAT);

  for (const [port, expected] of [
    ['DataOut5', EXPECTED.activeVoices],
    ['DataOut6', EXPECTED.entries],
  ]) {
    const comparisonEdge = one(outgoing(request, C.Event_CustomGlobal.NAME, port)
      .filter(candidate => candidate.q === 'InputA'), `${port} compatibility comparison`);
    assert.equal(comparisonEdge.zt, C.Expr_CompareGreaterOrEqual.NAME,
      `${port} must use a greater-or-equal compatibility check`);
    const comparison = one(scene.bricks.filter(brick => brick.key === comparisonEdge.z),
      `${port} comparison brick`);
    assert.equal(scalar(component(comparison, comparisonEdge.zt).data.InputB), expected,
      `${port} must require the complete Megalovania score`);
  }

  const accepted = marked('state.request.accepted');
  const acceptedCounterEdge = one(outgoing(accepted, C.Var.NAME, 'VarRef')
    .filter(candidate => candidate.q === 'VarRef'
      && candidate.zt === C.Exec_Var_Increment.NAME), 'Accepted-request counter edge');
  const acceptedCounter = brickByKey.get(acceptedCounterEdge.z);
  const waitEdge = one(outgoing(acceptedCounter, C.Exec_Var_Increment.NAME, 'ExecOut')
    .filter(candidate => candidate.q === 'Input'
      && candidate.zt === C.BufferTicks.NAME), 'Automatic offer wait edge');
  const wait = brickByKey.get(waitEdge.z);
  assert.equal(component(wait, C.BufferTicks.NAME).data.TicksToWait, 1,
    'Automatic offer waits exactly one tick after accepting a request');
  const sendBranchEdge = one(outgoing(wait, C.BufferTicks.NAME, 'Output')
    .filter(candidate => candidate.q === 'Exec'
      && candidate.zt === C.Exec_Branch.NAME), 'Automatic offer branch edge');
  const sendBranch = brickByKey.get(sendBranchEdge.z);
  const getLengthEdge = one(outgoing(sendBranch, C.Exec_Branch.NAME, 'ExecOutA')
    .filter(candidate => candidate.q === 'Exec'
      && candidate.zt === C.Exec_ArrayVar_GetLength.NAME), 'Automatic offer score-length edge');
  const getLength = brickByKey.get(getLengthEdge.z);
  assert(edge(scoreBrick, C.ArrayVar.NAME, 'ArrayVarRef', getLength,
    C.Exec_ArrayVar_GetLength.NAME, 'ArrayVarRef'));
  assert(edge(getLength, C.Exec_ArrayVar_GetLength.NAME, 'Length', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn5'));
  const getLengthExec = one(outgoing(getLength, C.Exec_ArrayVar_GetLength.NAME, 'ExecOut')
    .filter(candidate => candidate.zt === C.Exec_Var_Set.NAME),
  'Offer awaiting-ack setter');
  const markAwaiting = brickByKey.get(getLengthExec.z);
  assert(edge(markAwaiting, C.Exec_Var_Set.NAME, 'ExecOut', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'),
  'Accepted request must automatically execute the offer sender');

  const targets = new Set();
  for (const wire of scene.edges) {
    assert(brickByKey.get(wire.a)?.comps.some(item => item.type === wire.at),
      `Missing source endpoint ${wire.a}:${wire.at}`);
    assert(brickByKey.get(wire.z)?.comps.some(item => item.type === wire.zt),
      `Missing target endpoint ${wire.z}:${wire.zt}`);
    const target = `${wire.z}|${wire.zt}|${wire.q}`;
    assert(!targets.has(target), `Duplicate input wire ${target}`);
    targets.add(target);
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log('SQM1 Megalovania cartridge checks passed: exact 1,850-Quat/16-voice '
    + 'canonical score, all 1,816 notes and release lanes validated, strict physics-root '
    + 'placement, object-scoped request/ack, automatic direct-reference offer, no manual '
    + `button, output SHA-256 ${sha256}.`);
  return {
    placement,
    sha256,
    scoreLength: savedScore.$array.length,
    notes: countedNotes,
    activeVoices: EXPECTED.activeVoices,
    durationSeconds: EXPECTED.durationSeconds,
  };
};

if (require.main === module) {
  const build = require('./build-sqm1-megalovania-cartridge-v1.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(second.score, first.score,
    'Repeated builds must load identical canonical score data');
  assert.deepEqual(second.bytes, first.bytes,
    'Megalovania cartridge build must be byte-for-byte deterministic');
  assert.equal(
    crypto.createHash('sha256').update(second.bytes).digest('hex'),
    crypto.createHash('sha256').update(first.bytes).digest('hex'),
    'Repeated build SHA-256 digests must match',
  );
}
