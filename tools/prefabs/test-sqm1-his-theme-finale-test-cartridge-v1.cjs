'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const fullHisThemeV2 = require('./build-sqm1-his-theme-cartridge-v2.cjs');

const EXPECTED = Object.freeze({
  title: 'His Theme - Finale Test',
  sourceSha256: '3c10cd933c76a6974484408208c6a21dc36fe07b2e281abd0c30117f6c2007a7',
  sourceStartSeconds: 255.355088844,
  notes: 508,
  entries: 542,
  durationSeconds: 58.29948631,
  activeVoices: 18,
  releaseTailSeconds: 0.2,
  minimumPitch: 30,
  maximumPitch: 100,
  laneCounts: [38, 38, 35, 36, 31, 31, 28, 29, 30,
    27, 25, 24, 23, 23, 23, 23, 22, 22],
});

const roundSeconds = value => Number(value.toFixed(9));

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

module.exports = function testSqm1HisThemeFinaleTestCartridgeV1(context) {
  const {scene, bytes, score, constants} = context;
  const component = (brick, type) => brick?.comps.find(item => item.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const one = (items, label) => {
    assert.equal(items.length, 1, label);
    return items[0];
  };
  const marked = label => one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `MWIC1:${label}`), label);
  const scalar = value => value && typeof value === 'object' && 'value' in value
    ? value.value : value;
  const outgoing = (brick, type, port) => scene.edges.filter(edge =>
    edge.a === brick.key && edge.at === type && edge.p === port);
  const edge = (source, sourceType, sourcePort, target, targetType, targetPort) =>
    scene.edges.some(candidate => candidate.a === source.key
      && candidate.at === sourceType && candidate.p === sourcePort
      && candidate.z === target.key && candidate.zt === targetType
      && candidate.q === targetPort);

  assert.equal(constants.TITLE, EXPECTED.title);
  assert.equal(constants.SOURCE_MIDI_SHA256, EXPECTED.sourceSha256);
  assert.equal(constants.SOURCE_START_SECONDS, EXPECTED.sourceStartSeconds);
  const document = score.document;
  assert.equal(document.source.sha256, EXPECTED.sourceSha256);
  assert.equal(document.activeVoices, EXPECTED.activeVoices);
  assert.deepEqual(document.statistics, {
    notes: EXPECTED.notes,
    durationSeconds: EXPECTED.durationSeconds,
    arrayEntries: EXPECTED.entries,
    minimumPitch: EXPECTED.minimumPitch,
    maximumPitch: EXPECTED.maximumPitch,
    allocatedVoices: EXPECTED.activeVoices,
    maximumKeyDownPolyphony: 18,
    maximumReservedPolyphony: 18,
    instrumentGroups: 1,
    droppedOutOfRangeNotes: 0,
  });
  assert.equal(score.values.length, EXPECTED.entries);
  assert.deepEqual(score.values[0], {
    X: 7701001, Y: 1, Z: EXPECTED.activeVoices, W: EXPECTED.durationSeconds,
  });
  assert.deepEqual(score.values[1], {
    X: 34, Y: EXPECTED.releaseTailSeconds,
    Z: EXPECTED.minimumPitch, W: EXPECTED.maximumPitch,
  });

  const full = fullHisThemeV2.loadScore();
  const sourceLanes = [];
  for (let voice = 0; voice < full.values[0].Z; voice++) {
    const header = full.values[2 + voice];
    sourceLanes.push(full.values.slice(header.X, header.X + header.Y)
      .filter(note => note.X >= EXPECTED.sourceStartSeconds - 1e-9));
  }

  const notes = [];
  let cursor = 34;
  for (let voice = 0; voice < 32; voice++) {
    const header = score.values[2 + voice];
    assert.equal(header.X, cursor, `Voice ${voice} contiguous offset`);
    if (voice < EXPECTED.activeVoices) {
      assert.equal(header.Y, EXPECTED.laneCounts[voice], `Voice ${voice} count`);
      assert.equal(document.voices[voice].sourceVoice, voice,
        `Voice ${voice} retains source lane`);
      const lane = score.values.slice(header.X, header.X + header.Y);
      const expectedLane = sourceLanes[voice].map(note => ({
        X: Math.max(0, roundSeconds(note.X - EXPECTED.sourceStartSeconds)),
        Y: roundSeconds(note.Y - EXPECTED.sourceStartSeconds),
        Z: note.Z,
        W: note.W,
      }));
      assert.deepEqual(lane, expectedLane,
        `Voice ${voice} preserves every selected source note`);
      for (let index = 0; index < lane.length; index++) {
        const note = lane[index];
        assert(note.Y > note.X && note.Y <= EXPECTED.durationSeconds);
        assert(Number.isInteger(note.Z)
          && note.Z >= EXPECTED.minimumPitch && note.Z <= EXPECTED.maximumPitch);
        assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127);
        if (index) assert(note.X + 1e-9 >= lane[index - 1].Y
          + EXPECTED.releaseTailSeconds, `Voice ${voice} release reservation`);
      }
      notes.push(...lane);
      cursor += header.Y;
    } else {
      assert.deepEqual(header, {X: EXPECTED.entries, Y: 0, Z: -1, W: -1});
    }
  }
  assert.equal(cursor, EXPECTED.entries);
  assert.equal(notes.length, EXPECTED.notes);
  assert.equal(maximumPolyphony(notes), 18);
  assert.equal(maximumPolyphony(notes, EXPECTED.releaseTailSeconds), 18);

  const firstOnset = Math.min(...notes.map(note => note.X));
  const firstNotes = notes.filter(note => note.X === firstOnset)
    .sort((left, right) => left.Z - right.Z);
  assert.equal(firstOnset, 0, 'Finale begins immediately');
  assert.deepEqual(firstNotes, [32, 44, 64, 76].map((pitch, index) => ({
    X: 0,
    Y: [1.18889, 1.327779, 1.327779, 1.466668][index],
    Z: pitch,
    W: 112,
  })), 'Measure-97 downbeat');

  const finalOnset = Math.max(...notes.map(note => note.X));
  const finalOnsetNotes = notes.filter(note => note.X === finalOnset)
    .sort((left, right) => left.Z - right.Z);
  assert.equal(finalOnset, 53.234206);
  assert.deepEqual(finalOnsetNotes.map(note => [note.Z, note.W]),
    [[33, 112], [45, 112], [61, 112], [64, 112], [69, 112]],
  'Final onset pitches and velocities');
  assert.deepEqual(finalOnsetNotes.filter(note => note.Y === EXPECTED.durationSeconds)
    .map(note => note.Z), [61, 64, 69], 'Sustained final chord');

  const arrangement = document.arrangement;
  assert.equal(arrangement.mode,
    'measure-97-finale-excerpt-from-sustain-resolved-v2');
  assert.equal(arrangement.sourceStartSeconds, EXPECTED.sourceStartSeconds);
  assert.equal(arrangement.sourceEndSeconds, 313.654575154);
  assert.equal(arrangement.sourceNotes, 1936);
  assert.equal(arrangement.omittedPriorNotes, 1428);
  assert.equal(arrangement.omittedPriorNotesStillReleasingAtBoundary, 14);
  assert.equal(arrangement.preservedNoteOnsets, EXPECTED.notes);
  assert.deepEqual(arrangement.sourceVoiceIndices,
    Array.from({length: EXPECTED.activeVoices}, (_, index) => index));
  assert.deepEqual(arrangement.finalChord, finalOnsetNotes);

  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);
  const prefab = scene.r.prefabJson();
  assert.equal(prefab.bIsPhysicsGrid, true);
  assert.equal(prefab.bFreezePhysicsGrid, false);
  assert.equal([...scene.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid').length, 0);
  const roots = scene.bricks.filter(brick => brick.g === 1);
  assert.equal(roots.length, 2);
  const rootChip = one(roots.filter(brick => component(brick, C.Microchip.NAME)),
    'Root microchip');
  const rootTitle = one(roots.filter(brick => component(brick, C.TextDisplay.NAME)),
    'Root title');
  assert.equal(component(rootTitle, C.TextDisplay.NAME).data.Text, EXPECTED.title);
  assert.equal(scene.links.filter(link => link.key === rootChip.key).length, 1);
  assert.equal(bricksOf(C.Button.NAME).length, 0);

  const scoreBrick = marked('score');
  const saved = component(scoreBrick, C.ArrayVar.NAME).data.Value;
  assert.equal(saved.$elementType, 'Quat');
  assert.deepEqual(saved.$array, score.values);
  const receivers = bricksOf(C.Event_CustomGlobal.NAME);
  const request = one(receivers.filter(brick =>
    component(brick, C.Event_CustomGlobal.NAME).data.EventName === 'SQM1.Request'),
  'Request receiver');
  const ack = one(receivers.filter(brick =>
    component(brick, C.Event_CustomGlobal.NAME).data.EventName === 'SQM1.Ack'),
  'Ack receiver');
  assert.equal(component(request, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  assert.equal(component(ack, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  const offer = one(bricksOf(C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
    component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Offer'),
  'Offer sender');
  assert(edge(scoreBrick, C.ArrayVar.NAME, 'ArrayVarRef', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'));
  const offerData = component(offer, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(offerData.DataIn1), 7702001);
  assert.equal(scalar(offerData.DataIn6), EXPECTED.title);
  assert.equal(scalar(offerData.DataIn7), 0);
  assert.equal(scalar(offerData.DataIn8), 1);

  for (const [port, expected] of [
    ['DataOut5', EXPECTED.activeVoices],
    ['DataOut6', EXPECTED.entries],
  ]) {
    const comparisonEdge = one(outgoing(request, C.Event_CustomGlobal.NAME, port)
      .filter(candidate => candidate.q === 'InputA'), `${port} comparison`);
    const comparison = one(scene.bricks.filter(brick => brick.key === comparisonEdge.z),
      `${port} comparison brick`);
    assert.equal(scalar(component(comparison, comparisonEdge.zt).data.InputB), expected);
  }

  const accepted = marked('state.request.accepted');
  const incrementEdge = one(outgoing(accepted, C.Var.NAME, 'VarRef')
    .filter(candidate => candidate.zt === C.Exec_Var_Increment.NAME),
  'Accepted counter');
  const increment = one(scene.bricks.filter(brick => brick.key === incrementEdge.z),
    'Accepted increment');
  const waitEdge = one(outgoing(increment, C.Exec_Var_Increment.NAME, 'ExecOut')
    .filter(candidate => candidate.zt === C.BufferTicks.NAME), 'Automatic wait');
  const wait = one(scene.bricks.filter(brick => brick.key === waitEdge.z), 'Wait brick');
  assert.equal(component(wait, C.BufferTicks.NAME).data.TicksToWait, 1);

  const brickByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const wire of scene.edges) {
    assert(brickByKey.get(wire.a)?.comps.some(item => item.type === wire.at));
    assert(brickByKey.get(wire.z)?.comps.some(item => item.type === wire.zt));
    const target = `${wire.z}|${wire.zt}|${wire.q}`;
    assert(!targets.has(target), `Duplicate target ${target}`);
    targets.add(target);
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log('SQM1 His Theme finale test cartridge checks passed: 508 exact V2 '
    + 'onsets from measure 97, prior-bar pedal residue excluded, complete final '
    + 'chord, 200 ms lane reservations, strict physics root, automatic direct-reference '
    + `offer and deterministic SHA-256 ${sha256}.`);
  return {placement, sha256};
};

if (require.main === module) {
  const build = require('./build-sqm1-his-theme-finale-test-cartridge-v1.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(second.bytes, first.bytes,
    'His Theme finale test cartridge build is deterministic');
}
