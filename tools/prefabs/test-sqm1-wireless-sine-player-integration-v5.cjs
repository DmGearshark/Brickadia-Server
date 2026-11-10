'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testMidiWirelessSinePlayerIntegrationV5(ctx) {
  const scene = read(ctx.bytes);
  const placement = validatePlacement(ctx.bytes);
  const assertFiniteNumbers = (value, path) => {
    if (typeof value === 'number') {
      assert(Number.isFinite(value), `Non-finite serialized number at ${path}`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assertFiniteNumbers(child, `${path}.${key}`);
    }
  };
  for (const brick of scene.bricks) {
    for (const candidate of brick.comps) {
      assertFiniteNumbers(candidate.data, `${brick.key}.${candidate.type}`);
    }
  }
  assert.equal(placement.invalidBricks.length, 0, JSON.stringify(placement.invalidBricks));
  assert.equal(placement.confirmedPairs.length, 0, JSON.stringify(placement.confirmedPairs));
  assert.equal(placement.uncertainPairs.length, 0, JSON.stringify(placement.uncertainPairs));
  assert.equal(placement.warnings.length, 0, JSON.stringify(placement.warnings));
  assert.equal(placement.strictOk, true, 'Player integration prefab needs strict placement');

  const component = (brick, type) => brick.comps.find(candidate => candidate.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const edge = (source, sourceType, output, target, targetType, input) =>
    scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
      && candidate.p === output && candidate.z === target.key
      && candidate.zt === targetType && candidate.q === input);
  const unique = (type, predicate = () => true) => {
    const matches = scene.bricks.filter(brick => {
      const found = component(brick, type);
      return found && predicate(found.data, brick);
    });
    assert.equal(matches.length, 1, `Expected one ${type}, found ${matches.length}`);
    return matches[0];
  };
  const marked = label => {
    const brick = scene.bricks.find(candidate => candidate.comps.some(candidateComponent =>
      candidateComponent.type === C.Interact.NAME
        && candidateComponent.data.Message === `${ctx.constants.PREFIX}:${label}`));
    assert(brick, `Missing retained marker ${label}`);
    return brick;
  };

  assert.equal(scene.links.length, 2,
    'Player shell and DecodeNote definition must each retain one linked grid');
  assert.equal(bricksOf(C.Microchip.NAME).length, 1, 'Expected one physical player chip');
  assert.equal(bricksOf(C.Microchip_FunctionDefinition.NAME).length, 1,
    'Expected one shared DecodeNote definition');
  assert.equal(bricksOf(C.FunctionCall.NAME).length, ctx.constants.MAX_VOICES,
    'Expected one call per voice');
  assert.equal(bricksOf(C.AudioEmitter.NAME).length, ctx.constants.MAX_VOICES,
    'Expected one Sine emitter per voice');
  assert.equal(bricksOf(C.OneShotAudioEmitter.NAME).length, 0, 'No one-shot audio is allowed');
  assert.deepEqual(scene.r.externalAssets(), [
    {type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'},
    {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'},
  ]);

  const buttons = bricksOf(C.Button.NAME);
  assert.deepEqual(buttons.map(brick => component(brick, C.Button.NAME).data.PromptCustomLabel).sort(),
    ['LOAD / LISTEN', 'PLAY LOCAL COPY', 'STOP']);
  assert.equal(bricksOf(C.MicrochipInput.NAME).length, 6, 'Expected six production-facing inputs');
  assert.equal(bricksOf(C.MicrochipOutput.NAME).length, 2, 'Expected Loaded and Playing outputs');

  const inputByLabel = label => unique(C.MicrochipInput.NAME,
    data => data.PortLabel === label);
  const fallbackFor = (input, wantedDefault, label) => {
    const comparison = unique(C.Expr_CompareGreater.NAME, (data, candidate) =>
      data.InputB?.$variant === 'f64' && data.InputB.value === 0
        && edge(input, C.MicrochipInput.NAME, 'RER_Output', candidate,
          C.Expr_CompareGreater.NAME, 'InputA'));
    const select = unique(C.Expr_Select.NAME, (data, candidate) =>
      data.InputA?.$variant === 'f64'
        && Math.abs(data.InputA.value - wantedDefault) < 1e-9
        && edge(input, C.MicrochipInput.NAME, 'RER_Output', candidate,
          C.Expr_Select.NAME, 'InputB')
        && edge(comparison, C.Expr_CompareGreater.NAME, 'bOutput', candidate,
          C.Expr_Select.NAME, 'bSelectB'));
    const rawEdges = scene.edges.filter(candidate => candidate.a === input.key
      && candidate.at === C.MicrochipInput.NAME && candidate.p === 'RER_Output');
    assert.equal(rawEdges.length, 2,
      `${label} raw input may only feed its >0 check and fallback selector`);
    return {comparison, select};
  };
  const pitchInput = inputByLabel('Pitch (0=1)');
  const speedInput = inputByLabel('Speed (0=1)');
  const volumeInput = inputByLabel('Volume (0=.08)');
  const pitchFallback = fallbackFor(pitchInput, 1, 'Pitch');
  const speedFallback = fallbackFor(speedInput, 1, 'Speed');
  const volumeFallback = fallbackFor(volumeInput, 0.08, 'Volume');

  const staging = marked('player.staging');
  const active = marked('player.active');
  assert.deepEqual(component(staging, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: []});
  assert.deepEqual(component(active, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: []});
  assert.notEqual(staging.key, active.key);

  const request = unique(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === 'SQM1.Request');
  const offer = unique(C.Event_CustomGlobal.NAME, data => data.EventName === 'SQM1.Offer');
  const ack = unique(C.Exec_SendCustomEventGlobal.NAME, data => data.EventName === 'SQM1.Ack');
  const requestData = component(request, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(requestData.DataIn1.value, ctx.constants.TRANSPORT_MAGIC);
  assert.equal(requestData.DataIn2.value, ctx.constants.CHANNEL);
  assert.equal(requestData.DataIn4.value, 0);
  assert.equal(requestData.DataIn5.value, ctx.constants.MAX_VOICES);
  assert.equal(requestData.DataIn6.value, ctx.constants.MAX_SCORE_LENGTH);
  assert.equal(requestData.DataIn7.value, ctx.constants.SCORE_FORMAT);
  assert.equal(requestData.DataIn8.value, 3);
  assert.equal(component(offer, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, false);
  assert.equal(component(offer, C.Event_CustomGlobal.NAME).data.DataOut3.$variant,
    'BRSavedComponentRef');
  assert.equal(component(ack, C.Exec_SendCustomEventGlobal.NAME).data.DataIn1.value,
    ctx.constants.TRANSPORT_MAGIC);
  assert.equal(scene.edges.some(candidate => candidate.z === request.key
    && candidate.q === 'Target'), false, 'Request must broadcast');
  assert.equal(scene.edges.some(candidate => candidate.z === ack.key
    && candidate.q === 'Target'), false, 'Ack must broadcast');

  const copies = bricksOf(C.Exec_ArrayVar_CopyFrom.NAME);
  assert.equal(copies.length, 2, 'Expected remote-to-staging and staging-to-active copies');
  const stagingCopy = copies.find(copy => edge(offer, C.Event_CustomGlobal.NAME, 'DataOut3',
    copy, C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef'));
  assert(stagingCopy, 'Offer.DataOut3 must wire directly to staging CopyFrom.SourceRef');
  assert(edge(staging, C.ArrayVar.NAME, 'ArrayVarRef', stagingCopy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef'));
  const activeCopy = copies.find(copy => edge(staging, C.ArrayVar.NAME, 'ArrayVarRef',
    copy, C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef'));
  assert(activeCopy, 'Staging must be the local source for active commit');
  assert(edge(active, C.ArrayVar.NAME, 'ArrayVarRef', activeCopy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef'));

  const refVars = scene.bricks.flatMap(brick => brick.comps).filter(candidate =>
    candidate.type === C.Var.NAME && candidate.data.Value?.$variant === 'BRSavedComponentRef');
  assert.equal(refVars.length, 0, 'Remote reference cannot be stored in a Var');
  assert.equal(bricksOf(C.QueueSeconds.NAME).length, 0,
    'V4 must leave a matching request open instead of expiring it on a timer');

  const waiting = marked('request.waiting');
  const requestSent = marked('request.sent');
  const offerAccepted = marked('offer.accepted');
  const waitingSets = bricksOf(C.Exec_Var_Set.NAME).filter(set =>
    edge(waiting, C.Var.NAME, 'VarRef', set, C.Exec_Var_Set.NAME, 'VarRef'));
  assert.equal(waitingSets.length, 2,
    'Request waiting may only be opened by Load and closed by an accepted offer');
  const openWaiting = waitingSets.find(set =>
    component(set, C.Exec_Var_Set.NAME).data.Value?.value === true);
  const closeWaiting = waitingSets.find(set =>
    component(set, C.Exec_Var_Set.NAME).data.Value?.value === false);
  assert(openWaiting && closeWaiting, 'Request waiting needs one true and one false setter');
  const requestCounter = unique(C.Exec_Var_Increment.NAME, (_data, increment) =>
    edge(requestSent, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef'));
  const acceptedCounter = unique(C.Exec_Var_Increment.NAME, (_data, increment) =>
    edge(offerAccepted, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef'));
  assert(edge(requestCounter, C.Exec_Var_Increment.NAME, 'ExecOut', openWaiting,
    C.Exec_Var_Set.NAME, 'Exec'), 'A Load request must open the waiting state');
  assert(edge(acceptedCounter, C.Exec_Var_Increment.NAME, 'ExecOut', closeWaiting,
    C.Exec_Var_Set.NAME, 'Exec'), 'Only an accepted offer may close the waiting state');
  assert.equal(scene.edges.filter(candidate => candidate.z === closeWaiting.key
    && candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Exec').length, 1,
  'The waiting close setter must have no timeout or alternate execution path');

  // V2 proved the remote copy and retained headers were exact, but branched in
  // the same tick as the final Var setter. Pin the three publication barriers
  // that keep every pure validation graph from reading its previous value.
  const setterFor = variable => unique(C.Exec_Var_Set.NAME, (_data, setter) =>
    edge(variable, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef'));
  const oneTickAfter = (setter, label) => {
    const buffer = unique(C.BufferTicks.NAME, (_data, candidate) =>
      edge(setter, C.Exec_Var_Set.NAME, 'ExecOut', candidate, C.BufferTicks.NAME, 'Input'));
    assert.equal(component(buffer, C.BufferTicks.NAME).data.TicksToWait, 1,
      `${label} must wait exactly one publication tick`);
    const branch = unique(C.Exec_Branch.NAME, (_data, candidate) =>
      edge(buffer, C.BufferTicks.NAME, 'Output', candidate, C.Exec_Branch.NAME, 'Exec'));
    return {buffer, branch};
  };

  const stagingQ33 = marked('header.q33');
  const validationCompleted = marked('validation.completed');
  const stagingBarrier = oneTickAfter(setterFor(stagingQ33), 'Staging header validation');
  const validationCounter = bricksOf(C.Exec_Var_Increment.NAME).find(increment =>
    edge(validationCompleted, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef')
      && edge(stagingBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', increment,
        C.Exec_Var_Increment.NAME, 'Exec'));
  assert(validationCounter, 'Missing successful staging-validation counter');
  assert(edge(stagingBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', validationCounter,
    C.Exec_Var_Increment.NAME, 'Exec'),
  'The staged-header branch must enter successful validation after its buffer');

  const activeLength = marked('active.length');
  const activeLengthBarrier = oneTickAfter(setterFor(activeLength), 'Active length validation');
  const firstActiveHeaderGet = bricksOf(C.Exec_ArrayVar_Get.NAME).find(get =>
    component(get, C.Exec_ArrayVar_Get.NAME).data.Index === 0
      && edge(active, C.ArrayVar.NAME, 'ArrayVarRef', get,
        C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef'));
  assert(firstActiveHeaderGet, 'Missing active header q0 getter');
  assert(edge(activeLengthBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', firstActiveHeaderGet,
    C.Exec_ArrayVar_Get.NAME, 'Exec'),
  'The active-length branch must begin header verification after its buffer');

  const activeQ33 = marked('active.header.q33');
  const loaded = marked('loaded');
  const activeHeaderBarrier = oneTickAfter(setterFor(activeQ33), 'Active header validation');
  const markLoaded = bricksOf(C.Exec_Var_Set.NAME).find(setter =>
    component(setter, C.Exec_Var_Set.NAME).data.Value?.value === true
      && edge(loaded, C.Var.NAME, 'VarRef', setter, C.Exec_Var_Set.NAME, 'VarRef'));
  assert(markLoaded, 'Missing Loaded=true setter');
  assert(edge(activeHeaderBarrier.branch, C.Exec_Branch.NAME, 'ExecOutA', markLoaded,
    C.Exec_Var_Set.NAME, 'Exec'),
  'The active-header branch must mark Loaded only after its buffer');

  const activeQ1 = marked('active.header.q1');
  const activeQ1Split = unique(C.Expr_SplitQuaternion.NAME, (_data, split) =>
    edge(activeQ1, C.Var.NAME, 'Value', split, C.Expr_SplitQuaternion.NAME, 'Input'));
  const audibleReleaseTail = unique(C.Expr_MathMin.NAME, (data, minimum) =>
    data.InputB?.$variant === 'f64' && Math.abs(data.InputB.value - 0.08) < 1e-9
      && edge(activeQ1Split, C.Expr_SplitQuaternion.NAME, 'Y', minimum,
        C.Expr_MathMin.NAME, 'InputA'));
  const naturalTailTargets = scene.edges.filter(candidate => candidate.a === activeQ1Split.key
    && candidate.at === C.Expr_SplitQuaternion.NAME && candidate.p === 'Y'
    && candidate.zt === C.Expr_MathAdd.NAME && candidate.q === 'InputB');
  assert.equal(naturalTailTargets.length, 1,
    'Natural finish must retain the complete committed release tail');
  const releaseTailTargets = scene.edges.filter(candidate => candidate.a === audibleReleaseTail.key
    && candidate.at === C.Expr_MathMin.NAME && candidate.p === 'Output'
    && candidate.zt === C.Expr_MathAdd.NAME && candidate.q === 'InputB');
  assert.equal(releaseTailTargets.length, ctx.constants.MAX_VOICES,
    'Capped audible tail must drive every voice release and leave preload margin');

  const running = marked('running');
  const starting = marked('playback.starting');
  const copyBusy = marked('copy.busy');
  const playStarted = marked('playback.started');
  assert.deepEqual(component(starting, C.Var.NAME).data.Value,
    {$variant: 'Bool', value: false});
  const startingSets = bricksOf(C.Exec_Var_Set.NAME).filter(set =>
    edge(starting, C.Var.NAME, 'VarRef', set, C.Exec_Var_Set.NAME, 'VarRef'));
  assert.equal(startingSets.length, 2, 'Playback starting needs one set and one clear');
  const setStarting = startingSets.find(set =>
    component(set, C.Exec_Var_Set.NAME).data.Value?.value === true);
  const clearStarting = startingSets.find(set =>
    component(set, C.Exec_Var_Set.NAME).data.Value?.value === false);
  assert(setStarting && clearStarting, 'Playback starting must be explicitly raised and cleared');
  const countPlay = unique(C.Exec_Var_Increment.NAME, (_data, increment) =>
    edge(playStarted, C.Var.NAME, 'VarRef', increment,
      C.Exec_Var_Increment.NAME, 'VarRef'));
  const startBuffer = unique(C.BufferTicks.NAME, (_data, buffer) =>
    edge(countPlay, C.Exec_Var_Increment.NAME, 'ExecOut', buffer, C.BufferTicks.NAME, 'Input')
      && edge(buffer, C.BufferTicks.NAME, 'Output', clearStarting,
        C.Exec_Var_Set.NAME, 'Exec'));
  assert.equal(component(startBuffer, C.BufferTicks.NAME).data.TicksToWait, 1,
    'Replay guard must span the voice-reset publication tick');
  const setRunning = unique(C.Exec_Var_Set.NAME, (data, set) =>
    data.Value?.value === true
      && edge(running, C.Var.NAME, 'VarRef', set, C.Exec_Var_Set.NAME, 'VarRef'));
  assert(edge(setStarting, C.Exec_Var_Set.NAME, 'ExecOut', setRunning,
    C.Exec_Var_Set.NAME, 'Exec'));
  assert(edge(setRunning, C.Exec_Var_Set.NAME, 'ExecOut', countPlay,
    C.Exec_Var_Increment.NAME, 'Exec'));
  const startingNot = unique(C.Expr_LogicalNOT.NAME, (_data, logicalNot) =>
    edge(starting, C.Var.NAME, 'Value', logicalNot, C.Expr_LogicalNOT.NAME, 'bInput'));
  const naturalFinishGate = bricksOf(C.Expr_LogicalAND.NAME).find(and =>
    ['bInputA', 'bInputB'].some(input => edge(startingNot, C.Expr_LogicalNOT.NAME,
      'bOutput', and, C.Expr_LogicalAND.NAME, input))
      && ['bInputA', 'bInputB'].some(input => edge(running, C.Var.NAME,
        'Value', and, C.Expr_LogicalAND.NAME, input)));
  assert(naturalFinishGate,
    'Natural finish must require running and the inverse of playback.starting');
  const copyBusyNots = bricksOf(C.Expr_LogicalNOT.NAME).filter(logicalNot =>
    edge(copyBusy, C.Var.NAME, 'Value', logicalNot, C.Expr_LogicalNOT.NAME, 'bInput'));
  assert(copyBusyNots.length >= 1, 'Expected a !copyBusy expression');
  const runningNot = bricksOf(C.Expr_LogicalNOT.NAME).find(logicalNot =>
    edge(running, C.Var.NAME, 'Value', logicalNot, C.Expr_LogicalNOT.NAME, 'bInput'));
  const startAvailabilityGate = bricksOf(C.Expr_LogicalAND.NAME).find(and =>
    copyBusyNots.some(copyBusyNot => ['bInputA', 'bInputB'].some(input =>
      edge(copyBusyNot, C.Expr_LogicalNOT.NAME,
        'bOutput', and, C.Expr_LogicalAND.NAME, input)))
      && ['bInputA', 'bInputB'].some(input => edge(runningNot, C.Expr_LogicalNOT.NAME,
        'bOutput', and, C.Expr_LogicalAND.NAME, input)));
  assert(startAvailabilityGate, 'Play start must require both !running and !copyBusy');

  const definition = bricksOf(C.Microchip_FunctionDefinition.NAME)[0];
  const calls = bricksOf(C.FunctionCall.NAME);
  const activeGets = bricksOf(C.Exec_ArrayVar_Get.NAME).filter(get =>
    edge(active, C.ArrayVar.NAME, 'ArrayVarRef', get, C.Exec_ArrayVar_Get.NAME, 'ArrayVarRef'));
  assert.equal(activeGets.length, ctx.constants.HEADER_LENGTH + ctx.constants.MAX_VOICES,
    'ActiveScore needs full-header commit verification and one getter per playback voice');
  const playbackGets = new Set();
  for (const call of calls) {
    const native = component(call, C.FunctionCall.NAME);
    assert.deepEqual(native.data.InputSources, [1, 0, 0, 0, 0, 0, 0, 0]);
    assert(edge(definition, C.Microchip_FunctionDefinition.NAME, 'Definition', call,
      C.FunctionCall.NAME, 'Definition'));
    const getter = activeGets.find(get => edge(get, C.Exec_ArrayVar_Get.NAME, 'Value', call,
      C.FunctionCall.NAME, 'Input0'));
    assert(getter, 'Each FunctionCall Input0 must be wired from ActiveScore ArrayGet.Value');
    playbackGets.add(getter.key);
    const voiceIndex = Array.from({length: ctx.constants.MAX_VOICES}, (_, index) => index)
      .find(index => edge(marked(`voice${index}.cursor`),
      C.Var.NAME, 'Value', getter, C.Exec_ArrayVar_Get.NAME, 'Index'));
    assert.notEqual(voiceIndex, undefined, 'Playback getter must use one retained voice cursor');

    const noteReadBuffer = unique(C.BufferTicks.NAME, (data, buffer) =>
      data.TicksToWait === 1
        && edge(getter, C.Exec_ArrayVar_Get.NAME, 'ExecOut', buffer,
          C.BufferTicks.NAME, 'Input')
        && edge(buffer, C.BufferTicks.NAME, 'Output', call,
          C.FunctionCall.NAME, 'Exec'));
    assert.equal(component(noteReadBuffer, C.BufferTicks.NAME).data.TicksToWait, 1,
      `Voice ${voiceIndex} ActiveScore read must publish for one tick`);
    const decodeCallCounter = unique(C.Exec_Var_Increment.NAME, (_data, increment) =>
      edge(marked(`voice${voiceIndex}.decode.calls`), C.Var.NAME, 'VarRef', increment,
        C.Exec_Var_Increment.NAME, 'VarRef'));
    const saveGetterOob = setterFor(marked(`voice${voiceIndex}.getter.lastOutOfBounds`));
    assert(edge(noteReadBuffer, C.BufferTicks.NAME, 'Output', decodeCallCounter,
      C.Exec_Var_Increment.NAME, 'Exec'),
    `Voice ${voiceIndex} decode count must follow the published read`);
    assert(edge(noteReadBuffer, C.BufferTicks.NAME, 'Output', saveGetterOob,
      C.Exec_Var_Set.NAME, 'Exec'),
    `Voice ${voiceIndex} OOB capture must follow the published read`);

    const noteLoaded = marked(`voice${voiceIndex}.note.loaded`);
    const markNoteLoaded = unique(C.Exec_Var_Set.NAME, (data, setter) =>
      data.Value?.value === true
        && edge(noteLoaded, C.Var.NAME, 'VarRef', setter,
          C.Exec_Var_Set.NAME, 'VarRef'));
    const decodeBranch = unique(C.Exec_Branch.NAME, (_data, branch) =>
      edge(branch, C.Exec_Branch.NAME, 'ExecOutA', markNoteLoaded,
        C.Exec_Var_Set.NAME, 'Exec'));
    const decodeConditionBuffer = unique(C.BufferTicks.NAME, (data, buffer) =>
      data.TicksToWait === 1
        && edge(buffer, C.BufferTicks.NAME, 'Output', decodeBranch,
          C.Exec_Branch.NAME, 'Exec'));
    const abortCounter = unique(C.Exec_Var_Increment.NAME, (_data, increment) =>
      edge(marked(`voice${voiceIndex}.decode.abortedCount`), C.Var.NAME, 'VarRef', increment,
        C.Exec_Var_Increment.NAME, 'VarRef'));
    const abortJoin = unique(C.Exec_Union.NAME, (_data, union) =>
      edge(abortCounter, C.Exec_Var_Increment.NAME, 'ExecOut', union,
        C.Exec_Union.NAME, 'ExecA')
        && edge(union, C.Exec_Union.NAME, 'ExecOut', decodeConditionBuffer,
          C.BufferTicks.NAME, 'Input'));
    const abortBranch = unique(C.Exec_Branch.NAME, (_data, branch) =>
      edge(branch, C.Exec_Branch.NAME, 'ExecOutA', abortCounter,
        C.Exec_Var_Increment.NAME, 'Exec')
        && edge(branch, C.Exec_Branch.NAME, 'ExecOutB', abortJoin,
          C.Exec_Union.NAME, 'ExecB'));
    assert(abortBranch,
      `Voice ${voiceIndex} abort decision must join before decoder publication`);
    assert.equal(component(decodeConditionBuffer, C.BufferTicks.NAME).data.TicksToWait, 1,
      `Voice ${voiceIndex} decoder acceptance must publish for one tick`);
    for (let output = 0; output < 4; output++) {
      assert(scene.edges.some(candidate => candidate.a === call.key
        && candidate.at === C.FunctionCall.NAME && candidate.p === `Output${output}`
        && candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Value'),
      `FunctionCall.Output${output} must be retained`);
    }
  }
  assert.equal(playbackGets.size, ctx.constants.MAX_VOICES,
    'Each voice needs its own ActiveScore getter');
  assert.equal(activeGets.every(get => !scene.edges.some(candidate => candidate.a === staging.key
    && candidate.z === get.key && candidate.q === 'ArrayVarRef')), true);

  const multiplyTargets = fallback => bricksOf(C.Expr_MathMultiply.NAME).filter(multiply =>
    edge(fallback.select, C.Expr_Select.NAME, 'Output', multiply,
      C.Expr_MathMultiply.NAME, 'InputB'));
  const speedTargets = multiplyTargets(speedFallback);
  const pitchTargets = multiplyTargets(pitchFallback);
  const volumeTargets = multiplyTargets(volumeFallback);
  assert.equal(speedTargets.length, 1,
    'Effective speed must drive the one musical-time multiplier');
  assert.equal(pitchTargets.length, ctx.constants.MAX_VOICES,
    'Effective pitch must drive every voice pitch multiplier');
  assert.equal(volumeTargets.length, ctx.constants.MAX_VOICES,
    'Effective volume must drive every voice master-volume multiplier');
  const playbackStart = marked('playback.start.time');
  const clock = unique(C.Stopwatch.NAME);
  const elapsed = unique(C.Expr_MathSubtract.NAME, (_data, subtract) =>
    edge(clock, C.Stopwatch.NAME, 'Time', subtract,
      C.Expr_MathSubtract.NAME, 'InputA')
      && edge(playbackStart, C.Var.NAME, 'Value', subtract,
        C.Expr_MathSubtract.NAME, 'InputB'));
  assert(edge(elapsed, C.Expr_MathSubtract.NAME, 'Output', speedTargets[0],
    C.Expr_MathMultiply.NAME, 'InputA'),
  'Effective speed must multiply elapsed playback time');
  const emitters = bricksOf(C.AudioEmitter.NAME);
  const dampens = bricksOf(C.Dampen.NAME);
  for (const multiply of pitchTargets) {
    assert(emitters.some(emitter => edge(multiply, C.Expr_MathMultiply.NAME, 'Output', emitter,
      C.AudioEmitter.NAME, 'PitchMultiplier')),
    'Every effective-pitch multiplier must drive a Sine emitter');
  }
  for (const multiply of volumeTargets) {
    assert(dampens.some(dampen => edge(multiply, C.Expr_MathMultiply.NAME, 'Output', dampen,
      C.Dampen.NAME, 'Target')),
    'Every effective-volume multiplier must drive a Dampen envelope');
  }

  for (const emitter of emitters) {
    const native = component(emitter, C.AudioEmitter.NAME);
    assert.equal(native.data.AudioDescriptor, 1);
    assert.equal(scene.r.externalAssets()[native.data.AudioDescriptor].name, 'BA_Synth_Basic_Sine');
    assert.equal(native.data.bEnabled, false);
    assert.equal(native.data.bSpatialization, false);
    assert.equal(scene.edges.filter(candidate => candidate.z === emitter.key
      && candidate.zt === C.AudioEmitter.NAME && candidate.q === 'bEnabled').length, 1);
    assert.equal(scene.edges.filter(candidate => candidate.z === emitter.key
      && candidate.zt === C.AudioEmitter.NAME && candidate.q === 'PitchMultiplier').length, 1);
    assert.equal(scene.edges.filter(candidate => candidate.z === emitter.key
      && candidate.zt === C.AudioEmitter.NAME && candidate.q === 'VolumeMultiplier').length, 1);
  }
  assert.equal(dampens.length, ctx.constants.MAX_VOICES,
    'Expected one envelope Dampen per voice');
  for (const dampen of dampens) {
    const smoothTime = component(dampen, C.Dampen.NAME).data.SmoothTime;
    assert(Number.isFinite(smoothTime), 'Dampen SmoothTime must serialize as raw finite f64');
    assert(Math.abs(smoothTime - 0.04) < 1e-7, 'Dampen SmoothTime changed');
  }

  const markerLabels = scene.bricks.flatMap(brick => brick.comps)
    .filter(candidate => candidate.type === C.Interact.NAME
      && candidate.data.Message?.startsWith(`${ctx.constants.PREFIX}:`))
    .map(candidate => candidate.data.Message);
  assert.equal(new Set(markerLabels).size, markerLabels.length, 'Markers must be unique');
  for (const record of ctx.records) {
    const brick = marked(record.label);
    assert.deepEqual(component(brick, C[record.key].NAME).data, record.node.data,
      `Retained field changed: ${record.label}`);
  }

  const targets = new Set();
  for (const candidate of scene.edges) {
    const source = scene.bricks.find(brick => brick.key === candidate.a);
    const target = scene.bricks.find(brick => brick.key === candidate.z);
    assert(source?.comps.some(sourceComponent => sourceComponent.type === candidate.at));
    assert(target?.comps.some(targetComponent => targetComponent.type === candidate.zt));
    const targetKey = `${candidate.z}|${candidate.zt}|${candidate.q}`;
    assert(!targets.has(targetKey), `Duplicate input ${targetKey}`);
    targets.add(targetKey);
    const sourceDefinition = Object.values(C).find(definitionCandidate =>
      definitionCandidate.NAME === candidate.at);
    const targetDefinition = Object.values(C).find(definitionCandidate =>
      definitionCandidate.NAME === candidate.zt);
    assert(Object.values(sourceDefinition.PORTS).includes(candidate.p), candidate.p);
    assert(Object.values(targetDefinition.PORTS).includes(candidate.q), candidate.q);
  }
  assert.equal(scene.edges.length, ctx.b.edges.length, 'Serialized wire count changed');
  assert.equal(bricksOf(C.TextDisplay.NAME).length, 4, 'Expected instructions and three readouts');
  assert.equal(scene.edges.filter(candidate => candidate.zt === C.TextDisplay.NAME
    && candidate.q === 'Text').length, 3, 'Three status panels must be live-wired');

  console.log('Wireless Sine player integration V5 serialization checks passed: exact SQM1 ports, '
    + 'same-callback remote staging copy, validated local active commit, eighteen wired DecodeNote '
    + 'callers, persistent request window, three validation and four playback publication buffers, '
    + 'positive-value pitch/speed/volume fallbacks, eighteen continuous Sine voices, retained runtime '
    + 'diagnostics and strict placement.');
};
