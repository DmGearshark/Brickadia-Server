'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testMidiWirelessSinePlayerIntegrationV1(ctx) {
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
  assert.equal(bricksOf(C.FunctionCall.NAME).length, 2, 'Expected one call per voice');
  assert.equal(bricksOf(C.AudioEmitter.NAME).length, 2, 'Expected one Sine emitter per voice');
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
  assert.equal(requestData.DataIn5.value, 2);
  assert.equal(requestData.DataIn6.value, 256);
  assert.equal(requestData.DataIn7.value, 1);
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
  const timeout = unique(C.QueueSeconds.NAME);
  assert.equal(component(timeout, C.QueueSeconds.NAME).data.SecondsToWait, 10,
    'Request timeout must serialize as raw f32 seconds');

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
  assert.equal(activeGets.length, 7,
    'ActiveScore needs five commit-verification getters and two playback getters');
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
    assert(edge(getter, C.Exec_ArrayVar_Get.NAME, 'ExecOut', call,
      C.FunctionCall.NAME, 'Exec'), 'ArrayGet.ExecOut must execute FunctionCall directly');
    for (let output = 0; output < 4; output++) {
      assert(scene.edges.some(candidate => candidate.a === call.key
        && candidate.at === C.FunctionCall.NAME && candidate.p === `Output${output}`
        && candidate.zt === C.Exec_Var_Set.NAME && candidate.q === 'Value'),
      `FunctionCall.Output${output} must be retained`);
    }
  }
  assert.equal(playbackGets.size, 2, 'Each voice needs its own ActiveScore getter');
  assert.equal(activeGets.every(get => !scene.edges.some(candidate => candidate.a === staging.key
    && candidate.z === get.key && candidate.q === 'ArrayVarRef')), true);

  for (const emitter of bricksOf(C.AudioEmitter.NAME)) {
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
  const dampens = bricksOf(C.Dampen.NAME);
  assert.equal(dampens.length, 2, 'Expected one envelope Dampen per voice');
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

  console.log('Wireless Sine player integration serialization checks passed: exact SQM1 ports, '
    + 'same-callback remote staging copy, validated local active commit, two wired DecodeNote '
    + 'callers, two continuous Sine voices, retained runtime diagnostics and strict placement.');
};
