'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testAutoZoneFrameIntegrationV2(context) {
  const {playerScene: player, cartridgeScene: cartridge, constants} = context;
  const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
  const bricksOf = (scene, type) => scene.bricks.filter(brick => component(brick, type));
  const compOf = (scene, type) => bricksOf(scene, type).map(brick => ({brick, comp: component(brick, type)}));
  const edge = (scene, source, sourceType, output, target, targetType, input) =>
    scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
      && candidate.p === output && candidate.z === target.key
      && candidate.zt === targetType && candidate.q === input);
  const incoming = (scene, target, type, port) => scene.edges.filter(candidate =>
    candidate.z === target.key && candidate.zt === type && candidate.q === port);
  const outgoing = (scene, source, type, port) => scene.edges.filter(candidate =>
    candidate.a === source.key && candidate.at === type && candidate.p === port);
  const one = (items, label) => {
    assert.equal(items.length, 1, label);
    return items[0];
  };
  const marked = (scene, prefix, label) => one(scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `${prefix}${label}`), `${prefix}${label}`);
  const scalar = value => value && typeof value === 'object' && 'value' in value
    ? value.value : value;

  const playerPlacement = validatePlacement(context.playerBytes);
  const cartridgePlacement = validatePlacement(context.cartridgeBytes);
  assert(playerPlacement.strictOk, JSON.stringify(playerPlacement));
  assert(cartridgePlacement.strictOk, JSON.stringify(cartridgePlacement));

  const zone = one(bricksOf(player, C.AttachedZone.NAME), 'one existing intake zone');
  const zoneData = component(zone, C.AttachedZone.NAME).data;
  assert.equal(zoneData.bDetectEntities, true);
  assert.equal(zoneData.bDetectPlayers, false);
  assert.equal(zoneData.bDetectPlayers1, false);
  assert.equal(zoneData.bDetectPlayers2, false);
  assert.equal(zoneData.bDetectPlayers3, false);
  assert.equal(constants.TAG, '');
  assert.equal(zoneData.TagFilter, '', 'Physics-root intake uses object-protocol discovery');
  const entered = one(bricksOf(player, C.EntityZoneEvent_Entered.NAME), 'one entity-enter event');
  assert.equal(component(entered, C.EntityZoneEvent_Entered.NAME).data.TagFilter, '');
  assert(edge(player, zone, C.AttachedZone.NAME, 'ZoneRef', entered,
    C.EntityZoneEvent_Entered.NAME, 'Zone'));
  const arrival = one(outgoing(player, entered, C.EntityZoneEvent_Entered.NAME, 'Entity')
    .filter(candidate => candidate.q === 'DataIn1')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z)), 'arrival snapshot');
  assert.equal(component(arrival, C.QueueTicks.NAME).data.TicksToWait, 1);
  assert.equal(bricksOf(player, C.Exec_Entity_GetTag.NAME).length, 0,
    'Root discovery relies on the object-scoped protocol rather than an unavailable baked root tag');

  const request = one(compOf(player, C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Request'), 'one SQM1 request sender').brick;
  const ack = one(compOf(player, C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Ack'), 'one SQM1 ack sender').brick;
  const offer = one(compOf(player, C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Offer'), 'one SQM1 offer receiver').brick;
  const requestTarget = one(incoming(player, request, C.Exec_SendCustomEventGlobal.NAME, 'Target'),
    'object-targeted request');
  const ackTarget = one(incoming(player, ack, C.Exec_SendCustomEventGlobal.NAME, 'Target'),
    'object-targeted ack');
  assert.equal(requestTarget.a, ackTarget.a, 'request/ack retain the same candidate');
  assert.equal(requestTarget.at, C.Var.NAME);
  assert.equal(requestTarget.p, 'Value');
  const requestData = component(request, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(scalar(requestData.DataIn5), 18,
    'player advertises enough fixed voices for the complete Viva score');
  assert(scalar(requestData.DataIn6) >= 3464,
    'player advertises enough array capacity for all Viva score quaternions');
  assert.equal(scalar(requestData.DataIn7), 1, 'player requests SQM1 format 1');
  assert.equal(context.player.context.constants.MAX_VOICES, 18);
  assert(context.player.context.constants.MAX_SCORE_LENGTH >= 3464);

  const minimumLength = one(outgoing(player, offer, C.Event_CustomGlobal.NAME, 'DataOut5')
    .filter(candidate => candidate.zt === C.Expr_CompareGreaterOrEqual.NAME
      && candidate.q === 'InputA')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z)),
  'generic minimum score-length check');
  const maximumLength = one(outgoing(player, offer, C.Event_CustomGlobal.NAME, 'DataOut5')
    .filter(candidate => candidate.zt === C.Expr_CompareLessOrEqual.NAME
      && candidate.q === 'InputA')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z)),
  'generic maximum score-length check');
  assert.equal(scalar(component(minimumLength,
    C.Expr_CompareGreaterOrEqual.NAME).data.InputB), 35);
  assert.equal(scalar(component(maximumLength,
    C.Expr_CompareLessOrEqual.NAME).data.InputB),
  context.player.context.constants.MAX_SCORE_LENGTH);

  const nonce = marked(player, 'MWSP5:', 'request.nonce');
  const random = one(bricksOf(player, C.Exec_Random.NAME), 'random transaction nonce');
  const randomSetter = one(outgoing(player, random, C.Exec_Random.NAME, 'Output')
    .filter(candidate => candidate.q === 'Value')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z)), 'random nonce setter');
  assert(edge(player, nonce, C.Var.NAME, 'VarRef', randomSetter, C.Exec_Var_Set.NAME, 'VarRef'));
  assert(edge(player, nonce, C.Var.NAME, 'Value', request, C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'));
  const timeout = one(compOf(player, C.QueueSeconds.NAME)
    .filter(({comp}) => Math.abs(comp.data.SecondsToWait - 2) < 1e-6), 'two-second no-offer timeout').brick;
  assert(edge(player, nonce, C.Var.NAME, 'Value', timeout, C.QueueSeconds.NAME, 'DataIn1'));

  const staging = marked(player, 'MWSP5:', 'player.staging');
  const copies = bricksOf(player, C.Exec_ArrayVar_CopyFrom.NAME);
  assert.equal(copies.length, 2, 'staging and active copies');
  assert(copies.some(copy => edge(player, offer, C.Event_CustomGlobal.NAME, 'DataOut3', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef')), 'same-callback remote ArrayVarRef copy');
  assert(copies.some(copy => edge(player, staging, C.ArrayVar.NAME, 'ArrayVarRef', copy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef')), 'staging remains player-owned');

  const active = marked(player, 'MWSP5:', 'player.active');
  const stagingGets = outgoing(player, staging, C.ArrayVar.NAME, 'ArrayVarRef')
    .filter(candidate => candidate.zt === C.Exec_ArrayVar_Get.NAME
      && candidate.q === 'ArrayVarRef');
  const activeGets = outgoing(player, active, C.ArrayVar.NAME, 'ArrayVarRef')
    .filter(candidate => candidate.zt === C.Exec_ArrayVar_Get.NAME
      && candidate.q === 'ArrayVarRef');
  assert.equal(stagingGets.length, 34, 'all 34 generic headers are validated before commit');
  assert.equal(activeGets.length, 34 + 18,
    'active copy revalidates all headers and supplies all 18 voice schedulers');
  for (let index = 0; index < 34; index++) {
    marked(player, 'MWSP5:', `header.q${index}`);
    marked(player, 'MWSP5:', `active.header.q${index}`);
  }

  const consume = one(bricksOf(player, C.Exec_Entity_DestroySpawnedPrefab.NAME),
    'commit-gated cartridge consumption');
  const consumeEntity = one(incoming(player, consume, C.Exec_Entity_DestroySpawnedPrefab.NAME, 'Entity'),
    'consume candidate input');
  assert.equal(consumeEntity.a, requestTarget.a, 'only the accepted candidate is consumed');
  const consumeExec = one(incoming(player, consume, C.Exec_Entity_DestroySpawnedPrefab.NAME, 'Exec'),
    'consume execution');
  const consumeBuffer = player.bricks.find(brick => brick.key === consumeExec.a);
  assert(component(consumeBuffer, C.BufferTicks.NAME));
  assert.equal(component(consumeBuffer, C.BufferTicks.NAME).data.TicksToWait, 2);
  const ackCounter = one(outgoing(player, ack, C.Exec_SendCustomEventGlobal.NAME, 'ExecOut')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z)), 'ack counter');
  assert(edge(player, ackCounter, C.Exec_Var_Increment.NAME, 'ExecOut', consumeBuffer,
    C.BufferTicks.NAME, 'Input'));

  const displays = compOf(player, C.TextDisplay.NAME);
  const songDisplay = one(displays.filter(({comp}) => comp.data.Text === 'Song Name'), 'song display').brick;
  const statusDisplay = one(displays.filter(({comp}) => comp.data.Text === 'Status'), 'status display').brick;
  const title = marked(player, 'MWSP5:', 'title');
  assert(edge(player, title, C.Var.NAME, 'Value', songDisplay, C.TextDisplay.NAME, 'Text'));
  const dynamicTitleSetter = one(bricksOf(player, C.Exec_Var_Set.NAME).filter(setter =>
    edge(player, offer, C.Event_CustomGlobal.NAME, 'DataOut6', setter,
      C.Exec_Var_Set.NAME, 'Value')
      && edge(player, title, C.Var.NAME, 'VarRef', setter,
        C.Exec_Var_Set.NAME, 'VarRef')), 'dynamic offered-title setter');
  assert(dynamicTitleSetter, 'accepted cartridge title is retained without a fixed-title match');
  assert(outgoing(player, offer, C.Event_CustomGlobal.NAME, 'DataOut6')
    .every(candidate => candidate.zt === C.Exec_Var_Set.NAME),
  'offered title is captured rather than compared with a test-only title');
  const statusWire = one(incoming(player, statusDisplay, C.TextDisplay.NAME, 'Text'), 'status display wire');
  assert.equal(statusWire.at, C.Expr_String_FormatText.NAME);

  const requiredButtons = ['Play', 'Stop', 'Playback speed down', 'Playback speed Up',
    'Pitch Down', 'Pitch Up', 'Volume down', 'Volume Up',
    'Previous instrument', 'Next instrument'];
  for (const label of requiredButtons) {
    const button = one(compOf(player, C.Button.NAME)
      .filter(({comp}) => comp.data.PromptCustomLabel === label), `button ${label}`).brick;
    assert(outgoing(player, button, C.Button.NAME, 'bHeld').length >= 1, `${label} is wired`);
  }
  assert.equal(compOf(player, C.Button.NAME)
    .filter(({comp}) => ['LOAD / LISTEN', 'PLAY LOCAL COPY', 'STOP'].includes(comp.data.PromptCustomLabel)).length,
  0, 'standalone V5 controls removed');

  const volumeClamps = compOf(player, C.Expr_MathClamp.NAME)
    .filter(({comp}) => Math.abs(scalar(comp.data.Min) - 0.01) < 1e-9
      && Math.abs(scalar(comp.data.Max) - 2) < 1e-9);
  assert.equal(volumeClamps.length, 3,
    'volume down, volume up and the exposed override all clamp to 0.01..2.0');
  const exposedVolume = one(compOf(player, C.MicrochipInput.NAME)
    .filter(({comp}) => comp.data.PortLabel === 'Volume (0=buttons)'), 'exposed volume input').brick;
  const exposedVolumeClamp = one(outgoing(player, exposedVolume, C.MicrochipInput.NAME, 'RER_Output')
    .filter(candidate => candidate.q === 'Input')
    .map(candidate => player.bricks.find(brick => brick.key === candidate.z))
    .filter(brick => component(brick, C.Expr_MathClamp.NAME)), 'exposed volume clamp');
  assert(volumeClamps.some(({brick}) => brick.key === exposedVolumeClamp.key));
  assert.equal(outgoing(player, exposedVolumeClamp, C.Expr_MathClamp.NAME, 'Output')
    .filter(candidate => candidate.q === 'InputB').length, 1,
  'clamped exposed volume drives the inherited override selector');

  const emitters = compOf(player, C.AudioEmitter.NAME);
  assert.equal(context.player.context.constants.MAX_VOICES, 18);
  assert.equal(emitters.length, context.player.context.constants.MAX_VOICES * 3,
    'each fixed voice has its fundamental and two Sine harmonics');
  const assets = player.r.externalAssets();
  for (const {comp} of emitters) {
    assert.deepEqual(assets[comp.data.AudioDescriptor],
      {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'});
  }
  const dampens = bricksOf(player, C.Dampen.NAME);
  assert.equal(dampens.length, context.player.context.constants.MAX_VOICES);
  assert(dampens.every(dampen => incoming(player, dampen, C.Dampen.NAME, 'SmoothTime').length === 1),
    'instrument selection drives every envelope');
  assert(emitters.every(({brick}) => incoming(player, brick, C.AudioEmitter.NAME, 'bEnabled').length === 1
    && incoming(player, brick, C.AudioEmitter.NAME, 'VolumeMultiplier').length === 1
    && incoming(player, brick, C.AudioEmitter.NAME, 'PitchMultiplier').length === 1),
  'all Sine layers have continuous enable, volume and pitch drivers');
  assert.equal(bricksOf(player, C.Microchip_FunctionDefinition.NAME).length, 1,
    'shared DecodeNote function retained');
  assert.equal(bricksOf(player, C.FunctionCall.NAME).length,
    context.player.context.constants.MAX_VOICES,
    'all V5 voices call the shared decoder');

  const rootChip = one(bricksOf(player, C.Microchip.NAME).filter(brick => brick.g === 1), 'frame root chip');
  const outerLink = one(player.links.filter(link => link.key === rootChip.key), 'outer chip link');
  const outerGrid = outerLink.grid;
  const outerInputs = compOf(player, C.MicrochipInput.NAME)
    .filter(({brick}) => brick.g === outerGrid);
  const outerOutputs = compOf(player, C.MicrochipOutput.NAME)
    .filter(({brick}) => brick.g === outerGrid);
  assert.deepEqual(outerInputs.map(({comp}) => comp.data.PortLabel).sort(),
    ['Pitch (0=buttons)', 'Play (Pulse)', 'Speed (0=buttons)', 'Stop (Pulse)', 'Volume (0=buttons)'].sort());
  assert.deepEqual(outerOutputs.map(({comp}) => comp.data.PortLabel).sort(),
    ['Loaded', 'Playing', 'Song Title', 'Status'].sort());
  assert(outerInputs.every(({brick}) => outgoing(player, brick, C.MicrochipInput.NAME, 'RER_Output').length >= 1));
  assert(outerOutputs.every(({brick}) => incoming(player, brick, C.MicrochipOutput.NAME, 'RER_Input').length === 1));

  const cartridgePrefab = cartridge.r.prefabJson();
  assert.equal(cartridgePrefab.bIsPhysicsGrid, true,
    'Cartridge global grid must become the PrefabSpawner root');
  assert.equal(cartridgePrefab.bFreezePhysicsGrid, false);
  assert.equal([...cartridge.r.entities()].filter(entity =>
    entity.typeName === 'Entity_DynamicBrickGrid').length, 0,
  'Cartridge must not hide its visible body in a child dynamic entity');
  const rootBricks = cartridge.bricks.filter(brick => brick.g === 1);
  assert.equal(rootBricks.length, 2, 'Physics root contains the supplied title plate and chip');
  const cartridgeRootChip = one(rootBricks.filter(brick => component(brick, C.Microchip.NAME)),
    'physics-root cartridge chip');
  const rootPlate = one(rootBricks.filter(brick => component(brick, C.TextDisplay.NAME)),
    'physics-root cartridge title plate');
  assert.equal(cartridge.links.filter(link => link.key === cartridgeRootChip.key).length, 1,
    'Root chip reaches the object-scoped receiver in its nested logic grid');
  const cartridgeRequest = one(compOf(cartridge, C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Request'), 'cartridge request receiver');
  const cartridgeAck = one(compOf(cartridge, C.Event_CustomGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Ack'), 'cartridge ack receiver');
  assert.equal(cartridgeRequest.comp.data.bIsObjectEvent, true);
  assert.equal(cartridgeAck.comp.data.bIsObjectEvent, true);
  assert.equal(bricksOf(cartridge, C.Button.NAME).length, 0, 'cartridge has no manual send button');
  const score = marked(cartridge, 'MWIC1:', 'score');
  assert.equal(component(score, C.ArrayVar.NAME).data.Value.$elementType, 'Quat');
  assert.equal(component(score, C.ArrayVar.NAME).data.Value.$array.length, 46);
  const offerSender = one(compOf(cartridge, C.Exec_SendCustomEventGlobal.NAME)
    .filter(({comp}) => comp.data.EventName === 'SQM1.Offer'), 'cartridge offer sender').brick;
  assert(edge(cartridge, score, C.ArrayVar.NAME, 'ArrayVarRef', offerSender,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'));
  const accepted = marked(cartridge, 'MWIC1:', 'state.request.accepted');
  const acceptedCounter = one(outgoing(cartridge, accepted, C.Var.NAME, 'VarRef')
    .filter(candidate => candidate.q === 'VarRef')
    .map(candidate => cartridge.bricks.find(brick => brick.key === candidate.z)), 'accepted counter');
  const autoWait = one(outgoing(cartridge, acceptedCounter, C.Exec_Var_Increment.NAME, 'ExecOut')
    .filter(candidate => candidate.q === 'Input')
    .map(candidate => cartridge.bricks.find(brick => brick.key === candidate.z)), 'automatic offer wait');
  assert.equal(component(autoWait, C.BufferTicks.NAME).data.TicksToWait, 1);
  assert.equal(component(rootPlate, C.TextDisplay.NAME).data.Text,
    'SQM1 two-voice load/play test');

  const uniqueTargets = new Set();
  for (const scene of [player, cartridge]) for (const wire of scene.edges) {
    const target = `${wire.z}:${wire.zt}:${wire.q}`;
    assert(!uniqueTargets.has(`${scene === player ? 'p' : 'c'}:${target}`), `Duplicate target ${target}`);
    uniqueTargets.add(`${scene === player ? 'p' : 'c'}:${target}`);
  }

  console.log('SQM1 auto-zone frame V2 checks passed: supplied shell, physics-root intake, '
    + 'random object-targeted transaction, direct ArrayVarRef copy, commit-gated consumption, '
    + 'frame controls/displays, exposed ports, eighteen voices, layered Sine instruments and auto-offer cartridge.');
};
