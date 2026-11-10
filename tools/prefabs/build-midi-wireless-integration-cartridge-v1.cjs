'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N, B, S} = require('./loadboard-lib.cjs');

const FONT = [{type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}];
const PREFIX = 'MWIC1';
const TRANSPORT_MAGIC = 7702001;
const SCORE_MAGIC = 7701001;
const SCORE_FORMAT = 1;
const CHANNEL = 1;
const TITLE = 'SQM1 two-voice load/play test';
const PREFERRED_MODE = 0;
const REQUEST_EVENT = 'SQM1.Request';
const OFFER_EVENT = 'SQM1.Offer';
const ACK_EVENT = 'SQM1.Ack';

function makeScore() {
  const values = [
    {X: SCORE_MAGIC, Y: SCORE_FORMAT, Z: 2, W: 8},
    {X: 34, Y: 0.15, Z: 48, W: 72},
    {X: 34, Y: 8, Z: 0, W: 0},
    {X: 42, Y: 4, Z: 40, W: 16},
  ];
  while (values.length < 34) values.push({X: 46, Y: 0, Z: -1, W: -1});
  values.push(
    {X: 0, Y: 0.75, Z: 60, W: 104},
    {X: 1, Y: 1.75, Z: 64, W: 100},
    {X: 2, Y: 2.75, Z: 67, W: 104},
    {X: 3, Y: 3.75, Z: 72, W: 110},
    {X: 4, Y: 4.75, Z: 67, W: 100},
    {X: 5, Y: 5.75, Z: 64, W: 98},
    {X: 6, Y: 6.75, Z: 60, W: 104},
    {X: 7, Y: 7.75, Z: 67, W: 100},
    {X: 0, Y: 1.75, Z: 48, W: 82},
    {X: 2, Y: 3.75, Z: 55, W: 84},
    {X: 4, Y: 5.75, Z: 53, W: 82},
    {X: 6, Y: 7.75, Z: 55, W: 86},
  );
  assert.equal(values.length, 46);
  return Object.freeze(values.map(value => Object.freeze(value)));
}

const SCORE = makeScore();

function wireValue(value) {
  if (typeof value === 'boolean') return B(value);
  if (typeof value === 'string') return S(value);
  if (typeof value === 'number') return N(value);
  return value;
}

module.exports = function buildMidiWirelessIntegrationCartridgeV1() {
  const b = new Build('SQM1 Two-Voice Test Cartridge V1', FONT);
  const shell = b.w.addMicrochip({position: [48, -120, 4], color: [45, 155, 90]});
  const disk = b.circuit(shell.grid, 'cartridge');
  const records = [];

  function marked(label, key, data, color) {
    const definition = C[key];
    const i = disk.i++;
    const position = [(i % 16) * 48, Math.floor(i / 16) * 48, 2];
    const node = {
      id: `cartridge_marked_${label}`,
      type: definition.NAME,
      pos: position,
      grid: disk.grid,
      data,
    };
    b.add(node, {
      asset: definition.BRICK,
      ...(definition.BRICK.startsWith('PB_Gate_') ? {size: [10, 5, 2]} : {}),
      position,
      color,
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:${label}`, bHiddenInteraction: true}},
      ],
    }, disk.grid);
    records.push({label, node, key});
    return node;
  }

  const saved = (label, value) => marked(`state.${label}`, 'Var', {
    Value: wireValue(value),
  }, [205, 145, 45]);
  const song = marked('score', 'ArrayVar', {
    Value: {$elementType: 'Quat', $array: SCORE.map(value => ({...value}))},
  }, [65, 175, 105]);

  const requestReceived = saved('request.received', 0);
  const requestAccepted = saved('request.accepted', 0);
  const requestRejected = saved('request.rejected', 0);
  const requestValid = saved('request.valid', false);
  const requestNonce = saved('request.nonce', -1);
  const requestMode = saved('request.mode', -1);
  const seenMagic = saved('request.seen.magic', -1);
  const seenChannel = saved('request.seen.channel', -1);
  const seenNonce = saved('request.seen.nonce', -1);
  const seenMode = saved('request.seen.mode', -1);
  const seenMaxVoices = saved('request.seen.maxVoices', -1);
  const seenCapacity = saved('request.seen.capacity', -1);
  const seenFormat = saved('request.seen.format', -1);
  const seenCapabilities = saved('request.seen.capabilities', -1);
  const offerSent = saved('offer.sent', 0);
  const sendBlocked = saved('offer.blocked', 0);
  const awaitingAck = saved('ack.awaiting', false);
  const ackReceived = saved('ack.received', 0);
  const ackAccepted = saved('ack.accepted', 0);
  const ackRejected = saved('ack.rejected', 0);
  const ackNonce = saved('ack.nonce', -1);
  const ackResult = saved('ack.result', 0);
  const ackCopiedLength = saved('ack.copiedLength', -1);
  const ackStatus = saved('ack.status', 'No acknowledgment');
  const ackMode = saved('ack.mode', -1);

  const request = disk.event(REQUEST_EVENT,
    [N(0), N(0), N(0), N(0), N(0), N(0), N(0), N(0)], false);
  const countRequest = disk.n('Exec_Var_Increment', {
    VarRef: R(requestReceived, 'VarRef'), Value: N(1),
  });
  disk.link(request, countRequest, 'ExecOut');
  const requestSnapshots = [
    [seenMagic, 'DataOut1'], [seenChannel, 'DataOut2'], [seenNonce, 'DataOut3'],
    [seenMode, 'DataOut4'], [seenMaxVoices, 'DataOut5'], [seenCapacity, 'DataOut6'],
    [seenFormat, 'DataOut7'], [seenCapabilities, 'DataOut8'],
  ];
  let requestTail = countRequest;
  for (const [target, port] of requestSnapshots) {
    const capture = disk.set(target, R(request, port));
    disk.link(requestTail, capture);
    requestTail = capture;
  }

  const requestEligible = disk.and(
    disk.cmp('Equal', R(request, 'DataOut1'), N(TRANSPORT_MAGIC)),
    disk.cmp('Equal', R(request, 'DataOut2'), N(CHANNEL)),
    disk.cmp('GreaterOrEqual', R(request, 'DataOut5'), N(2)),
    disk.cmp('GreaterOrEqual', R(request, 'DataOut6'), N(SCORE.length)),
    disk.cmp('Equal', R(request, 'DataOut7'), N(SCORE_FORMAT)),
    disk.cmp('GreaterOrEqual', R(request, 'DataOut8'), N(1)),
  );
  const requestBranch = disk.branch(requestTail, requestEligible);
  const latchNonce = disk.set(requestNonce, R(request, 'DataOut3'));
  const latchMode = disk.set(requestMode, R(request, 'DataOut4'));
  const markValid = disk.set(requestValid, true);
  const countAccepted = disk.n('Exec_Var_Increment', {
    VarRef: R(requestAccepted, 'VarRef'), Value: N(1),
  });
  disk.link(requestBranch, latchNonce, 'ExecOutA');
  disk.link(latchNonce, latchMode);
  disk.link(latchMode, markValid);
  disk.link(markValid, countAccepted);
  const countRejected = disk.n('Exec_Var_Increment', {
    VarRef: R(requestRejected, 'VarRef'), Value: N(1),
  });
  disk.link(requestBranch, countRejected, 'ExecOutB');

  const sendButton = {
    id: 'send_song_button',
    type: C.Button.NAME,
    pos: [-48, -120, 4],
    grid: undefined,
    data: {
      PromptCustomLabel: 'Send SQM1 test song',
      bAllowNearbyInteraction: true,
      bHiddenInteraction: false,
    },
  };
  b.add(sendButton, {
    asset: C.Button.BRICK,
    position: sendButton.pos,
    direction: 4,
    rotation: 2,
    color: [35, 215, 105],
    components: [
      {type: sendButton.type, data: sendButton.data},
      {type: C.Interact.NAME, data: {Message: `${PREFIX}:button.send`, bHiddenInteraction: true}},
    ],
  });
  const sendEdge = disk.edge(R(sendButton, 'bHeld'));
  const canSend = disk.branch(sendEdge, R(requestValid), 'OnRisingEdge');
  const getLength = disk.ao('GetLength', song);
  disk.link(canSend, getLength, 'ExecOutA');
  const markAwaiting = disk.set(awaitingAck, true);
  disk.link(getLength, markAwaiting);
  const offer = disk.send(OFFER_EVENT, [
    N(TRANSPORT_MAGIC), N(CHANNEL), R(song, 'ArrayVarRef'), R(requestNonce),
    R(getLength, 'Length'), S(TITLE), N(PREFERRED_MODE), N(SCORE_FORMAT),
  ]);
  disk.link(markAwaiting, offer, 'ExecOut', 'ExecIn');
  const countOffer = disk.n('Exec_Var_Increment', {
    VarRef: R(offerSent, 'VarRef'), Value: N(1),
  });
  disk.link(offer, countOffer);
  const clearRequest = disk.set(requestValid, false);
  disk.link(countOffer, clearRequest);
  const countBlocked = disk.n('Exec_Var_Increment', {
    VarRef: R(sendBlocked, 'VarRef'), Value: N(1),
  });
  disk.link(canSend, countBlocked, 'ExecOutB');

  const ack = disk.event(ACK_EVENT,
    [N(0), N(0), N(0), N(0), N(0), S(''), N(0), N(0)], false);
  const countAck = disk.n('Exec_Var_Increment', {
    VarRef: R(ackReceived, 'VarRef'), Value: N(1),
  });
  disk.link(ack, countAck, 'ExecOut');
  const ackSnapshots = [
    [ackNonce, 'DataOut3'], [ackResult, 'DataOut4'], [ackCopiedLength, 'DataOut5'],
    [ackStatus, 'DataOut6'], [ackMode, 'DataOut7'],
  ];
  let ackTail = countAck;
  for (const [target, port] of ackSnapshots) {
    const capture = disk.set(target, R(ack, port));
    disk.link(ackTail, capture);
    ackTail = capture;
  }
  const ackMatches = disk.and(
    disk.cmp('Equal', R(ack, 'DataOut1'), N(TRANSPORT_MAGIC)),
    disk.cmp('Equal', R(ack, 'DataOut2'), N(CHANNEL)),
    disk.cmp('Equal', R(ack, 'DataOut3'), R(requestNonce)),
    R(awaitingAck),
  );
  const ackBranch = disk.branch(ackTail, ackMatches);
  const countAckAccepted = disk.n('Exec_Var_Increment', {
    VarRef: R(ackAccepted, 'VarRef'), Value: N(1),
  });
  disk.link(ackBranch, countAckAccepted, 'ExecOutA');
  const clearAwaiting = disk.set(awaitingAck, false);
  disk.link(countAckAccepted, clearAwaiting);
  const countAckRejected = disk.n('Exec_Var_Increment', {
    VarRef: R(ackRejected, 'VarRef'), Value: N(1),
  });
  disk.link(ackBranch, countAckRejected, 'ExecOutB');

  function addDisplay(id, position, size, text, color = [225, 235, 245]) {
    const node = {
      id,
      type: C.TextDisplay.NAME,
      pos: position,
      grid: undefined,
      data: {
        Text: typeof text === 'string' ? text : 'Waiting',
        Font: 0,
        Face: 0,
        LineHeight: 1.15,
        WidthScale: 0.76,
        bEnabled: true,
        Color: {R: color[0], G: color[1], B: color[2], A: 255},
        bOverrideColor: true,
      },
    };
    b.add(node, {
      asset: 'PB_DefaultMicroBrick',
      size,
      position,
      direction: 4,
      rotation: 2,
      color: [13, 18, 28],
      components: [{type: node.type, data: node.data}],
    });
    if (Array.isArray(text)) disk.bind(node, 'Text', text);
    return node;
  }

  addDisplay('instructions', [0, 0, 92], [1, 140, 14],
    'WIRELESS MIDI CARTRIDGE V1\r\n'
      + '1. Press LOAD / LISTEN on player.  2. Press green SEND here.\r\n'
      + 'Wait for ACK result 1, then remove this cartridge and test player playback.',
    [115, 225, 255]);
  const requestStatus = disk.fmt(
    'REQUESTS received {A} | accepted {B} | rejected {C}\r\nValid {D} | nonce {E} | offers {F} | blocked sends {G}',
    R(requestReceived), R(requestAccepted), R(requestRejected), R(requestValid),
    R(requestNonce), R(offerSent), R(sendBlocked));
  const requestDisplay = addDisplay('request_status', [0, 0, 52], [1, 140, 14],
    requestStatus, [255, 225, 125]);
  const ackStatusText = disk.fmt(
    'ACKS received {A} | accepted {B} | rejected {C}\r\nResult {D} | copied {E}/46 | mode {F} | awaiting {G}',
    R(ackReceived), R(ackAccepted), R(ackRejected), R(ackResult),
    R(ackCopiedLength), R(ackMode), R(awaitingAck));
  const ackDisplay = addDisplay('ack_status', [0, 0, 16], [1, 140, 12],
    ackStatusText, [170, 255, 180]);

  const bytes = b.finish(
    {x: 155, y: 145, z: 115},
    'Standalone SQM1 wireless MIDI cartridge with a deterministic two-voice, twelve-note '
      + 'C-major test. It latches a compatible player request, offers its Quat ArrayVar by '
      + 'reference on the green button, and retains the player acknowledgment.',
  );
  return {
    bytes, b, disk, records, shell, song, sendButton, sendEdge, request, offer, ack,
    requestReceived, requestAccepted, requestRejected, requestValid, requestNonce, requestMode,
    seenMagic, seenChannel, seenNonce, seenMode, seenMaxVoices, seenCapacity,
    seenFormat, seenCapabilities, offerSent, sendBlocked, awaitingAck,
    ackReceived, ackAccepted, ackRejected, ackNonce, ackResult, ackCopiedLength,
    ackStatus, ackMode, getLength, requestDisplay, ackDisplay,
    SCORE, TRANSPORT_MAGIC, SCORE_MAGIC, SCORE_FORMAT, CHANNEL, TITLE, PREFERRED_MODE,
    REQUEST_EVENT, OFFER_EVENT, ACK_EVENT,
  };
};

module.exports.SCORE = SCORE;

if (require.main === module) {
  const output = process.argv[2];
  assert(output,
    'Usage: node build-midi-wireless-integration-cartridge-v1.cjs <output.brz>');
  try {
    const context = module.exports();
    require('./test-midi-wireless-integration-cartridge-v1.cjs')(context);
    fs.writeFileSync(output, context.bytes);
    console.log(JSON.stringify({
      output,
      bytes: context.bytes.length,
      scoreQuaternions: context.SCORE.length,
      notes: context.SCORE.length - 34,
      components: context.b.nodes.length,
      wires: context.b.edges.length,
    }, null, 2));
  } catch (error) {
    console.error(String(error.message).slice(0, 2500));
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
