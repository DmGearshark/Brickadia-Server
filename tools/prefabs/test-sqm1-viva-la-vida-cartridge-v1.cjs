'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testSqm1VivaLaVidaCartridgeV1(context) {
  const {scene, bytes, score, constants} = context;
  const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const compOf = type => bricksOf(type).map(brick => ({brick, comp: component(brick, type)}));
  const one = (items, label) => {
    assert.equal(items.length, 1, label);
    return items[0];
  };
  const marked = label => one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `MWIC1:${label}`), `MWIC1:${label}`);
  const incoming = (brick, type, port) => scene.edges.filter(edge =>
    edge.z === brick.key && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge =>
    edge.a === brick.key && edge.at === type && edge.p === port);
  const edge = (source, sourceType, sourcePort, target, targetType, targetPort) =>
    scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
      && candidate.p === sourcePort && candidate.z === target.key
      && candidate.zt === targetType && candidate.q === targetPort);
  const scalar = value => value && typeof value === 'object' && 'value' in value
    ? value.value : value;

  const placement = validatePlacement(bytes);
  assert.equal(placement.strictOk, true, JSON.stringify(placement));
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);

  const prefab = scene.r.prefabJson();
  assert.equal(prefab.bIsPhysicsGrid, true, 'PrefabSpawner must own the visible cartridge root');
  assert.equal(prefab.bFreezePhysicsGrid, false);
  assert.equal([...scene.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid').length, 0,
  'Visible cartridge must not be hidden in a child dynamic entity');
  const rootBricks = scene.bricks.filter(brick => brick.g === 1);
  assert.equal(rootBricks.length, 2, 'Physics root contains only the plate and root chip');
  const rootChip = one(rootBricks.filter(brick => component(brick, C.Microchip.NAME)),
    'physics-root microchip');
  const rootTitle = one(rootBricks.filter(brick => component(brick, C.TextDisplay.NAME)),
    'physics-root title plate');
  assert.equal(component(rootTitle, C.TextDisplay.NAME).data.Text, constants.TITLE);
  assert.equal(scene.links.filter(link => link.key === rootChip.key).length, 1,
    'Root chip must link to the nested cartridge logic');
  assert.equal(bricksOf(C.Button.NAME).length, 0, 'Automatic cartridge has no manual send button');

  const scoreBrick = marked('score');
  const savedScore = component(scoreBrick, C.ArrayVar.NAME).data.Value;
  assert.equal(savedScore.$elementType, 'Quat');
  assert.equal(savedScore.$array.length, 3464);
  assert.deepEqual(savedScore.$array, score.values, 'Saved cartridge score must match source JSON');
  assert.deepEqual(savedScore.$array[0],
    {X: 7701001, Y: 1, Z: 18, W: 239.998867144});
  assert.deepEqual(savedScore.$array[1], {X: 34, Y: 0.2, Z: 32, W: 80});
  assert.equal(score.document.statistics.notes, 3430);
  assert.equal(score.document.statistics.durationSeconds, 239.998867144);
  assert.equal(score.document.statistics.arrayEntries, 3464);
  assert.equal(score.document.statistics.allocatedVoices, 18);
  assert.equal(score.document.statistics.maximumKeyDownPolyphony, 9);
  assert.equal(score.document.statistics.maximumReservedPolyphony, 18);
  assert.equal(score.document.statistics.instrumentGroups, 3);
  assert.equal(score.document.statistics.minimumPitch, 32);
  assert.equal(score.document.statistics.maximumPitch, 80);
  assert.equal(score.document.source.sha256, constants.SOURCE_MIDI_SHA256);

  let expectedOffset = 34;
  let countedNotes = 0;
  for (let voiceIndex = 0; voiceIndex < 32; voiceIndex++) {
    const header = savedScore.$array[2 + voiceIndex];
    if (voiceIndex >= 18) {
      assert.deepEqual(header, {X: 3464, Y: 0, Z: -1, W: -1},
        `inactive voice header ${voiceIndex}`);
      continue;
    }
    const voice = score.document.voices[voiceIndex];
    assert.deepEqual(header, {X: voice.offset, Y: voice.count,
      Z: voice.instrumentCode, W: voice.channelTrackCode}, `voice header ${voiceIndex}`);
    assert.equal(header.X, expectedOffset, `voice ${voiceIndex} begins after the prior lane`);
    const notes = savedScore.$array.slice(header.X, header.X + header.Y);
    assert.equal(notes.length, header.Y);
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const note = notes[noteIndex];
      assert(note.X >= 0 && note.X < 239.998867144,
        `voice ${voiceIndex} note ${noteIndex} start`);
      assert(note.Y > note.X && note.Y <= 239.998867144,
        `voice ${voiceIndex} note ${noteIndex} end`);
      assert(Number.isInteger(note.Z) && note.Z >= 32 && note.Z <= 80,
        `voice ${voiceIndex} note ${noteIndex} pitch`);
      assert(Number.isInteger(note.W) && note.W >= 1 && note.W <= 127,
        `voice ${voiceIndex} note ${noteIndex} velocity`);
      if (noteIndex > 0) assert(note.X >= notes[noteIndex - 1].X,
        `voice ${voiceIndex} notes are ordered`);
    }
    expectedOffset += header.Y;
    countedNotes += header.Y;
  }
  assert.equal(expectedOffset, 3464);
  assert.equal(countedNotes, 3430);

  const request = one(compOf(C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Request'), 'request receiver').brick;
  const ack = one(compOf(C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Ack'), 'ack receiver').brick;
  const offer = one(compOf(C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Offer'), 'offer sender').brick;
  assert.equal(component(request, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  assert.equal(component(ack, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, true);
  assert.equal(incoming(offer, C.Exec_SendCustomEventGlobal.NAME, 'Target').length, 0,
    'Offer remains a broadcast to preserve the live-proven ArrayVarRef path');
  assert(edge(scoreBrick, C.ArrayVar.NAME, 'ArrayVarRef', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'));
  const offerData = component(offer, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(offerData.DataIn1), 7702001);
  assert.equal(scalar(offerData.DataIn2), 1);
  assert.equal(scalar(offerData.DataIn6), constants.TITLE);
  assert.equal(scalar(offerData.DataIn7), 0);
  assert.equal(scalar(offerData.DataIn8), 1);

  for (const [port, expected] of [['DataOut5', 18], ['DataOut6', 3464]]) {
    const comparisonEdge = one(outgoing(request, C.Event_CustomGlobal.NAME, port)
      .filter(candidate => candidate.q === 'InputA'), `${port} compatibility comparison`);
    const comparison = one(scene.bricks.filter(brick => brick.key === comparisonEdge.z),
      `${port} comparison brick`);
    const comparisonComponent = component(comparison, comparisonEdge.zt);
    assert.equal(scalar(comparisonComponent.data.InputB), expected,
      `${port} must require the full Viva score`);
  }

  const accepted = marked('state.request.accepted');
  const acceptedCounterEdge = one(outgoing(accepted, C.Var.NAME, 'VarRef')
    .filter(candidate => candidate.q === 'VarRef'), 'accepted counter edge');
  const acceptedCounter = one(scene.bricks.filter(brick => brick.key === acceptedCounterEdge.z),
    'accepted counter');
  assert(component(acceptedCounter, C.Exec_Var_Increment.NAME));
  const waitEdge = one(outgoing(acceptedCounter, C.Exec_Var_Increment.NAME, 'ExecOut')
    .filter(candidate => candidate.q === 'Input'), 'automatic offer wait edge');
  const wait = one(scene.bricks.filter(brick => brick.key === waitEdge.z), 'automatic offer wait');
  assert.equal(component(wait, C.BufferTicks.NAME).data.TicksToWait, 1);
  const sendBranchEdge = one(outgoing(wait, C.BufferTicks.NAME, 'Output')
    .filter(candidate => candidate.q === 'Exec'), 'automatic offer branch edge');
  const sendBranch = one(scene.bricks.filter(brick => brick.key === sendBranchEdge.z),
    'automatic offer branch');
  assert(component(sendBranch, C.Exec_Branch.NAME));

  const getLength = one(bricksOf(C.Exec_ArrayVar_GetLength.NAME), 'score length reader');
  assert(edge(scoreBrick, C.ArrayVar.NAME, 'ArrayVarRef', getLength,
    C.Exec_ArrayVar_GetLength.NAME, 'ArrayVarRef'));
  assert(edge(getLength, C.Exec_ArrayVar_GetLength.NAME, 'Length', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn5'));

  const brickByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
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

  console.log('SQM1 Viva La Vida cartridge checks passed: exact 3,464-Quat/18-voice '
    + 'score, strict physics-root placement, object-scoped request/ack, automatic offer, '
    + 'direct ArrayVarRef transport, source title and no manual button.');
  return {placement, scoreLength: savedScore.$array.length, notes: countedNotes,
    activeVoices: 18, durationSeconds: 239.998867144};
};

if (require.main === module) {
  const build = require('./build-sqm1-viva-la-vida-cartridge-v1.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(second.bytes, first.bytes,
    'Viva cartridge build must be byte-for-byte deterministic');
}
