'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

const file = process.argv[2];
if (!file) throw new Error('Usage: node read-sqm1-wireless-sine-player-integration-v3.cjs <returned-player.brz>');
const PREFIX = 'MWSP3:';
const bytes = fs.readFileSync(file);
const scene = read(bytes);
const placement = validatePlacement(bytes);

function expectedScore() {
  const values = [
    {X: 7701001, Y: 1, Z: 2, W: 8},
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
  return values;
}

function unwrap(value) {
  return value && typeof value === 'object' && '$variant' in value ? value.value : value;
}
const values = {};
const arrays = {};
for (const brick of scene.bricks) {
  const marker = brick.comps.find(component => component.type === C.Interact.NAME
    && component.data.Message?.startsWith(PREFIX));
  if (!marker) continue;
  const label = marker.data.Message.slice(PREFIX.length);
  const variable = brick.comps.find(component => component.type === C.Var.NAME);
  const array = brick.comps.find(component => component.type === C.ArrayVar.NAME);
  if (variable) values[label] = unwrap(variable.data.Value);
  if (array) arrays[label] = array.data.Value;
}

const tolerance = 1e-6;
const sameNumber = (a, b) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= tolerance;
const sameQuat = (a, b) => a && b && ['X', 'Y', 'Z', 'W']
  .every(field => sameNumber(a[field], b[field]));
const score = expectedScore();
function exactScore(array) {
  return array?.$elementType === 'Quat' && Array.isArray(array.$array)
    && array.$array.length === score.length
    && array.$array.every((value, index) => sameQuat(value, score[index]));
}

const envelope = {
  magic: values['offer.seen.magic'],
  channel: values['offer.seen.channel'],
  nonce: values['offer.seen.nonce'],
  length: values['offer.seen.length'],
  title: values['offer.seen.title'],
  mode: values['offer.seen.mode'],
  format: values['offer.seen.format'],
};
const envelopeExact = envelope.magic === 7702001 && envelope.channel === 1
  && envelope.nonce === values['request.nonce'] && envelope.length === 46
  && envelope.title === 'SQM1 two-voice load/play test'
  && envelope.mode === 0 && envelope.format === 1;
const stagingExact = exactScore(arrays['player.staging']);
const activeExact = exactScore(arrays['player.active']);
const loadPassed = Number(values['request.sent']) >= 1
  && Number(values['offer.received']) >= 1
  && Number(values['offer.accepted']) >= 1
  && Number(values['offer.rejected']) === 0
  && Number(values['staging.copy.completed']) >= 1
  && values['staging.length'] === 46
  && Number(values['validation.completed']) >= 1
  && values['validation.passed'] === true
  && values['validation.result'] === 1
  && Number(values['active.copy.completed']) >= 1
  && values['active.length'] === 46
  && values.loaded === true
  && Number(values['ack.sent']) >= 1
  && envelopeExact && stagingExact && activeExact;

function voiceResult(index, expectedCalls, expectedCursor, expectedLastNote) {
  const prefix = `voice${index}`;
  const raw = [0, 1, 2, 3].map(output => values[`${prefix}.decode.rawOutput${output}`]);
  const expectedRaw = [
    (expectedLastNote.W / 127) ** 1.4,
    2 ** ((expectedLastNote.Z - 69) / 12),
    expectedLastNote.Y,
    expectedLastNote.X,
  ];
  const rawExact = raw.every((value, output) => sameNumber(value, expectedRaw[output]));
  const result = {
    calls: Number(values[`${prefix}.decode.calls`] ?? 0),
    completed: Number(values[`${prefix}.decode.completed`] ?? 0),
    failures: Number(values[`${prefix}.decode.failures`] ?? 0),
    abortedCount: Number(values[`${prefix}.decode.abortedCount`] ?? 0),
    lastAborted: values[`${prefix}.decode.lastAborted`],
    lastIterations: values[`${prefix}.decode.lastIterations`],
    outOfBoundsCount: Number(values[`${prefix}.getter.outOfBoundsCount`] ?? 0),
    lastOutOfBounds: values[`${prefix}.getter.lastOutOfBounds`],
    notesArmed: Number(values[`${prefix}.notes.armed`] ?? 0),
    notesFinished: Number(values[`${prefix}.notes.finished`] ?? 0),
    enableRises: Number(values[`${prefix}.enable.rises`] ?? 0),
    enableFalls: Number(values[`${prefix}.enable.falls`] ?? 0),
    cursor: values[`${prefix}.cursor`],
    finished: values[`${prefix}.finished`],
    noteLoaded: values[`${prefix}.note.loaded`],
    lastNote: values[`${prefix}.lastNote`],
    rawOutputs: raw,
    expectedRaw,
    rawExact,
  };
  result.passed = result.calls >= expectedCalls && result.completed >= expectedCalls
    && result.failures === 0 && result.abortedCount === 0
    && result.lastAborted === false && result.lastIterations === 1
    && result.outOfBoundsCount === 0 && result.lastOutOfBounds === false
    && result.notesArmed >= expectedCalls && result.notesFinished >= expectedCalls
    && result.enableRises >= expectedCalls && result.enableFalls >= expectedCalls
    && result.cursor === expectedCursor && result.finished === true
    && result.noteLoaded === false && sameQuat(result.lastNote, expectedLastNote)
    && rawExact;
  return result;
}

const voices = [
  voiceResult(0, 16, 41, score[41]),
  voiceResult(1, 8, 45, score[45]),
];
const playbackPassed = Number(values['playback.started']) >= 2
  && Number(values['playback.finished']) >= 2
  && Number(values['playback.stoppedManually']) === 0
  && values.running === false && values['playback.starting'] === false
  && Number(values['notes.armed']) >= 24
  && Number(values['notes.finished']) >= 24
  && voices.every(voice => voice.passed);

const component = (brick, type) => brick.comps.find(candidate => candidate.type === type);
const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
const edge = (source, sourceType, output, target, targetType, input) =>
  scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
    && candidate.p === output && candidate.z === target.key
    && candidate.zt === targetType && candidate.q === input);
const markedBrick = label => scene.bricks.find(brick => brick.comps.some(candidate =>
  candidate.type === C.Interact.NAME && candidate.data.Message === `${PREFIX}${label}`));
const stagingBrick = markedBrick('player.staging');
const activeBrick = markedBrick('player.active');
const requestSenders = bricksOf(C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
  component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Request');
const offerReceivers = bricksOf(C.Event_CustomGlobal.NAME).filter(brick =>
  component(brick, C.Event_CustomGlobal.NAME).data.EventName === 'SQM1.Offer');
const ackSenders = bricksOf(C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
  component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Ack');
const diskRoleEvents = [
  ...bricksOf(C.Event_CustomGlobal.NAME).filter(brick => {
    const name = component(brick, C.Event_CustomGlobal.NAME).data.EventName;
    return name === 'SQM1.Request' || name === 'SQM1.Ack';
  }),
  ...bricksOf(C.Exec_SendCustomEventGlobal.NAME).filter(brick =>
    component(brick, C.Exec_SendCustomEventGlobal.NAME).data.EventName === 'SQM1.Offer'),
];
const cartridgeMarkers = scene.bricks.flatMap(brick => brick.comps)
  .filter(candidate => candidate.type === C.Interact.NAME
    && candidate.data.Message?.startsWith('MWIC1:')).length;
const calls = bricksOf(C.FunctionCall.NAME);
const definitions = bricksOf(C.Microchip_FunctionDefinition.NAME);
const functionInputs = bricksOf(C.FunctionInput.NAME);
const functionInputType = functionInputs.length === 1
  && component(functionInputs[0], C.FunctionInput.NAME).data.DefaultValue?.$variant === 'Quat';
const callInputVariants = calls.map(call =>
  component(call, C.FunctionCall.NAME).data.Input0?.$variant ?? null);
const nonceBrick = markedBrick('request.nonce');
const activeLengthBrick = markedBrick('active.length');
const titleBrick = markedBrick('title');
const request = requestSenders[0];
const offer = offerReceivers[0];
const ack = ackSenders[0];
const savedNumber = (data, field) => data?.[field]?.value;
const requestData = request ? component(request, C.Exec_SendCustomEventGlobal.NAME).data : null;
const offerData = offer ? component(offer, C.Event_CustomGlobal.NAME).data : null;
const ackData = ack ? component(ack, C.Exec_SendCustomEventGlobal.NAME).data : null;
const protocolTopology = Boolean(request && offer && ack && nonceBrick
  && activeLengthBrick && titleBrick
  && savedNumber(requestData, 'DataIn1') === 7702001
  && savedNumber(requestData, 'DataIn2') === 1
  && savedNumber(requestData, 'DataIn4') === 0
  && savedNumber(requestData, 'DataIn5') === 2
  && savedNumber(requestData, 'DataIn6') === 256
  && savedNumber(requestData, 'DataIn7') === 1
  && savedNumber(requestData, 'DataIn8') === 3
  && edge(nonceBrick, C.Var.NAME, 'Value', request,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3')
  && offerData.bIsObjectEvent === false
  && offerData.DataOut3?.$variant === 'BRSavedComponentRef'
  && offerData.DataOut6?.$variant === 'str'
  && savedNumber(ackData, 'DataIn1') === 7702001
  && savedNumber(ackData, 'DataIn2') === 1
  && savedNumber(ackData, 'DataIn4') === 1
  && savedNumber(ackData, 'DataIn7') === 0
  && savedNumber(ackData, 'DataIn8') === 0
  && edge(nonceBrick, C.Var.NAME, 'Value', ack,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3')
  && edge(activeLengthBrick, C.Var.NAME, 'Value', ack,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn5')
  && edge(titleBrick, C.Var.NAME, 'Value', ack,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn6')
  && !scene.edges.some(candidate => (candidate.z === request.key || candidate.z === ack.key)
    && candidate.q === 'Target'));
const activeGets = activeBrick ? bricksOf(C.Exec_ArrayVar_Get.NAME).filter(get =>
  edge(activeBrick, C.ArrayVar.NAME, 'ArrayVarRef', get,
    C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef')) : [];
const playbackGets = activeGets.filter(get => calls.some(call =>
  edge(get, C.Exec_ArrayVar_Get.NAME, 'Value', call, C.FunctionCall.NAME, 'Input0')));
const activeHeaderGets = activeGets.filter(get => !playbackGets.includes(get));
const activeHeaderIndices = activeHeaderGets.map(get =>
  component(get, C.Exec_ArrayVar_Get.NAME).data.Index).sort((a, z) => a - z);
const setters = bricksOf(C.Exec_Var_Set.NAME);
const setterConnects = (source, sourceType, output, variable) => setters.some(setter =>
  edge(source, sourceType, output, setter, C.Exec_Var_Set.NAME, 'Value')
  && edge(variable, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef'));
const waitingBrick = markedBrick('request.waiting');
const requestSentBrick = markedBrick('request.sent');
const offerAcceptedBrick = markedBrick('offer.accepted');
const waitingSets = waitingBrick ? setters.filter(setter =>
  edge(waitingBrick, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef')) : [];
const openWaiting = waitingSets.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true);
const closeWaiting = waitingSets.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === false);
const increments = bricksOf(C.Exec_Var_Increment.NAME);
const requestCounter = requestSentBrick ? increments.find(increment =>
  edge(requestSentBrick, C.Var.NAME, 'VarRef', increment,
    C.Exec_Var_Increment.NAME, 'VarRef')) : null;
const acceptedCounter = offerAcceptedBrick ? increments.find(increment =>
  edge(offerAcceptedBrick, C.Var.NAME, 'VarRef', increment,
    C.Exec_Var_Increment.NAME, 'VarRef')) : null;
function publicationBarrierAfter(variable) {
  const variableSetters = variable ? setters.filter(setter =>
    edge(variable, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef')) : [];
  const setter = variableSetters.length === 1 ? variableSetters[0] : null;
  const buffers = setter ? bricksOf(C.BufferTicks.NAME).filter(buffer =>
    edge(setter, C.Exec_Var_Set.NAME, 'ExecOut', buffer, C.BufferTicks.NAME, 'Input')) : [];
  const buffer = buffers.length === 1 ? buffers[0] : null;
  const branches = buffer ? bricksOf(C.Exec_Branch.NAME).filter(branch =>
    edge(buffer, C.BufferTicks.NAME, 'Output', branch, C.Exec_Branch.NAME, 'Exec')) : [];
  const branch = branches.length === 1 ? branches[0] : null;
  return {
    variableSetters: variableSetters.length,
    buffers: buffers.length,
    branches: branches.length,
    setter,
    buffer,
    branch,
    oneTick: Boolean(buffer && component(buffer, C.BufferTicks.NAME).data.TicksToWait === 1),
  };
}
const stagingQ33Brick = markedBrick('header.q33');
const validationCompletedBrick = markedBrick('validation.completed');
const stagingBarrier = publicationBarrierAfter(stagingQ33Brick);
const stagingSuccessCounter = validationCompletedBrick && stagingBarrier.branch
  ? increments.find(increment => edge(validationCompletedBrick, C.Var.NAME, 'VarRef', increment,
    C.Exec_Var_Increment.NAME, 'VarRef')
      && edge(stagingBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', increment,
        C.Exec_Var_Increment.NAME, 'Exec')) : null;
const activeLengthBarrier = publicationBarrierAfter(activeLengthBrick);
const firstActiveHeaderGet = activeHeaderGets.find(get =>
  component(get, C.Exec_ArrayVar_Get.NAME).data.Index === 0);
const activeQ33Brick = markedBrick('active.header.q33');
const loadedBrick = markedBrick('loaded');
const activeHeaderBarrier = publicationBarrierAfter(activeQ33Brick);
const loadedTrueSetter = loadedBrick ? setters.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true
    && edge(loadedBrick, C.Var.NAME, 'VarRef', setter,
      C.Exec_Var_Set.NAME, 'VarRef')) : null;
const validationPublicationBuffers = Boolean(
  stagingBarrier.oneTick && stagingSuccessCounter
  && activeLengthBarrier.oneTick && firstActiveHeaderGet
  && edge(activeLengthBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', firstActiveHeaderGet,
    C.Exec_ArrayVar_Get.NAME, 'Exec')
  && activeHeaderBarrier.oneTick && loadedTrueSetter
  && edge(activeHeaderBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', loadedTrueSetter,
    C.Exec_Var_Set.NAME, 'Exec'));
const validationPublicationBufferDetails = {
  staging: {
    setters: stagingBarrier.variableSetters,
    buffers: stagingBarrier.buffers,
    branches: stagingBarrier.branches,
    oneTick: stagingBarrier.oneTick,
    successPath: Boolean(stagingSuccessCounter),
  },
  activeLength: {
    setters: activeLengthBarrier.variableSetters,
    buffers: activeLengthBarrier.buffers,
    branches: activeLengthBarrier.branches,
    oneTick: activeLengthBarrier.oneTick,
    headerPath: Boolean(activeLengthBarrier.branch && firstActiveHeaderGet
      && edge(activeLengthBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', firstActiveHeaderGet,
        C.Exec_ArrayVar_Get.NAME, 'Exec')),
  },
  activeHeaders: {
    setters: activeHeaderBarrier.variableSetters,
    buffers: activeHeaderBarrier.buffers,
    branches: activeHeaderBarrier.branches,
    oneTick: activeHeaderBarrier.oneTick,
    loadedPath: Boolean(activeHeaderBarrier.branch && loadedTrueSetter
      && edge(activeHeaderBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', loadedTrueSetter,
        C.Exec_Var_Set.NAME, 'Exec')),
  },
};
const voiceDecodeTopology = [0, 1].every(index => {
  const rawVars = [0, 1, 2, 3].map(output =>
    markedBrick(`voice${index}.decode.rawOutput${output}`));
  const holds = {
    start: markedBrick(`voice${index}.note.start`),
    end: markedBrick(`voice${index}.note.end`),
    pitch: markedBrick(`voice${index}.note.pitch`),
    velocity: markedBrick(`voice${index}.note.velocity`),
    lastNote: markedBrick(`voice${index}.lastNote`),
    cursor: markedBrick(`voice${index}.cursor`),
  };
  if (rawVars.some(variable => !variable) || Object.values(holds).some(variable => !variable)) {
    return false;
  }
  const call = calls.find(candidate => rawVars.every((variable, output) =>
    setterConnects(candidate, C.FunctionCall.NAME, `Output${output}`, variable)));
  if (!call) return false;
  const getter = playbackGets.find(candidate =>
    edge(candidate, C.Exec_ArrayVar_Get.NAME, 'Value', call, C.FunctionCall.NAME, 'Input0'));
  const native = component(call, C.FunctionCall.NAME);
  if (!getter || JSON.stringify(native.data.InputSources) !== '[1,0,0,0,0,0,0,0]'
    || !edge(holds.cursor, C.Var.NAME, 'Value', getter, C.Exec_ArrayVar_Get.NAME, 'Index')) {
    return false;
  }
  const captureNoteSetter = setters.find(setter =>
    edge(getter, C.Exec_ArrayVar_Get.NAME, 'Value', setter, C.Exec_Var_Set.NAME, 'Value')
    && edge(holds.lastNote, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef'));
  return Boolean(captureNoteSetter
    && edge(call, C.FunctionCall.NAME, 'Completed', captureNoteSetter,
      C.Exec_Var_Set.NAME, 'Exec')
    && setterConnects(call, C.FunctionCall.NAME, 'Output3', holds.start)
    && setterConnects(call, C.FunctionCall.NAME, 'Output2', holds.end)
    && setterConnects(call, C.FunctionCall.NAME, 'Output1', holds.pitch)
    && setterConnects(call, C.FunctionCall.NAME, 'Output0', holds.velocity));
});
function playbackPublicationFor(index) {
  const cursor = markedBrick(`voice${index}.cursor`);
  const getter = cursor ? playbackGets.find(candidate =>
    edge(cursor, C.Var.NAME, 'Value', candidate, C.Exec_ArrayVar_Get.NAME, 'Index')) : null;
  const call = getter ? calls.find(candidate =>
    edge(getter, C.Exec_ArrayVar_Get.NAME, 'Value', candidate,
      C.FunctionCall.NAME, 'Input0')) : null;
  const readBuffers = getter && call ? bricksOf(C.BufferTicks.NAME).filter(buffer =>
    edge(getter, C.Exec_ArrayVar_Get.NAME, 'ExecOut', buffer,
      C.BufferTicks.NAME, 'Input')
      && edge(buffer, C.BufferTicks.NAME, 'Output', call,
        C.FunctionCall.NAME, 'Exec')) : [];
  const readBuffer = readBuffers.length === 1 ? readBuffers[0] : null;
  const decodeCallsBrick = markedBrick(`voice${index}.decode.calls`);
  const decodeCallCounter = decodeCallsBrick ? increments.find(increment =>
    edge(decodeCallsBrick, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef')) : null;
  const getterOobBrick = markedBrick(`voice${index}.getter.lastOutOfBounds`);
  const getterOobSetters = getterOobBrick ? setters.filter(setter =>
    edge(getterOobBrick, C.Var.NAME, 'VarRef', setter,
      C.Exec_Var_Set.NAME, 'VarRef')) : [];
  const getterOobSetter = getterOobSetters.length === 1 ? getterOobSetters[0] : null;
  const readOneTick = Boolean(readBuffer
    && component(readBuffer, C.BufferTicks.NAME).data.TicksToWait === 1);
  const readPath = Boolean(readOneTick && decodeCallCounter && getterOobSetter
    && edge(readBuffer, C.BufferTicks.NAME, 'Output', decodeCallCounter,
      C.Exec_Var_Increment.NAME, 'Exec')
    && edge(readBuffer, C.BufferTicks.NAME, 'Output', getterOobSetter,
      C.Exec_Var_Set.NAME, 'Exec'));

  const noteLoaded = markedBrick(`voice${index}.note.loaded`);
  const markNoteLoaded = noteLoaded ? setters.find(setter =>
    component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true
      && edge(noteLoaded, C.Var.NAME, 'VarRef', setter,
        C.Exec_Var_Set.NAME, 'VarRef')) : null;
  const decodeBranches = markNoteLoaded ? bricksOf(C.Exec_Branch.NAME).filter(branch =>
    edge(branch, C.Exec_Branch.NAME, 'ExecOutA', markNoteLoaded,
      C.Exec_Var_Set.NAME, 'Exec')) : [];
  const decodeBranch = decodeBranches.length === 1 ? decodeBranches[0] : null;
  const decodeBuffers = decodeBranch ? bricksOf(C.BufferTicks.NAME).filter(buffer =>
    edge(buffer, C.BufferTicks.NAME, 'Output', decodeBranch,
      C.Exec_Branch.NAME, 'Exec')) : [];
  const decodeBuffer = decodeBuffers.length === 1 ? decodeBuffers[0] : null;
  const abortedBrick = markedBrick(`voice${index}.decode.abortedCount`);
  const abortCounter = abortedBrick ? increments.find(increment =>
    edge(abortedBrick, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef')) : null;
  const abortJoins = abortCounter && decodeBuffer ? bricksOf(C.Exec_Union.NAME).filter(union =>
    edge(abortCounter, C.Exec_Var_Increment.NAME, 'ExecOut', union,
      C.Exec_Union.NAME, 'ExecA')
      && edge(union, C.Exec_Union.NAME, 'ExecOut', decodeBuffer,
        C.BufferTicks.NAME, 'Input')) : [];
  const abortJoin = abortJoins.length === 1 ? abortJoins[0] : null;
  const abortBranches = abortCounter && abortJoin ? bricksOf(C.Exec_Branch.NAME).filter(branch =>
    edge(branch, C.Exec_Branch.NAME, 'ExecOutA', abortCounter,
      C.Exec_Var_Increment.NAME, 'Exec')
      && edge(branch, C.Exec_Branch.NAME, 'ExecOutB', abortJoin,
        C.Exec_Union.NAME, 'ExecB')) : [];
  const decodeOneTick = Boolean(decodeBuffer
    && component(decodeBuffer, C.BufferTicks.NAME).data.TicksToWait === 1);
  const decodePath = Boolean(decodeOneTick && abortJoin && abortBranches.length === 1);
  return {
    call,
    getter,
    passed: Boolean(readPath && decodePath),
    details: {
      voice: index,
      readBuffers: readBuffers.length,
      readOneTick,
      readExecutesFunction: Boolean(readBuffer && call && edge(readBuffer,
        C.BufferTicks.NAME, 'Output', call, C.FunctionCall.NAME, 'Exec')),
      readCountsCall: Boolean(readBuffer && decodeCallCounter && edge(readBuffer,
        C.BufferTicks.NAME, 'Output', decodeCallCounter,
        C.Exec_Var_Increment.NAME, 'Exec')),
      readCapturesOob: Boolean(readBuffer && getterOobSetter && edge(readBuffer,
        C.BufferTicks.NAME, 'Output', getterOobSetter, C.Exec_Var_Set.NAME, 'Exec')),
      decodeBuffers: decodeBuffers.length,
      decodeOneTick,
      abortJoin: Boolean(abortJoin),
      abortBranch: abortBranches.length === 1,
      decodeSuccessPath: Boolean(decodeBranch && markNoteLoaded && edge(decodeBranch,
        C.Exec_Branch.NAME, 'ExecOutA', markNoteLoaded,
        C.Exec_Var_Set.NAME, 'Exec')),
    },
  };
}
const playbackPublicationChecks = [0, 1].map(playbackPublicationFor);
const playbackPublicationBuffers = playbackPublicationChecks.every(check => check.passed);
const playbackPublicationBufferDetails = playbackPublicationChecks.map(check => check.details);
const decodeTopology = calls.length === 2 && definitions.length === 1
  && functionInputType
  && activeGets.length === 7 && playbackGets.length === 2 && activeHeaderGets.length === 5
  && JSON.stringify(activeHeaderIndices) === '[0,1,2,3,33]'
  && voiceDecodeTopology
  && calls.every(call => {
    const getter = playbackGets.find(get => edge(get, C.Exec_ArrayVar_Get.NAME, 'Value', call,
      C.FunctionCall.NAME, 'Input0'));
    return getter
      && edge(definitions[0], C.Microchip_FunctionDefinition.NAME, 'Definition', call,
        C.FunctionCall.NAME, 'Definition');
  }) && new Set(playbackGets.map(getter => getter.key)).size === 2;
const copies = bricksOf(C.Exec_ArrayVar_CopyFrom.NAME);
const stagingCopy = stagingBrick && offer ? copies.find(copy =>
  edge(offer, C.Event_CustomGlobal.NAME, 'DataOut3', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef')
  && edge(stagingBrick, C.ArrayVar.NAME, 'ArrayVarRef', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef')) : null;
const activeCopy = stagingBrick && activeBrick ? copies.find(copy =>
  edge(stagingBrick, C.ArrayVar.NAME, 'ArrayVarRef', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef')
  && edge(activeBrick, C.ArrayVar.NAME, 'ArrayVarRef', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef')) : null;
const delayedExecutionTypes = new Set([
  C.BufferTicks?.NAME, C.BufferSeconds?.NAME, C.QueueTicks?.NAME, C.QueueSeconds?.NAME,
].filter(Boolean));
function sameCallbackExecPath(source, target) {
  if (!source || !target) return false;
  const start = `${source.key}|${C.Event_CustomGlobal.NAME}`;
  const wanted = `${target.key}|${C.Exec_ArrayVar_CopyFrom.NAME}`;
  const queue = [start];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    if (current === wanted) return true;
    const [key, type] = current.split('|');
    if (delayedExecutionTypes.has(type)) continue;
    for (const candidate of scene.edges) {
      if (candidate.a !== key || candidate.at !== type
        || !['Exec', 'ExecIn', 'Input'].includes(candidate.q)) continue;
      if (delayedExecutionTypes.has(candidate.zt)) continue;
      const next = `${candidate.z}|${candidate.zt}`;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
const sameCallbackStagingCopy = sameCallbackExecPath(offer, stagingCopy);
const runningBrick = markedBrick('running');
const startingBrick = markedBrick('playback.starting');
const copyBusyBrick = markedBrick('copy.busy');
const playStartedBrick = markedBrick('playback.started');
const startingSets = startingBrick ? setters.filter(setter =>
  edge(startingBrick, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef')) : [];
const setStarting = startingSets.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true);
const clearStarting = startingSets.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === false);
const runningSet = runningBrick ? setters.find(setter =>
  component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true
    && edge(runningBrick, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef')) : null;
const playIncrement = playStartedBrick ? bricksOf(C.Exec_Var_Increment.NAME).find(increment =>
  edge(playStartedBrick, C.Var.NAME, 'VarRef', increment,
    C.Exec_Var_Increment.NAME, 'VarRef')) : null;
const startBuffer = playIncrement && clearStarting ? bricksOf(C.BufferTicks.NAME).find(buffer =>
  component(buffer, C.BufferTicks.NAME).data.TicksToWait === 1
    && edge(playIncrement, C.Exec_Var_Increment.NAME, 'ExecOut', buffer,
      C.BufferTicks.NAME, 'Input')
    && edge(buffer, C.BufferTicks.NAME, 'Output', clearStarting,
      C.Exec_Var_Set.NAME, 'Exec')) : null;
const startingNot = startingBrick ? bricksOf(C.Expr_LogicalNOT.NAME).find(logicalNot =>
  edge(startingBrick, C.Var.NAME, 'Value', logicalNot,
    C.Expr_LogicalNOT.NAME, 'bInput')) : null;
const naturalFinishGate = startingNot && runningBrick ? bricksOf(C.Expr_LogicalAND.NAME).find(and =>
  ['bInputA', 'bInputB'].some(input => edge(startingNot, C.Expr_LogicalNOT.NAME,
    'bOutput', and, C.Expr_LogicalAND.NAME, input))
    && ['bInputA', 'bInputB'].some(input => edge(runningBrick, C.Var.NAME,
      'Value', and, C.Expr_LogicalAND.NAME, input))) : null;
const copyBusyNots = copyBusyBrick ? bricksOf(C.Expr_LogicalNOT.NAME).filter(logicalNot =>
  edge(copyBusyBrick, C.Var.NAME, 'Value', logicalNot,
    C.Expr_LogicalNOT.NAME, 'bInput')) : [];
const runningNots = runningBrick ? bricksOf(C.Expr_LogicalNOT.NAME).filter(logicalNot =>
  edge(runningBrick, C.Var.NAME, 'Value', logicalNot,
    C.Expr_LogicalNOT.NAME, 'bInput')) : [];
const startAvailabilityGate = copyBusyNots.length ? bricksOf(C.Expr_LogicalAND.NAME).find(and =>
  copyBusyNots.some(copyBusyNot => ['bInputA', 'bInputB'].some(input =>
    edge(copyBusyNot, C.Expr_LogicalNOT.NAME,
      'bOutput', and, C.Expr_LogicalAND.NAME, input)))
    && runningNots.some(logicalNot => ['bInputA', 'bInputB'].some(input =>
      edge(logicalNot, C.Expr_LogicalNOT.NAME, 'bOutput', and,
        C.Expr_LogicalAND.NAME, input)))) : null;
const replayStartGate = Boolean(startingSets.length === 2 && setStarting && clearStarting
  && runningSet && playIncrement && startBuffer && naturalFinishGate && startAvailabilityGate
  && edge(setStarting, C.Exec_Var_Set.NAME, 'ExecOut', runningSet,
    C.Exec_Var_Set.NAME, 'Exec')
  && edge(runningSet, C.Exec_Var_Set.NAME, 'ExecOut', playIncrement,
    C.Exec_Var_Increment.NAME, 'Exec'));
const replayStartGateDetails = {
  startingSets: startingSets.length,
  setStarting: Boolean(setStarting),
  clearStarting: Boolean(clearStarting),
  runningSet: Boolean(runningSet),
  playIncrement: Boolean(playIncrement),
  startBuffer: Boolean(startBuffer),
  naturalFinishGate: Boolean(naturalFinishGate),
  startAvailabilityGate: Boolean(startAvailabilityGate),
  setBeforeRunning: Boolean(setStarting && runningSet && edge(setStarting,
    C.Exec_Var_Set.NAME, 'ExecOut', runningSet, C.Exec_Var_Set.NAME, 'Exec')),
  runningBeforeCount: Boolean(runningSet && playIncrement && edge(runningSet,
    C.Exec_Var_Set.NAME, 'ExecOut', playIncrement, C.Exec_Var_Increment.NAME, 'Exec')),
};
const refVars = scene.bricks.flatMap(brick => brick.comps).filter(candidate =>
  candidate.type === C.Var.NAME && candidate.data.Value?.$variant === 'BRSavedComponentRef');
const emitters = bricksOf(C.AudioEmitter.NAME);
const requestWindowPersistent = Boolean(bricksOf(C.QueueSeconds.NAME).length === 0
  && waitingSets.length === 2 && openWaiting && closeWaiting
  && requestCounter && acceptedCounter
  && edge(requestCounter, C.Exec_Var_Increment.NAME, 'ExecOut', openWaiting,
    C.Exec_Var_Set.NAME, 'Exec')
  && edge(acceptedCounter, C.Exec_Var_Increment.NAME, 'ExecOut', closeWaiting,
    C.Exec_Var_Set.NAME, 'Exec')
  && scene.edges.filter(candidate => candidate.z === closeWaiting.key
    && candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Exec').length === 1);
const requestWindowPersistentDetails = {
  timers: bricksOf(C.QueueSeconds.NAME).length,
  waitingSets: waitingSets.length,
  opensFromRequest: Boolean(requestCounter && openWaiting && edge(requestCounter,
    C.Exec_Var_Increment.NAME, 'ExecOut', openWaiting, C.Exec_Var_Set.NAME, 'Exec')),
  closesFromAcceptedOffer: Boolean(acceptedCounter && closeWaiting && edge(acceptedCounter,
    C.Exec_Var_Increment.NAME, 'ExecOut', closeWaiting, C.Exec_Var_Set.NAME, 'Exec')),
  closeIncomingExecs: closeWaiting ? scene.edges.filter(candidate =>
    candidate.z === closeWaiting.key && candidate.zt === C.Exec_Var_Set.NAME
      && candidate.q === 'Exec').length : 0,
};
const audioTopology = emitters.length === 2 && emitters.every(emitter => {
  const native = component(emitter, C.AudioEmitter.NAME);
  const asset = Number.isInteger(native.data.AudioDescriptor)
    ? scene.r.externalAssets()[native.data.AudioDescriptor] : null;
  return asset?.name === 'BA_Synth_Basic_Sine'
    && ['bEnabled', 'PitchMultiplier', 'VolumeMultiplier'].every(port =>
      scene.edges.filter(candidate => candidate.z === emitter.key
        && candidate.zt === C.AudioEmitter.NAME && candidate.q === port).length === 1);
});
const diskAbsent = cartridgeMarkers === 0 && diskRoleEvents.length === 0;
const graphPassed = placement.strictOk && scene.links.length === 2
  && requestSenders.length === 1 && offerReceivers.length === 1 && ackSenders.length === 1
  && diskAbsent && stagingBrick && activeBrick && copies.length === 2
  && protocolTopology && stagingCopy && activeCopy && sameCallbackStagingCopy
  && decodeTopology && audioTopology && replayStartGate && requestWindowPersistent
  && validationPublicationBuffers && playbackPublicationBuffers
  && refVars.length === 0;
const graph = {
  bricks: scene.bricks.length,
  components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
  wires: scene.edges.length,
  linkedGrids: scene.links.length,
  functionCalls: calls.length,
  emitters: emitters.length,
  requestSenders: requestSenders.length,
  offerReceivers: offerReceivers.length,
  ackSenders: ackSenders.length,
  diskRoleEvents: diskRoleEvents.length,
  cartridgeMarkers,
  diskAbsent,
  protocolTopology,
  activeGetters: activeGets.length,
  activeHeaderGetters: activeHeaderGets.length,
  activeHeaderIndices,
  playbackGetters: playbackGets.length,
  functionInputType,
  callInputVariants,
  decodeTopology,
  voiceDecodeTopology,
  copyTopology: Boolean(stagingCopy && activeCopy && copies.length === 2),
  sameCallbackStagingCopy,
  audioTopology,
  requestWindowPersistent,
  requestWindowPersistentDetails,
  validationPublicationBuffers,
  validationPublicationBufferDetails,
  playbackPublicationBuffers,
  playbackPublicationBufferDetails,
  replayStartGate,
  replayStartGateDetails,
  componentRefVars: refVars.length,
  strictPlacement: placement.strictOk,
  placementWarnings: placement.warnings.length,
  passed: Boolean(graphPassed),
};
const passed = loadPassed && playbackPassed && graph.passed;
let interpretation;
if (passed) {
  interpretation = 'PASS: the wireless score was copied exactly into staging and active storage, acknowledged, then all 12 notes were fetched from ActiveScore, decoded through the shared Function and completed without abort or bounds errors. Confirm separately that the cartridge was deleted before Play and the duet was audible.';
} else if (!graph.diskAbsent) {
  interpretation = 'PLAYER EXPORT INCLUDES CARTRIDGE CONTENT: delete the complete cartridge and export only the player so local-copy independence can be established.';
} else if (!graph.passed) {
  interpretation = 'PLAYER GRAPH INCOMPLETE: the returned save does not retain the complete staging/active, decoder and continuous-audio topology; inspect placement warnings and export the whole player.';
} else if (loadPassed) {
  interpretation = 'LOAD PASS / PLAYBACK INCOMPLETE: the independent ActiveScore is exact. Delete the cartridge, press PLAY LOCAL COPY, wait ten seconds, then export the complete player again.';
} else if (Number(values['request.sent'] ?? 0) === 0) {
  interpretation = 'NOT RUN: press LOAD / LISTEN on the player, SEND SONG on the cartridge, wait for Loaded=true, delete the cartridge, then press PLAY LOCAL COPY twice.';
} else {
  interpretation = 'LOAD FAILED OR INCOMPLETE: inspect the retained envelope, copy counters, lengths and validation fields below.';
}

console.log(JSON.stringify({
  passed, loadPassed, playbackPassed,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  envelope: {...envelope, exact: envelopeExact},
  arrays: {
    stagingLength: arrays['player.staging']?.$array?.length ?? null,
    activeLength: arrays['player.active']?.$array?.length ?? null,
    stagingExact,
    activeExact,
  },
  load: {
    requests: values['request.sent'], received: values['offer.received'],
    waiting: values['request.waiting'], copyBusy: values['copy.busy'],
    accepted: values['offer.accepted'], rejected: values['offer.rejected'],
    stagingCopies: values['staging.copy.completed'], stagingLength: values['staging.length'],
    validationCompleted: values['validation.completed'],
    validationPassed: values['validation.passed'], validationResult: values['validation.result'],
    activeCopies: values['active.copy.completed'], activeLength: values['active.length'],
    loaded: values.loaded, acknowledgments: values['ack.sent'], title: values.title,
  },
  playback: {
    started: values['playback.started'], finished: values['playback.finished'],
    stoppedManually: values['playback.stoppedManually'],
    starting: values['playback.starting'], running: values.running,
    notesArmed: values['notes.armed'],
    notesFinished: values['notes.finished'], voices,
  },
  graph,
  retainedFields: Object.keys(values).sort(),
  interpretation,
}, null, 2));
