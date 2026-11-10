'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N, B, S} = require('./loadboard-lib.cjs');

const PREFIX = 'MWSP2';
const TRANSPORT_MAGIC = 7702001;
const SCORE_MAGIC = 7701001;
const CHANNEL = 1;
const SCORE_LENGTH = 46;
const TITLE = 'SQM1 two-voice load/play test';
const NULL_COMPONENT_REF = Object.freeze({
  Brick: Object.freeze({GridPersistentIndex: 0,
    ChunkIndex: Object.freeze({X: 0, Y: 0, Z: 0}), BrickIndexInChunk: 4294967295}),
  ComponentTypeIndex: 0,
});
const CR = value => ({$variant: 'BRSavedComponentRef', value: structuredClone(value)});
const Q = value => ({$variant: 'Quat', value: {...value}});

function wireValue(value) {
  if (typeof value === 'boolean') return B(value);
  if (typeof value === 'string') return S(value);
  if (typeof value === 'number') return N(value);
  return value;
}

module.exports = function buildMidiWirelessSinePlayerIntegrationV2() {
  const assets = [
    {type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'},
    {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'},
  ];
  const b = new Build('MIDI Wireless Sine Player Integration V2', assets);
  const shell = b.w.addMicrochip({position: [0, -144, 4], color: [45, 115, 210]});
  const c = b.circuit(shell.grid, 'player');
  const records = [];

  function marked(label, key, data, color = [205, 145, 45]) {
    const definition = C[key];
    const i = c.i++;
    const position = [(i % 16) * 48, Math.floor(i / 16) * 48, 2];
    const node = {id: `${c.prefix}_marked_${label}`, type: definition.NAME,
      pos: position, grid: c.grid, data};
    b.add(node, {
      asset: definition.BRICK,
      ...(definition.BRICK.startsWith('PB_Gate_') ? {size: [10, 5, 2]} : {}),
      position, color,
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:${label}`, bHiddenInteraction: true}},
      ],
    }, c.grid);
    records.push({label, key, node});
    return node;
  }
  const saved = (label, value) => marked(label, 'Var', {Value: wireValue(value)});
  const savedArray = label => marked(label, 'ArrayVar', {
    Value: {$elementType: 'Quat', $array: []},
  }, [70, 170, 120]);

  function physicalButton(id, label, position, color, marker) {
    const node = {id, type: C.Button.NAME, pos: position, grid: undefined,
      data: {PromptCustomLabel: label, bAllowNearbyInteraction: true, bHiddenInteraction: false}};
    b.add(node, {
      asset: 'PB_DefaultMicroBrick', size: [8, 12, 7], position,
      direction: 4, rotation: 2, color,
      components: [
        {type: node.type, data: node.data},
        {type: C.Interact.NAME, data: {Message: `${PREFIX}:button:${marker}`, bHiddenInteraction: true}},
      ],
    });
    return node;
  }

  function display(id, position, size, text, color = [225, 235, 245]) {
    const node = {id, type: C.TextDisplay.NAME, pos: position, grid: undefined,
      data: {Text: typeof text === 'string' ? text : 'Waiting', Font: 0, Face: 0,
        LineHeight: 1.12, WidthScale: 0.74, bEnabled: true,
        Color: {R: color[0], G: color[1], B: color[2], A: 255}, bOverrideColor: true}};
    b.add(node, {asset: 'PB_DefaultMicroBrick', size, position, direction: 4, rotation: 2,
      color: [13, 18, 28], components: [{type: node.type, data: node.data}]});
    if (Array.isArray(text)) c.bind(node, 'Text', text);
    return node;
  }

  function callableDecodeNote() {
    const definition = C.Microchip_FunctionDefinition;
    const i = c.i++;
    const position = [(i % 16) * 48, Math.floor(i / 16) * 48, 2];
    const node = {id: 'decode_note_definition', type: definition.NAME,
      pos: position, grid: c.grid, data: {}};
    b.add(node, {asset: definition.BRICK, position, color: [145, 85, 200], components: [
      {type: node.type, data: node.data},
      {type: C.Interact.NAME, data: {Message: `${PREFIX}:chip:DecodeNote`, bHiddenInteraction: true}},
    ]}, c.grid);
    const grid = b.w.addBrickGrid({
      type: 'Entity_MicrochipDynamicBrickGrid',
      location: {X: position[0], Y: position[1], Z: 40},
      data: {bCollapsed: true, PlaneCenter: {X: 0, Y: 0, Z: 0},
        PlaneExtent: {X: 14, Y: 14, Z: 2}},
    });
    b.w.registerMicrochipLink(node.handle, grid);
    const fc = b.circuit(grid, 'decode');
    const entry = fc.n('CallableEntry_Function');
    const input = fc.n('FunctionInput', {PortLabel: 'Note Quaternion', PortOrder: 1,
      DefaultValue: Q({X: 0, Y: 1, Z: 69, W: 100})});
    const split = fc.n('Expr_SplitQuaternion', {Input: R(input)});
    const semitone = fc.n('Expr_MathSubtract', {InputA: R(split, 'Z'), InputB: N(69)});
    const octave = fc.n('Expr_MathDivide', {InputA: R(semitone, 'Output'), InputB: N(12)});
    const pitch = fc.n('Expr_MathPow', {Input: 2, Exponent: R(octave, 'Output')});
    const velocityUnit = fc.n('Expr_MathDivide', {InputA: R(split, 'W'), InputB: N(127)});
    const velocity = fc.n('Expr_MathPow', {Input: R(velocityUnit, 'Output'), Exponent: 1.4});
    fc.n('FunctionOutput', {PortLabel: 'Start Seconds', PortOrder: 1,
      DefaultValue: N(-101), Value: R(split, 'X')});
    fc.n('FunctionOutput', {PortLabel: 'End Seconds', PortOrder: 2,
      DefaultValue: N(-102), Value: R(split, 'Y')});
    fc.n('FunctionOutput', {PortLabel: 'Pitch Ratio', PortOrder: 3,
      DefaultValue: N(-103), Value: R(pitch, 'Output')});
    fc.n('FunctionOutput', {PortLabel: 'Velocity Curve', PortOrder: 4,
      DefaultValue: N(-104), Value: R(velocity, 'Output')});
    const terminal = fc.n('Exec_Union');
    fc.link(entry, terminal, 'Body', 'ExecA');
    return {node, grid, circuit: fc};
  }

  const requestButton = physicalButton('request_button', 'LOAD / LISTEN',
    [-112, -144, 4], [45, 175, 245], 'request');
  const playButton = physicalButton('play_button', 'PLAY LOCAL COPY',
    [-32, -144, 4], [155, 75, 215], 'play');
  const stopButton = physicalButton('stop_button', 'STOP',
    [48, -144, 4], [220, 75, 70], 'stop');

  const requestInput = c.n('MicrochipInput', {PortLabel: 'Load Disk (Pulse)', PortOrder: 1,
    CallableDefault: B(false), CallableMirror: B(false)});
  const playInput = c.n('MicrochipInput', {PortLabel: 'Play (Pulse)', PortOrder: 2,
    CallableDefault: B(false), CallableMirror: B(false)});
  const stopInput = c.n('MicrochipInput', {PortLabel: 'Stop (Pulse)', PortOrder: 3,
    CallableDefault: B(false), CallableMirror: B(false)});
  const pitchInput = c.n('MicrochipInput', {PortLabel: 'Pitch Multiplier', PortOrder: 4,
    CallableDefault: N(1), CallableMirror: N(1)});
  const speedInput = c.n('MicrochipInput', {PortLabel: 'Speed Multiplier', PortOrder: 5,
    CallableDefault: N(1), CallableMirror: N(1)});
  const volumeInput = c.n('MicrochipInput', {PortLabel: 'Master Volume', PortOrder: 6,
    CallableDefault: N(0.08), CallableMirror: N(0.08)});

  const staging = savedArray('player.staging');
  const activeScore = savedArray('player.active');
  const nonce = saved('request.nonce', 0);
  const waiting = saved('request.waiting', false);
  const copyBusy = saved('copy.busy', false);
  const loaded = saved('loaded', false);
  const running = saved('running', false);
  const starting = saved('playback.starting', false);
  const validationCompleted = saved('validation.completed', 0);
  const validationPassed = saved('validation.passed', false);
  const validationResult = saved('validation.result', 0);
  const requestSent = saved('request.sent', 0);
  const offerReceived = saved('offer.received', 0);
  const offerAccepted = saved('offer.accepted', 0);
  const offerRejected = saved('offer.rejected', 0);
  const seenMagic = saved('offer.seen.magic', -1);
  const seenChannel = saved('offer.seen.channel', -1);
  const seenNonce = saved('offer.seen.nonce', -1);
  const seenLength = saved('offer.seen.length', -1);
  const seenTitle = saved('offer.seen.title', '');
  const seenMode = saved('offer.seen.mode', -1);
  const seenFormat = saved('offer.seen.format', -1);
  const stagingCopies = saved('staging.copy.completed', 0);
  const activeCopies = saved('active.copy.completed', 0);
  const ackSent = saved('ack.sent', 0);
  const stagingLength = saved('staging.length', -1);
  const activeLength = saved('active.length', -1);
  const title = saved('title', 'No song loaded');
  const playStarted = saved('playback.started', 0);
  const playFinished = saved('playback.finished', 0);
  const playStopped = saved('playback.stoppedManually', 0);
  const notesArmed = saved('notes.armed', 0);
  const notesFinished = saved('notes.finished', 0);
  const headerIndices = [0, 1, 2, 3, 33];
  const headers = headerIndices.map(index =>
    saved(`header.q${index}`, Q({X: -1, Y: -1, Z: -1, W: -1})));
  const activeHeaders = headerIndices.map(index =>
    saved(`active.header.q${index}`, Q({X: -1, Y: -1, Z: -1, W: -1})));

  const requestSignal = c.n('Expr_LogicalOR', {
    bInputA: R(requestButton, 'bHeld'), bInputB: R(requestInput, 'RER_Output'),
  });
  const requestEdge = c.edge(R(requestSignal, 'bOutput'));
  const incrementNonce = c.n('Exec_Var_Increment', {VarRef: R(nonce, 'VarRef'), Value: N(1)});
  c.link(requestEdge, incrementNonce, 'OnRisingEdge');
  const countRequest = c.n('Exec_Var_Increment', {VarRef: R(requestSent, 'VarRef'), Value: N(1)});
  c.link(incrementNonce, countRequest);
  const markWaiting = c.set(waiting, true);
  c.link(countRequest, markWaiting);
  const clearValidation = c.set(validationPassed, false);
  c.link(markWaiting, clearValidation);
  const request = c.send('SQM1.Request', [
    N(TRANSPORT_MAGIC), N(CHANNEL), R(nonce), N(0), N(2), N(256), N(1), N(3),
  ]);
  c.link(clearValidation, request, 'ExecOut', 'ExecIn');
  // Keep the request window open until a matching offer is accepted. The V1
  // ten-second QueueSeconds window proved too short for an operator to walk
  // between two separate entities and press the cartridge button. The nonce,
  // channel, title, mode and format checks still reject stale or unrelated
  // offers, and a new request advances the nonce.

  const offer = c.event('SQM1.Offer', [
    N(0), N(0), CR(NULL_COMPONENT_REF), N(0), N(0), S(''), N(0), N(0),
  ], false);
  const countOffer = c.n('Exec_Var_Increment', {VarRef: R(offerReceived, 'VarRef'), Value: N(1)});
  c.link(offer, countOffer, 'ExecOut');
  const seenSetters = [
    c.set(seenMagic, R(offer, 'DataOut1')),
    c.set(seenChannel, R(offer, 'DataOut2')),
    c.set(seenNonce, R(offer, 'DataOut4')),
    c.set(seenLength, R(offer, 'DataOut5')),
    c.set(seenTitle, R(offer, 'DataOut6')),
    c.set(seenMode, R(offer, 'DataOut7')),
    c.set(seenFormat, R(offer, 'DataOut8')),
  ];
  let offerTail = countOffer;
  for (const setter of seenSetters) {
    c.link(offerTail, setter);
    offerTail = setter;
  }
  const goodMagic = c.cmp('Equal', R(offer, 'DataOut1'), N(TRANSPORT_MAGIC));
  const goodChannel = c.cmp('Equal', R(offer, 'DataOut2'), N(CHANNEL));
  const goodNonce = c.cmp('Equal', R(offer, 'DataOut4'), R(nonce));
  const goodLength = c.cmp('Equal', R(offer, 'DataOut5'), N(SCORE_LENGTH));
  const goodTitle = c.cmp('Equal', R(offer, 'DataOut6'), S(TITLE));
  const goodMode = c.cmp('Equal', R(offer, 'DataOut7'), N(0));
  const goodFormat = c.cmp('Equal', R(offer, 'DataOut8'), N(1));
  const notBusy = c.not(R(copyBusy));
  const envelopeAccepted = c.and(goodMagic, goodChannel, goodNonce, goodLength,
    goodTitle, goodMode, goodFormat, R(waiting), notBusy);
  const offerBranch = c.branch(offerTail, envelopeAccepted);
  const countAccepted = c.n('Exec_Var_Increment', {
    VarRef: R(offerAccepted, 'VarRef'), Value: N(1),
  });
  const countRejected = c.n('Exec_Var_Increment', {
    VarRef: R(offerRejected, 'VarRef'), Value: N(1),
  });
  c.link(offerBranch, countAccepted, 'ExecOutA');
  c.link(offerBranch, countRejected, 'ExecOutB');
  const closeWindow = c.set(waiting, false);
  c.link(countAccepted, closeWindow);
  const setBusy = c.set(copyBusy, true);
  c.link(closeWindow, setBusy);
  const saveTitle = c.set(title, R(offer, 'DataOut6'));
  c.link(setBusy, saveTitle);
  const copyStaging = c.n('Exec_ArrayVar_CopyFrom', {
    ArrayVarRef: R(staging, 'ArrayVarRef'), SourceRef: R(offer, 'DataOut3'),
  });
  c.link(saveTitle, copyStaging);
  const countStaging = c.n('Exec_Var_Increment', {
    VarRef: R(stagingCopies, 'VarRef'), Value: N(1),
  });
  c.link(copyStaging, countStaging);
  const afterStagingCopy = c.wait(countStaging, 1);
  const getStagingLength = c.ao('GetLength', staging);
  c.link(afterStagingCopy, getStagingLength, 'Output');
  const stagingLengthReady = c.wait(getStagingLength, 1);
  const saveStagingLength = c.set(stagingLength, R(getStagingLength, 'Length'));
  c.link(stagingLengthReady, saveStagingLength, 'Output');

  let headerTail = saveStagingLength;
  const headerGets = [];
  for (let index = 0; index < headers.length; index++) {
    const get = c.ao('Get', staging, {Index: headerIndices[index]});
    c.link(headerTail, get);
    const ready = c.wait(get, 1);
    const save = c.set(headers[index], R(get, 'Value'));
    c.link(ready, save, 'Output');
    headerTail = save;
    headerGets.push(get);
  }
  const headerSplits = headers.map(header => c.n('Expr_SplitQuaternion', {Input: R(header)}));
  const expectedHeaders = [
    [SCORE_MAGIC, 1, 2, 8],
    [34, 0.15, 48, 72],
    [34, 8, 0, 0],
    [42, 4, 40, 16],
    [46, 0, -1, -1],
  ];
  const headerChecks = [];
  for (let index = 0; index < headerSplits.length; index++) {
    for (const [fieldIndex, field] of ['X', 'Y', 'Z', 'W'].entries()) {
      headerChecks.push(c.cmp('Equal', R(headerSplits[index], field),
        N(expectedHeaders[index][fieldIndex])));
    }
  }
  const lengthCheck = c.cmp('Equal', R(stagingLength), N(SCORE_LENGTH));
  const allValid = c.and(lengthCheck, ...headerChecks);
  const validationBranch = c.branch(headerTail, allValid);
  const countValidation = c.n('Exec_Var_Increment', {
    VarRef: R(validationCompleted, 'VarRef'), Value: N(1),
  });
  c.link(validationBranch, countValidation, 'ExecOutA');
  const saveValidationTrue = c.set(validationPassed, true);
  c.link(countValidation, saveValidationTrue);
  const saveResultSuccess = c.set(validationResult, 1);
  c.link(saveValidationTrue, saveResultSuccess);
  const haltForCommit = c.set(running, false);
  c.link(saveResultSuccess, haltForCommit);
  const copyActive = c.n('Exec_ArrayVar_CopyFrom', {
    ArrayVarRef: R(activeScore, 'ArrayVarRef'), SourceRef: R(staging, 'ArrayVarRef'),
  });
  c.link(haltForCommit, copyActive);
  const countActive = c.n('Exec_Var_Increment', {
    VarRef: R(activeCopies, 'VarRef'), Value: N(1),
  });
  c.link(copyActive, countActive);
  const afterActiveCopy = c.wait(countActive, 1);
  const getActiveLength = c.ao('GetLength', activeScore);
  c.link(afterActiveCopy, getActiveLength, 'Output');
  const activeLengthReady = c.wait(getActiveLength, 1);
  const saveActiveLength = c.set(activeLength, R(getActiveLength, 'Length'));
  c.link(activeLengthReady, saveActiveLength, 'Output');
  const activeLengthCorrect = c.cmp('Equal', R(activeLength), N(SCORE_LENGTH));
  const activeBranch = c.branch(saveActiveLength, activeLengthCorrect);
  let activeHeaderTail = activeBranch;
  let activeHeaderPort = 'ExecOutA';
  const activeHeaderGets = [];
  for (let index = 0; index < activeHeaders.length; index++) {
    const get = c.ao('Get', activeScore, {Index: headerIndices[index]});
    c.link(activeHeaderTail, get, activeHeaderPort);
    const ready = c.wait(get, 1);
    const save = c.set(activeHeaders[index], R(get, 'Value'));
    c.link(ready, save, 'Output');
    activeHeaderTail = save;
    activeHeaderPort = 'ExecOut';
    activeHeaderGets.push(get);
  }
  const activeHeaderSplits = activeHeaders.map(header =>
    c.n('Expr_SplitQuaternion', {Input: R(header)}));
  const activeHeaderChecks = [];
  for (let index = 0; index < activeHeaderSplits.length; index++) {
    for (const [fieldIndex, field] of ['X', 'Y', 'Z', 'W'].entries()) {
      activeHeaderChecks.push(c.cmp('Equal', R(activeHeaderSplits[index], field),
        N(expectedHeaders[index][fieldIndex])));
    }
  }
  const activeHeadersValid = c.and(...activeHeaderChecks);
  const activeHeaderBranch = c.branch(activeHeaderTail, activeHeadersValid);
  const markLoaded = c.set(loaded, true);
  c.link(activeHeaderBranch, markLoaded, 'ExecOutA');
  const clearBusySuccess = c.set(copyBusy, false);
  c.link(markLoaded, clearBusySuccess);
  const ack = c.send('SQM1.Ack', [N(TRANSPORT_MAGIC), N(CHANNEL), R(nonce),
    N(1), R(activeLength), R(title), N(0), N(0)]);
  c.link(clearBusySuccess, ack, 'ExecOut', 'ExecIn');
  const countAck = c.n('Exec_Var_Increment', {VarRef: R(ackSent, 'VarRef'), Value: N(1)});
  c.link(ack, countAck);
  const activeFailureJoin = c.n('Exec_Union');
  c.link(activeBranch, activeFailureJoin, 'ExecOutB', 'ExecA');
  c.link(activeHeaderBranch, activeFailureJoin, 'ExecOutB', 'ExecB');
  const activeCopyFailure = c.set(validationPassed, false);
  c.link(activeFailureJoin, activeCopyFailure);
  const activeFailureResult = c.set(validationResult, -5);
  c.link(activeCopyFailure, activeFailureResult);
  const activeFailureBusy = c.set(copyBusy, false);
  c.link(activeFailureResult, activeFailureBusy);

  const countInvalid = c.n('Exec_Var_Increment', {
    VarRef: R(validationCompleted, 'VarRef'), Value: N(1),
  });
  c.link(validationBranch, countInvalid, 'ExecOutB');
  const saveValidationFalse = c.set(validationPassed, false);
  c.link(countInvalid, saveValidationFalse);
  const saveResultFailure = c.set(validationResult, -3);
  c.link(saveValidationFalse, saveResultFailure);
  const clearBusyFailure = c.set(copyBusy, false);
  c.link(saveResultFailure, clearBusyFailure);

  const decode = callableDecodeNote();
  const clock = c.n('Stopwatch', {Time: 0, Limit: 1e9, bRunning: true});
  const startTime = saved('playback.start.time', 0);
  const elapsed = c.n('Expr_MathSubtract', {InputA: R(clock, 'Time'), InputB: R(startTime)});
  const musicalTime = c.n('Expr_MathMultiply', {
    InputA: R(elapsed, 'Output'), InputB: R(speedInput, 'RER_Output'),
  });
  const playSignal = c.n('Expr_LogicalOR', {
    bInputA: R(playButton, 'bHeld'), bInputB: R(playInput, 'RER_Output'),
  });
  const notRunning = c.not(R(running));
  const notCopyBusy = c.not(R(copyBusy));
  const canStart = c.and(R(playSignal, 'bOutput'), R(loaded), notRunning, notCopyBusy);
  const playEdge = c.edge(canStart);
  const captureStart = c.set(startTime, R(clock, 'Time'));
  c.link(playEdge, captureStart, 'OnRisingEdge');
  const setStarting = c.set(starting, true);
  c.link(captureStart, setStarting);
  const setRunning = c.set(running, true);
  c.link(setStarting, setRunning);
  const countPlay = c.n('Exec_Var_Increment', {VarRef: R(playStarted, 'VarRef'), Value: N(1)});
  c.link(setRunning, countPlay);
  const startPublication = c.wait(countPlay, 1);
  const clearStarting = c.set(starting, false);
  c.link(startPublication, clearStarting, 'Output');

  const voiceBuilds = [];
  for (let voiceIndex = 0; voiceIndex < 2; voiceIndex++) {
    const header = headerSplits[voiceIndex + 2];
    const index = saved(`voice${voiceIndex}.cursor`, -1);
    const noteLoaded = saved(`voice${voiceIndex}.note.loaded`, false);
    const noteActive = saved(`voice${voiceIndex}.note.active`, false);
    const voiceDone = saved(`voice${voiceIndex}.finished`, false);
    const startHold = saved(`voice${voiceIndex}.note.start`, -1);
    const endHold = saved(`voice${voiceIndex}.note.end`, -1);
    const pitchHold = saved(`voice${voiceIndex}.note.pitch`, 1);
    const velocityHold = saved(`voice${voiceIndex}.note.velocity`, 0);
    const decodeCalls = saved(`voice${voiceIndex}.decode.calls`, 0);
    const decodeCompleted = saved(`voice${voiceIndex}.decode.completed`, 0);
    const decodeFailures = saved(`voice${voiceIndex}.decode.failures`, 0);
    const decodeAbortedCount = saved(`voice${voiceIndex}.decode.abortedCount`, 0);
    const decodeLastAborted = saved(`voice${voiceIndex}.decode.lastAborted`, false);
    const decodeLastIterations = saved(`voice${voiceIndex}.decode.lastIterations`, -1);
    const getterOobCount = saved(`voice${voiceIndex}.getter.outOfBoundsCount`, 0);
    const getterLastOob = saved(`voice${voiceIndex}.getter.lastOutOfBounds`, false);
    const lastNote = saved(`voice${voiceIndex}.lastNote`,
      Q({X: -1, Y: -1, Z: -1, W: -1}));
    const rawOutputs = [0, 1, 2, 3].map(output =>
      saved(`voice${voiceIndex}.decode.rawOutput${output}`, -900 - output));
    const armed = saved(`voice${voiceIndex}.notes.armed`, 0);
    const finished = saved(`voice${voiceIndex}.notes.finished`, 0);
    const enableRises = saved(`voice${voiceIndex}.enable.rises`, 0);
    const enableFalls = saved(`voice${voiceIndex}.enable.falls`, 0);

    const resetIndex = c.set(index, R(header, 'X'));
    c.link(countPlay, resetIndex);
    const clearActive = c.set(noteActive, false);
    c.link(resetIndex, clearActive);
    const clearDone = c.set(voiceDone, false);
    c.link(clearActive, clearDone);
    const clearNoteLoaded = c.set(noteLoaded, false);
    c.link(clearDone, clearNoteLoaded);
    const loadNote = c.n('Exec_Union');
    c.link(clearNoteLoaded, loadNote, 'ExecOut', 'ExecA');
    const getNote = c.ao('Get', activeScore, {Index: R(index)});
    c.link(loadNote, getNote);

    const call = c.n('FunctionCall', {
      Definition: R(decode.node, 'Definition'),
      Input0: Q({X: 0, Y: 1, Z: 69, W: 100}),
      InputSources: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    c.bind(call, 'Input0', R(getNote, 'Value'));
    c.link(getNote, call, 'ExecOut', 'Exec');
    const countCall = c.n('Exec_Var_Increment', {
      VarRef: R(decodeCalls, 'VarRef'), Value: N(1),
    });
    c.link(getNote, countCall, 'ExecOut');
    const saveGetterOob = c.set(getterLastOob, R(getNote, 'bOutOfBounds'));
    c.link(getNote, saveGetterOob, 'ExecOut');
    const getterOobBranch = c.branch(saveGetterOob, R(getNote, 'bOutOfBounds'));
    const countOob = c.n('Exec_Var_Increment', {
      VarRef: R(getterOobCount, 'VarRef'), Value: N(1),
    });
    c.link(getterOobBranch, countOob, 'ExecOutA');

    let captureTail = call;
    let capturePort = 'Completed';
    const captureNote = c.set(lastNote, R(getNote, 'Value'));
    c.link(captureTail, captureNote, capturePort);
    captureTail = captureNote;
    capturePort = 'ExecOut';
    for (let output = 0; output < rawOutputs.length; output++) {
      const capture = c.set(rawOutputs[output], R(call, `Output${output}`));
      c.link(captureTail, capture, capturePort);
      captureTail = capture;
    }
    const saveIterations = c.set(decodeLastIterations, R(call, 'IterationsExecuted'));
    c.link(captureTail, saveIterations);
    const saveAborted = c.set(decodeLastAborted, R(call, 'bAborted'));
    c.link(saveIterations, saveAborted);
    const savePitch = c.set(pitchHold, R(call, 'Output1'));
    c.link(saveAborted, savePitch);
    const saveVelocity = c.set(velocityHold, R(call, 'Output0'));
    c.link(savePitch, saveVelocity);
    const saveStart = c.set(startHold, R(call, 'Output3'));
    c.link(saveVelocity, saveStart);
    const saveEnd = c.set(endHold, R(call, 'Output2'));
    c.link(saveStart, saveEnd);
    const countCompleted = c.n('Exec_Var_Increment', {
      VarRef: R(decodeCompleted, 'VarRef'), Value: N(1),
    });
    c.link(saveEnd, countCompleted);

    const abortBranch = c.branch(countCompleted, R(call, 'bAborted'));
    const countAborted = c.n('Exec_Var_Increment', {
      VarRef: R(decodeAbortedCount, 'VarRef'), Value: N(1),
    });
    c.link(abortBranch, countAborted, 'ExecOutA');
    const abortJoin = c.n('Exec_Union');
    c.link(countAborted, abortJoin, 'ExecOut', 'ExecA');
    c.link(abortBranch, abortJoin, 'ExecOutB', 'ExecB');
    const oneIteration = c.cmp('Equal', R(call, 'IterationsExecuted'), N(1));
    const notAborted = c.not(R(call, 'bAborted'));
    const inBounds = c.not(R(getNote, 'bOutOfBounds'));
    const decodeGood = c.and(oneIteration, notAborted, inBounds);
    const decodeBranch = c.branch(abortJoin, decodeGood);
    const markNoteLoaded = c.set(noteLoaded, true);
    c.link(decodeBranch, markNoteLoaded, 'ExecOutA');
    const countFailure = c.n('Exec_Var_Increment', {
      VarRef: R(decodeFailures, 'VarRef'), Value: N(1),
    });
    c.link(decodeBranch, countFailure, 'ExecOutB');
    const markFailedVoiceDone = c.set(voiceDone, true);
    c.link(countFailure, markFailedVoiceDone);

    const begin = c.cmp('GreaterOrEqual', R(musicalTime, 'Output'), R(startHold));
    const beforeEnd = c.cmp('Less', R(musicalTime, 'Output'), R(endHold));
    const noteWindow = c.and(begin, beforeEnd, R(noteLoaded), R(running));
    const onEdge = c.edge(noteWindow);
    const setActive = c.set(noteActive, true);
    c.link(onEdge, setActive, 'OnRisingEdge');
    const countVoiceArmed = c.n('Exec_Var_Increment', {VarRef: R(armed, 'VarRef'), Value: N(1)});
    c.link(setActive, countVoiceArmed);
    const countArmed = c.n('Exec_Var_Increment', {
      VarRef: R(notesArmed, 'VarRef'), Value: N(1),
    });
    c.link(countVoiceArmed, countArmed);

    const ended = c.cmp('GreaterOrEqual', R(musicalTime, 'Output'), R(endHold));
    const notRun = c.not(R(running));
    const endOrStop = c.or(ended, notRun);
    const endingActive = c.and(endOrStop, R(noteActive));
    const offEdge = c.edge(endingActive);
    const clearActiveAtEnd = c.set(noteActive, false);
    c.link(offEdge, clearActiveAtEnd, 'OnRisingEdge');
    const countVoiceFinished = c.n('Exec_Var_Increment', {
      VarRef: R(finished, 'VarRef'), Value: N(1),
    });
    c.link(clearActiveAtEnd, countVoiceFinished);
    const countFinished = c.n('Exec_Var_Increment', {
      VarRef: R(notesFinished, 'VarRef'), Value: N(1),
    });
    c.link(countVoiceFinished, countFinished);

    const releaseEnd = c.n('Expr_MathAdd', {InputA: R(endHold), InputB: N(0.15)});
    const beforeRelease = c.cmp('LessOrEqual', R(musicalTime, 'Output'), R(releaseEnd, 'Output'));
    const audibleWindow = c.and(begin, beforeRelease, R(noteLoaded), R(running));
    const enableEdge = c.edge(audibleWindow);
    const countEnableRise = c.n('Exec_Var_Increment', {
      VarRef: R(enableRises, 'VarRef'), Value: N(1),
    });
    const countEnableFall = c.n('Exec_Var_Increment', {
      VarRef: R(enableFalls, 'VarRef'), Value: N(1),
    });
    c.link(enableEdge, countEnableRise, 'OnRisingEdge');
    c.link(enableEdge, countEnableFall, 'OnFallingEdge');
    const activeVolume = c.n('Expr_Select', {
      InputA: N(0), InputB: R(velocityHold), bSelectB: R(noteActive),
    });
    const withMaster = c.n('Expr_MathMultiply', {
      InputA: R(activeVolume, 'Output'), InputB: R(volumeInput, 'RER_Output'),
    });
    const envelope = c.n('Dampen', {Target: R(withMaster, 'Output'), SmoothTime: 0.04});
    const pitch = c.n('Expr_MathMultiply', {
      InputA: R(pitchHold), InputB: R(pitchInput, 'RER_Output'),
    });
    const emitter = c.n('AudioEmitter', {
      bEnabled: false, AudioDescriptor: 1, VolumeMultiplier: 0, PitchMultiplier: 1,
      InnerRadius: 400, MaxDistance: 4000, bSpatialization: false,
      FocusAzimuth: 360, NonFocusAzimuth: 360, NonFocusVolumeAttenuation: 1,
    });
    c.bind(emitter, 'bEnabled', audibleWindow);
    c.bind(emitter, 'VolumeMultiplier', R(envelope, 'Value'));
    c.bind(emitter, 'PitchMultiplier', R(pitch, 'Output'));

    const releaseDue = c.cmp('GreaterOrEqual', R(musicalTime, 'Output'), R(releaseEnd, 'Output'));
    const inactive = c.not(R(noteActive));
    const shouldAdvance = c.and(releaseDue, inactive, R(noteLoaded), R(running));
    const advanceEdge = c.edge(shouldAdvance);
    const unload = c.set(noteLoaded, false);
    c.link(advanceEdge, unload, 'OnRisingEdge');
    const afterUnload = c.wait(unload, 1);
    const countMinusOne = c.n('Expr_MathSubtract', {InputA: R(header, 'Y'), InputB: N(1)});
    const lastIndex = c.n('Expr_MathAdd', {
      InputA: R(header, 'X'), InputB: R(countMinusOne, 'Output'),
    });
    const hasNext = c.cmp('Less', R(index), R(lastIndex, 'Output'));
    const nextBranch = c.branch(afterUnload, hasNext, 'Output');
    const incrementIndex = c.n('Exec_Var_Increment', {
      VarRef: R(index, 'VarRef'), Value: N(1),
    });
    c.link(nextBranch, incrementIndex, 'ExecOutA');
    c.link(incrementIndex, loadNote, 'ExecOut', 'ExecB');
    const markDone = c.set(voiceDone, true);
    c.link(nextBranch, markDone, 'ExecOutB');

    voiceBuilds.push({voiceIndex, header, index, noteLoaded, noteActive, voiceDone,
      startHold, endHold, pitchHold, velocityHold, decodeCalls, decodeCompleted,
      decodeFailures, decodeAbortedCount, decodeLastAborted, decodeLastIterations,
      getterOobCount, getterLastOob, lastNote, rawOutputs, armed, finished,
      enableRises, enableFalls, getNote, call, emitter});
  }

  const stopSignal = c.n('Expr_LogicalOR', {
    bInputA: R(stopButton, 'bHeld'), bInputB: R(stopInput, 'RER_Output'),
  });
  const stopWhileRunning = c.and(R(stopSignal, 'bOutput'), R(running));
  const bothDone = c.and(R(voiceBuilds[0].voiceDone), R(voiceBuilds[1].voiceDone));
  const durationWithTail = c.n('Expr_MathAdd', {
    InputA: R(headerSplits[0], 'W'), InputB: R(headerSplits[1], 'Y'),
  });
  const durationDone = c.cmp('GreaterOrEqual',
    R(musicalTime, 'Output'), R(durationWithTail, 'Output'));
  const finishCondition = c.or(bothDone, durationDone);
  const notStarting = c.not(R(starting));
  const naturalFinish = c.and(R(running), notStarting, finishCondition);
  // Keep manual stops separate from completed playthroughs. A combined stop
  // counter could let repeated partial/manual plays masquerade as the two
  // complete local replays required by the returned-save reader.
  const manualStopEdge = c.edge(stopWhileRunning);
  const naturalFinishEdge = c.edge(naturalFinish);
  const stopJoin = c.n('Exec_Union');
  c.link(manualStopEdge, stopJoin, 'OnRisingEdge', 'ExecA');
  c.link(naturalFinishEdge, stopJoin, 'OnRisingEdge', 'ExecB');
  const clearRunning = c.set(running, false);
  c.link(stopJoin, clearRunning);
  const countManualStop = c.n('Exec_Var_Increment', {
    VarRef: R(playStopped, 'VarRef'), Value: N(1),
  });
  c.link(manualStopEdge, countManualStop, 'OnRisingEdge');
  const countFinishedPlayback = c.n('Exec_Var_Increment', {
    VarRef: R(playFinished, 'VarRef'), Value: N(1),
  });
  c.link(naturalFinishEdge, countFinishedPlayback, 'OnRisingEdge');

  const loadedOutput = c.n('MicrochipOutput', {
    PortLabel: 'Loaded', CallableDefault: B(false), CallableResult: B(false),
  });
  c.bind(loadedOutput, 'RER_Input', R(loaded));
  const runningOutput = c.n('MicrochipOutput', {
    PortLabel: 'Playing', CallableDefault: B(false), CallableResult: B(false),
  });
  c.bind(runningOutput, 'RER_Input', R(running));

  const loadText = c.fmt(
    'LOAD | Requests {A} | Offers {B} | Accepted {C} | StageCopy {D} len {E}\r\n'
      + 'Validation {F} | Loaded {G}',
    R(requestSent), R(offerReceived), R(offerAccepted), R(stagingCopies),
    R(stagingLength), R(validationPassed), R(loaded));
  const commitText = c.fmt(
    'COMMIT | ActiveCopy {A} len {B} | Ack {C} | Nonce {D}\r\n'
      + 'Rejected {E} | Busy {F} | {G}',
    R(activeCopies), R(activeLength), R(ackSent), R(nonce),
    R(offerRejected), R(copyBusy), R(title));
  const playbackText = c.fmt(
    'PLAY | Running {A} | Starts {B} | Finished {C}\r\n'
      + 'Notes armed {D}/24 | finished {E}/24 | Decode V0 {F}/16 | V1 {G}/8',
    R(running), R(playStarted), R(playFinished), R(notesArmed), R(notesFinished),
    R(voiceBuilds[0].decodeCompleted), R(voiceBuilds[1].decodeCompleted));
  display('instructions', [0, 0, 174], [1, 156, 18],
    'WIRELESS MIDI LOAD + PLAY INTEGRATION V2\r\n'
      + '1 LOAD/LISTEN here | 2 SEND on cartridge | wait for Loaded=true\r\n'
      + '3 DELETE cartridge | 4 PLAY twice | wait each time | export PLAYER only',
    [120, 225, 255]);
  display('load_status', [0, 0, 126], [1, 156, 16], loadText, [255, 225, 125]);
  display('commit_status', [0, 0, 82], [1, 156, 16], commitText, [225, 190, 255]);
  display('play_status', [0, 0, 38], [1, 156, 16], playbackText, [175, 255, 185]);

  const bytes = b.finish({x: 180, y: 170, z: 200},
    'Standalone player for SQM1 wireless load/play integration V2. Its matching-request window '
      + 'stays open until a valid offer arrives. It copies a remote score '
      + 'into staging, validates and commits an independent active array, then drives two Sine '
      + 'voices through wired ArrayGet-to-DecodeNote Function calls after the disk is removed.');

  return {bytes, b, c, shell, records, buttons: {requestButton, playButton, stopButton},
    inputs: {requestInput, playInput, stopInput, pitchInput, speedInput, volumeInput},
    outputs: {loadedOutput, runningOutput}, staging, activeScore, nonce, waiting, copyBusy,
    loaded, running, starting, validationCompleted, validationPassed, validationResult, requestSent,
    offerReceived, offerAccepted, offerRejected, seenMagic, seenChannel, seenNonce,
    seenLength, seenTitle, seenMode, seenFormat, stagingCopies, activeCopies, ackSent,
    stagingLength, activeLength, title, playStarted, playFinished, playStopped, notesArmed,
    notesFinished, headerIndices, headers, headerGets, headerSplits, activeHeaders,
    activeHeaderGets, activeHeaderSplits, request, offer, copyStaging,
    copyActive, ack, decode, voiceBuilds, setStarting, startPublication, clearStarting,
    constants: {PREFIX, TRANSPORT_MAGIC, SCORE_MAGIC, CHANNEL, SCORE_LENGTH, TITLE}};
};

if (require.main === module) {
  const output = process.argv[2];
  assert(output, 'Usage: node build-sqm1-wireless-sine-player-integration-v2.cjs <output.brz>');
  const context = module.exports();
  require('./test-sqm1-wireless-sine-player-integration-v2.cjs')(context);
  fs.writeFileSync(output, context.bytes);
  console.log(JSON.stringify({output, bytes: context.bytes.length,
    components: context.b.nodes.length, wires: context.b.edges.length,
    voices: context.voiceBuilds.length}, null, 2));
}
