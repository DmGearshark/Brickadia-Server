'use strict';

const assert = require('assert/strict');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

const EXPECTED_ARTIFACT_SHA256 =
  '0808c8f570b6565b921f81b7ba19d9a931806182f1ac0db15b4fd366533e3c1f';
const EXPECTED_SCORE_SHA256 =
  'e979feb7d552dc3ddca24885d464ac9902d6c32f946cb56bf5d4f60456b7e56d';
const EXPECTED_V3_SCORE_SHA256 =
  'da0f14bdddf1728c9759368e14bc9935491d30e78210358c1779d20fc45332e1';
const EXPECTED_V3_ARTIFACT_SHA256 =
  'adccc10096f1668476359d8bd02b27d94833f18bd136d7fee16ed1005531a08b';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const component = (brick, type) => brick?.comps.find(item => item.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function lanes(values) {
  return Array.from({length: values[0].Z}, (_, voice) => {
    const header = values[2 + voice];
    return values.slice(header.X, header.X + header.Y);
  });
}

function transitionMetrics(scoreLanes) {
  const transitions = scoreLanes.flatMap(lane => lane.slice(1).map((next, index) => ({
    gap: next.X - lane[index].Y,
    jump: Math.abs(next.Z - lane[index].Z),
  })));
  return {
    transitions: transitions.length,
    samePitchTransitions: transitions.filter(item => item.jump === 0).length,
    jumpsAtLeast12Semitones: transitions.filter(item => item.jump >= 12).length,
    jumpsAtLeast24Semitones: transitions.filter(item => item.jump >= 24).length,
    jumpsAtLeast36Semitones: transitions.filter(item => item.jump >= 36).length,
    shortGapSeconds: 0.4,
    shortGapJumpsAtLeast12Semitones: transitions.filter(item =>
      item.gap <= 0.4 + 1e-12 && item.jump >= 12).length,
    shortGapJumpsAtLeast24Semitones: transitions.filter(item =>
      item.gap <= 0.4 + 1e-12 && item.jump >= 24).length,
    maximumJumpSemitones: Math.max(...transitions.map(item => item.jump)),
    minimumGapSeconds: Number(Math.min(...transitions.map(item => item.gap)).toFixed(9)),
  };
}

function maximumPolyphony(notes, tail = 0) {
  const events = notes.flatMap(note => [
    [note.X, 1],
    [Number((note.Y + tail).toFixed(9)), -1],
  ]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    assert(active >= 0, 'Polyphony sweep closes after opening');
    maximum = Math.max(maximum, active);
  }
  assert.equal(active, 0);
  return maximum;
}

function musicalIdentity(values) {
  return values.slice(34).map(note => [note.X, note.Z, note.W])
    .sort((left, right) => left[0] - right[0]
      || left[1] - right[1] || left[2] - right[2]);
}

module.exports = function testHisThemePitchContinuityV4(context) {
  const {scene, bytes, score, constants} = context;
  assert.equal(constants.TITLE, 'His Theme - Pitch Continuity V4');
  assert.equal(constants.SOURCE_MIDI_SHA256,
    '3c10cd933c76a6974484408208c6a21dc36fe07b2e281abd0c30117f6c2007a7');
  const document = score.document;
  const values = score.values;
  const scoreLanes = lanes(values);
  const notes = scoreLanes.flat();

  assert.equal(values.length, 1970);
  assert.equal(notes.length, 1936);
  assert.equal(scoreLanes.length, 24);
  assert.deepEqual(values[0], {X: 7701001, Y: 1, Z: 24, W: 313.654575154});
  assert.deepEqual(values[1], {X: 34, Y: 0.2, Z: 30, W: 105});
  let cursor = 34;
  for (let voice = 0; voice < 32; voice++) {
    const header = values[2 + voice];
    assert.equal(header.X, cursor, `Voice ${voice} contiguous offset`);
    if (voice < 24) {
      assert(header.Y > 0);
      const lane = scoreLanes[voice];
      for (let index = 0; index < lane.length; index++) {
        const note = lane[index];
        assert(note.Y > note.X);
        assert(Number.isInteger(note.Z) && note.Z >= 30 && note.Z <= 105);
        assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127);
        if (index) assert(note.X + 1e-9 >= lane[index - 1].Y + 0.2,
          `Voice ${voice} reserves its release tail`);
      }
      cursor += header.Y;
    } else {
      assert.deepEqual(header, {X: 1970, Y: 0, Z: -1, W: -1});
    }
  }
  assert.equal(cursor, 1970);
  assert.equal(maximumPolyphony(notes), 24);
  assert.equal(maximumPolyphony(notes, 0.2), 24);

  const v3ScoreFile = path.join(__dirname,
    'undertale-his-theme-single-quat-score-v3.json');
  const v3Document = JSON.parse(fs.readFileSync(v3ScoreFile, 'utf8'));
  assert.equal(sha256(fs.readFileSync(v3ScoreFile)), EXPECTED_V3_SCORE_SHA256,
    'V3 score remains byte-exact');
  assert.deepEqual(musicalIdentity(values), musicalIdentity(v3Document.array.values),
    'V4 preserves every V3 onset, pitch and velocity');
  assert.notDeepEqual(document.arrangement.shortenedNoteRecords,
    v3Document.arrangement.shortenedNoteRecords,
  'Pitch-aware assignment deliberately chooses different equally cheap held notes');
  for (const candidate of [document, v3Document]) {
    assert.equal(candidate.arrangement.shortenedHeldNotes, 358);
    assert.equal(candidate.arrangement.totalHeldSecondsRemoved, 216.100795475);
  }
  assert.deepEqual(transitionMetrics(scoreLanes), constants.EXPECTED_TRANSITIONS,
    'Transition metrics are independently derived from V4 lanes');
  assert.deepEqual(transitionMetrics(lanes(v3Document.array.values)),
    constants.BASELINE_TRANSITIONS,
  'Baseline metrics are independently derived from V3 lanes');
  assert(document.arrangement.transitionMetrics.jumpsAtLeast12Semitones
    < document.arrangement.baselineTransitionMetrics.jumpsAtLeast12Semitones * 0.24,
  'At least 76% of octave-or-larger retunes removed');
  assert(document.arrangement.transitionMetrics.shortGapJumpsAtLeast24Semitones
    < document.arrangement.baselineTransitionMetrics.shortGapJumpsAtLeast24Semitones * 0.02,
  'More than 98% of short two-octave retunes removed');

  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});
  assert.equal(scene.r.prefabJson().bIsPhysicsGrid, true);
  assert.equal(scene.r.prefabJson().bFreezePhysicsGrid, false);
  assert.equal([...scene.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid').length, 0);
  const roots = scene.bricks.filter(brick => brick.g === 1);
  assert.equal(roots.length, 2);
  const rootTitle = one(roots.filter(brick => component(brick, C.TextDisplay.NAME)),
    'Root title');
  assert.equal(component(rootTitle, C.TextDisplay.NAME).data.Text, constants.TITLE);
  assert.equal(scene.bricks.filter(brick => component(brick, C.Button.NAME)).length, 0);

  const marked = label => one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `MWIC1:${label}`), label);
  const scoreBrick = marked('score');
  assert.deepEqual(component(scoreBrick, C.ArrayVar.NAME).data.Value.$array, values);
  const receivers = scene.bricks.filter(brick => component(brick, C.Event_CustomGlobal.NAME));
  const request = one(receivers.filter(brick =>
    component(brick, C.Event_CustomGlobal.NAME).data.EventName === 'SQM1.Request'),
  'Request receiver');
  const ack = one(receivers.filter(brick =>
    component(brick, C.Event_CustomGlobal.NAME).data.EventName === 'SQM1.Ack'),
  'Ack receiver');
  assert.equal(component(request, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  assert.equal(component(ack, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  const offer = one(scene.bricks.filter(brick =>
    component(brick, C.Exec_SendCustomEventGlobal.NAME)?.data.EventName === 'SQM1.Offer'),
  'Offer sender');
  const offerData = component(offer, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(offerData.DataIn1), 7702001);
  assert.equal(scalar(offerData.DataIn6), constants.TITLE);
  assert.equal(scalar(offerData.DataIn7), 0);
  assert.equal(scalar(offerData.DataIn8), 1);
  assert(scene.edges.some(edge => edge.a === scoreBrick.key && edge.at === C.ArrayVar.NAME
    && edge.p === 'ArrayVarRef' && edge.z === offer.key
    && edge.zt === C.Exec_SendCustomEventGlobal.NAME && edge.q === 'DataIn3'));

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const wire of scene.edges) {
    assert(byKey.get(wire.a)?.comps.some(item => item.type === wire.at));
    assert(byKey.get(wire.z)?.comps.some(item => item.type === wire.zt));
    const target = `${wire.z}|${wire.zt}|${wire.q}`;
    assert(!targets.has(target), `Duplicate target ${target}`);
    targets.add(target);
  }

  assert.equal(sha256(bytes), EXPECTED_ARTIFACT_SHA256);
  assert.equal(sha256(fs.readFileSync(constants.SCORE_DEFAULT)), EXPECTED_SCORE_SHA256);
  assert.equal(sha256(fs.readFileSync(constants.OUTPUT_DEFAULT)), EXPECTED_ARTIFACT_SHA256);
  assert.deepEqual(fs.readFileSync(constants.OUTPUT_DEFAULT), Buffer.from(bytes),
    'Committed V4 artifact equals fresh build');
  const v3Artifact = path.join(__dirname, '..', '..', 'prefabs',
    'sqm1-his-theme-cartridge-v3.brz');
  assert.equal(sha256(fs.readFileSync(v3Artifact)), EXPECTED_V3_ARTIFACT_SHA256,
    'V3 cartridge remains byte-exact');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sqm1-his-v4-'));
  try {
    const regenerated = path.join(temporary, 'score-v4.json');
    const result = childProcess.spawnSync('python3', [
      path.join(__dirname, 'generate-sqm1-his-theme-pitch-continuity-v4.py'),
      v3ScoreFile,
      regenerated,
    ], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(fs.readFileSync(regenerated), fs.readFileSync(constants.SCORE_DEFAULT),
      'Pitch-continuity score regenerates byte-for-byte');
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }

  console.log('SQM1 His Theme pitch-continuity V4 checks passed: all 1,936 V3 onsets, '
    + 'the exact 358-cut/216.100795475-second sustain budget, 24 valid lanes, octave retunes '
    + 'reduced from 686 to 162, short two-octave retunes reduced from 111 to 2, strict '
    + `placement and deterministic SHA-256 ${EXPECTED_ARTIFACT_SHA256}.`);
  return {placement, sha256: EXPECTED_ARTIFACT_SHA256};
};

if (require.main === module) {
  const build = require('./build-sqm1-his-theme-pitch-continuity-v4.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'His Theme pitch-continuity V4 cartridge build is deterministic');
}
