'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {Build, C, R, N, B, S, O, metadata} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const FRAME_DEFAULT = path.join(__dirname, 'sources', 'music-player-frame-and-cartridge.brz');
const PLAYER_DEFAULT = 'prefabs/sqm1-auto-zone-music-player-frame-v1.brz';
const CARTRIDGE_DEFAULT = 'prefabs/sqm1-auto-zone-test-cartridge-v1.brz';
const TAG = 'SQM1.Cartridge';
const PLAYER_GRID = 1398956;
const OUTER_GRID = 1392400;
const CARTRIDGE_ENTITY = 1399355;
const CARTRIDGE_GRID = 1399356;
const FUNCTION_GRID = 1402401;

const clone = value => structuredClone(value);
const samePosition = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

function unfinished(builder) {
  const original = Build.prototype.finish;
  Build.prototype.finish = function deferredFinish() { return Buffer.alloc(0); };
  try {
    return {context: builder(), finish: original};
  } finally {
    Build.prototype.finish = original;
  }
}

function rootButton(context, id, position, label) {
  const node = {id, type: C.Button.NAME, pos: position, grid: undefined,
    data: {PromptCustomLabel: label, bAllowNearbyInteraction: true, bHiddenInteraction: false}};
  context.b.add(node, {
    asset: 'PB_DefaultMicroBrick', size: [5, 5, 2], position,
    direction: 4, rotation: 2, color: [90, 90, 90],
    components: [{type: node.type, data: node.data}],
  });
  return node;
}

function rootZone(context, id, position) {
  const node = {id, type: C.AttachedZone.NAME, pos: position, grid: undefined, data: {
    ZoneStartDistance: 0, ZoneEndDistance: 10,
    bIsBuildingZone: false, bIsLooseZone: false, bIsShareZone: false, bWater: false,
    bDetectPlayers: false, bDetectPlayers1: false, bDetectPlayers2: false,
    bDetectPlayers3: false, bDetectEntities: true, bDetectProjectiles: false,
    TagFilter: TAG, ZoneWindForce: 0,
  }};
  context.b.add(node, {
    asset: C.AttachedZone.BRICK, size: [20, 25, 2], position,
    direction: 3, rotation: 0, color: [80, 120, 170],
    components: [{type: node.type, data: node.data}],
  });
  return node;
}

function edgeFromVar(build, variable, targetType) {
  const edge = build.edges.find(candidate => candidate.a === variable
    && candidate.p === 'VarRef' && candidate.q === 'VarRef'
    && (!targetType || candidate.z.type === targetType));
  assert(edge, `Variable consumer for ${variable.id}`);
  return edge.z;
}

function oneEdge(edges, target, port) {
  const matches = edges.filter(edge => edge.z === target && edge.q === port);
  assert.equal(matches.length, 1, `${target.id}.${port} driver`);
  return matches[0];
}

function playerLogic() {
  const baseBuilder = require('./build-sqm1-wireless-sine-player-integration-v4.cjs');
  const {context, finish} = unfinished(baseBuilder);
  const {b, c} = context;

  const controls = {
    speedDown: rootButton(context, 'frame_speed_down_proxy', [-520, -520, 4], 'Playback speed down'),
    speedUp: rootButton(context, 'frame_speed_up_proxy', [-500, -520, 4], 'Playback speed Up'),
    pitchDown: rootButton(context, 'frame_pitch_down_proxy', [-480, -520, 4], 'Pitch Down'),
    pitchUp: rootButton(context, 'frame_pitch_up_proxy', [-460, -520, 4], 'Pitch Up'),
    volumeDown: rootButton(context, 'frame_volume_down_proxy', [-440, -520, 4], 'Volume down'),
    volumeUp: rootButton(context, 'frame_volume_up_proxy', [-420, -520, 4], 'Volume Up'),
    timbrePrevious: rootButton(context, 'frame_timbre_previous_proxy', [-400, -520, 4], 'Previous instrument'),
    timbreNext: rootButton(context, 'frame_timbre_next_proxy', [-380, -520, 4], 'Next instrument'),
  };
  const zone = rootZone(context, 'frame_zone_proxy', [-360, -520, 4]);

  // Local physical-control defaults remain active unless a positive exposed
  // numeric input overrides them. Pitch steps by one equal-tempered semitone.
  const pitchState = c.v(1);
  const speedState = c.v(1);
  const volumeState = c.v(0.08);
  c.bind(context.effectiveControls.effectivePitch[0], 'InputA', R(pitchState));
  c.bind(context.effectiveControls.effectiveSpeed[0], 'InputA', R(speedState));
  c.bind(context.effectiveControls.effectiveVolume[0], 'InputA', R(volumeState));

  function stepped(button, variable, operation, amount, minimum, maximum) {
    const edge = c.edge(R(button, 'bHeld'));
    const calculation = c.n(`Expr_Math${operation}`, {
      InputA: R(variable), InputB: N(amount),
    });
    const clamp = c.n('Expr_MathClamp', {
      Input: R(calculation, 'Output'), Min: N(minimum), Max: N(maximum),
    });
    const set = c.set(variable, R(clamp, 'Output'));
    c.link(edge, set, 'OnRisingEdge');
    return {edge, calculation, clamp, set};
  }
  const semitone = 2 ** (1 / 12);
  const steps = {
    speedDown: stepped(controls.speedDown, speedState, 'Subtract', 0.1, 0.25, 2),
    speedUp: stepped(controls.speedUp, speedState, 'Add', 0.1, 0.25, 2),
    pitchDown: stepped(controls.pitchDown, pitchState, 'Divide', semitone, 0.5, 2),
    pitchUp: stepped(controls.pitchUp, pitchState, 'Multiply', semitone, 0.5, 2),
    volumeDown: stepped(controls.volumeDown, volumeState, 'Subtract', 0.01, 0.01, 0.2),
    volumeUp: stepped(controls.volumeUp, volumeState, 'Add', 0.01, 0.01, 0.2),
  };

  // Every profile remains Sine-based. Two additional oscillators per voice
  // provide audible harmonic color while retaining the proven V4 scheduler,
  // decoder, fundamental emitter and master envelope.
  const timbre = c.v(0);
  function cycle(button, delta, underflow) {
    const edge = c.edge(R(button, 'bHeld'));
    const add = c.n(delta > 0 ? 'Expr_MathAdd' : 'Expr_MathSubtract', {
      InputA: R(timbre), InputB: N(Math.abs(delta)),
    });
    const outside = c.cmp(delta > 0 ? 'Greater' : 'Less', R(add, 'Output'), N(delta > 0 ? 7 : 0));
    const wrapped = c.sel(outside, R(add, 'Output'), N(underflow));
    const set = c.set(timbre, wrapped);
    c.link(edge, set, 'OnRisingEdge');
    return {edge, add, outside, set};
  }
  const timbrePrevious = cycle(controls.timbrePrevious, -1, 7);
  const timbreNext = cycle(controls.timbreNext, 1, 0);
  const modeChecks = Array.from({length: 8}, (_, index) =>
    c.cmp('Equal', R(timbre), N(index)));
  const profileNames = ['Auto', 'Piano', 'Bell', 'Organ', 'Strings', 'Bass', 'Flute', 'Synth'];
  let timbreName = S('Auto');
  for (let index = 1; index < profileNames.length; index++) {
    timbreName = c.sel(modeChecks[index], timbreName, S(profileNames[index]));
  }

  const dampens = b.nodes.filter(node => node.type === C.Dampen.NAME);
  assert.equal(dampens.length, 2, 'V4 retains two voice envelopes');
  const profiles = {
    1: {smooth: 0.028, ratio1: 2, gain1: 0.18, ratio2: 3, gain2: 0.06},
    2: {smooth: 0.018, ratio1: 2.5, gain1: 0.30, ratio2: 4, gain2: 0.16},
    3: {smooth: 0.055, ratio1: 2, gain1: 0.42, ratio2: 3, gain2: 0.23},
    4: {smooth: 0.10, ratio1: 2, gain1: 0.14, ratio2: 3, gain2: 0.06},
    5: {smooth: 0.04, ratio1: 0.5, gain1: 0.28, ratio2: 1.5, gain2: 0.10},
    6: {smooth: 0.075, ratio1: 2, gain1: 0.06, ratio2: 3, gain2: 0.02},
    7: {smooth: 0.025, ratio1: 1.5, gain1: 0.24, ratio2: 2, gain2: 0.16},
  };
  const harmonics = [];
  for (let voice = 0; voice < dampens.length; voice++) {
    const program = R(context.headerSplits[voice + 2], 'Z');
    const piano = c.cmp('Less', program, N(8));
    const organ = c.and(c.cmp('GreaterOrEqual', program, N(16)),
      c.cmp('Less', program, N(24)));
    const bass = c.and(c.cmp('GreaterOrEqual', program, N(32)),
      c.cmp('Less', program, N(40)));
    const stringsLow = c.cmp('GreaterOrEqual', program, N(40));
    const stringsHigh = c.cmp('Less', program, N(48));
    const strings = c.and(stringsLow, stringsHigh);
    const flute = c.and(c.cmp('GreaterOrEqual', program, N(72)),
      c.cmp('Less', program, N(80)));
    let autoProfile = N(7);
    autoProfile = c.sel(piano, autoProfile, N(1));
    autoProfile = c.sel(organ, autoProfile, N(3));
    autoProfile = c.sel(bass, autoProfile, N(5));
    autoProfile = c.sel(strings, autoProfile, N(4));
    autoProfile = c.sel(flute, autoProfile, N(6));
    const resolvedProfile = c.sel(modeChecks[0], R(timbre), autoProfile);
    const resolvedChecks = Object.keys(profiles).map(Number).map(index =>
      c.cmp('Equal', resolvedProfile, N(index)));
    const parameter = key => {
      let value = N(profiles[7][key]);
      for (let index = 1; index <= 7; index++) {
        value = c.sel(resolvedChecks[index - 1], value, N(profiles[index][key]));
      }
      return value;
    };
    const smoothing = parameter('smooth');
    c.bind(dampens[voice], 'SmoothTime', smoothing);

    const baseEmitter = context.voiceBuilds[voice].emitter;
    const enableEdge = oneEdge(b.edges, baseEmitter, 'bEnabled');
    const volumeEdge = oneEdge(b.edges, baseEmitter, 'VolumeMultiplier');
    const pitchEdge = oneEdge(b.edges, baseEmitter, 'PitchMultiplier');
    const voiceHarmonics = [];
    for (const layer of [1, 2]) {
      const gain = parameter(`gain${layer}`);
      const ratio = parameter(`ratio${layer}`);
      const volume = c.n('Expr_MathMultiply', {
        InputA: R(volumeEdge.a, volumeEdge.p), InputB: gain,
      });
      const rawPitch = c.n('Expr_MathMultiply', {
        InputA: R(pitchEdge.a, pitchEdge.p), InputB: ratio,
      });
      const pitch = c.n('Expr_MathClamp', {
        Input: R(rawPitch, 'Output'), Min: N(0.1), Max: N(4),
      });
      const emitter = c.n('AudioEmitter', {
        bEnabled: false, AudioDescriptor: 1, VolumeMultiplier: 0, PitchMultiplier: 1,
        InnerRadius: 400, MaxDistance: 4000, bSpatialization: false,
        FocusAzimuth: 360, NonFocusAzimuth: 360, NonFocusVolumeAttenuation: 1,
      });
      c.bind(emitter, 'bEnabled', R(enableEdge.a, enableEdge.p));
      c.bind(emitter, 'VolumeMultiplier', R(volume, 'Output'));
      c.bind(emitter, 'PitchMultiplier', R(pitch, 'Output'));
      voiceHarmonics.push({layer, gain, ratio, volume, rawPitch, pitch, emitter});
    }
    harmonics.push({voice, resolvedProfile, smoothing, layers: voiceHarmonics});
  }

  // The paired cartridge has a tagged DynamicBrickGrid child. Exact filtering
  // avoids selecting an implicit untagged prefab-spawn root before that child.
  // The entity output is still snapshotted for one tick before use.
  const candidate = c.v(O(null));
  const autoPulse = c.v(false);
  const entered = c.n('EntityZoneEvent_Entered', {Zone: R(zone, 'ZoneRef'), TagFilter: TAG});
  const arrival = c.n('QueueTicks', {TicksToWait: 1, DataIn1: O(null)});
  c.bind(arrival, 'DataIn1', R(entered, 'Entity'));
  c.link(entered, arrival, 'Exec', 'ExecIn');
  const getTag = c.n('Exec_Entity_GetTag', {Entity: R(arrival, 'DataOut1')});
  c.link(arrival, getTag, 'ExecOut');
  const tagReady = c.wait(getTag, 1);
  const exactTag = c.cmp('Equal', R(getTag, 'Tag'), S(TAG));
  const idle = c.and(c.not(R(context.waiting)), c.not(R(context.copyBusy)));
  const acceptArrival = c.branch(tagReady, c.and(exactTag, idle), 'Output');
  const saveCandidate = c.set(candidate, R(arrival, 'DataOut1'));
  c.link(acceptArrival, saveCandidate, 'ExecOutA');
  const candidatePublished = c.wait(saveCandidate, 1);
  const pulseOn = c.set(autoPulse, true);
  c.link(candidatePublished, pulseOn, 'Output');
  const pulseDuration = c.wait(pulseOn, 1);
  const pulseOff = c.set(autoPulse, false);
  c.link(pulseDuration, pulseOff, 'Output');

  const requestButtonEdge = b.edges.find(edge => edge.a === context.buttons.requestButton
    && edge.p === 'bHeld' && edge.q === 'bInputA');
  assert(requestButtonEdge, 'V4 request button edge');
  requestButtonEdge.a = autoPulse;
  requestButtonEdge.p = 'Value';

  // V4's monotonic nonce is deterministic per pasted player. With global
  // offers, two players making their first request together could otherwise
  // share channel 1 / nonce 1. Replace only the nonce writer with a large
  // random value; the proven request/offer/copy path remains unchanged.
  const nonceIncrement = edgeFromVar(b, context.nonce, C.Exec_Var_Increment.NAME);
  const nonceExecIn = b.edges.find(edge => edge.z === nonceIncrement && edge.q === 'Exec');
  const nonceExecOut = b.edges.find(edge => edge.a === nonceIncrement && edge.p === 'ExecOut');
  assert(nonceExecIn && nonceExecOut, 'V4 nonce increment chain');
  const randomNonce = c.n('Exec_Random', {Min: N(1), Max: N(2147483646)});
  const saveRandomNonce = c.set(context.nonce, R(randomNonce, 'Output'));
  nonceExecIn.z = randomNonce;
  nonceExecIn.q = 'Exec';
  nonceExecOut.a = saveRandomNonce;
  nonceExecOut.p = 'ExecOut';
  c.link(randomNonce, saveRandomNonce);
  c.bind(context.request, 'Target', R(candidate));
  c.bind(context.ack, 'Target', R(candidate));

  // A non-cartridge or tagless unrelated entity cannot permanently leave the
  // player listening. Matching offers close waiting immediately; otherwise
  // this nonce-guarded timeout releases the candidate after two seconds.
  const offerTimeout = c.n('QueueSeconds', {
    SecondsToWait: 2, DataIn1: R(context.nonce),
  });
  c.link(context.request, offerTimeout, 'ExecOut', 'ExecIn');
  const sameNonce = c.cmp('Equal', R(offerTimeout, 'DataOut1'), R(context.nonce));
  const timeoutBranch = c.branch(offerTimeout, c.and(R(context.waiting), sameNonce), 'ExecOut');
  const closeTimedOut = c.set(context.waiting, false);
  c.link(timeoutBranch, closeTimedOut, 'ExecOutA');
  const clearTimedOutCandidate = c.set(candidate, O(null));
  c.link(closeTimedOut, clearTimedOutCandidate);

  const countAckEdge = b.edges.find(edge => edge.a === context.ack
    && edge.p === 'ExecOut' && edge.z.type === C.Exec_Var_Increment.NAME);
  assert(countAckEdge, 'V4 acknowledgment counter');
  const countAck = countAckEdge.z;
  const ackDelivered = c.wait(countAck, 2);
  const consume = c.n('Exec_Entity_DestroySpawnedPrefab', {Entity: R(candidate)});
  c.link(ackDelivered, consume, 'Output');
  const clearConsumedCandidate = c.set(candidate, O(null));
  c.link(consume, clearConsumedCandidate);

  // Replace the diagnostic panels with the supplied compact title/status UI.
  const displays = Object.fromEntries(b.nodes
    .filter(node => node.type === C.TextDisplay.NAME)
    .map(node => [node.id, node]));
  assert(displays.load_status && displays.commit_status && displays.play_status);
  b.edges = b.edges.filter(edge => !(edge.z.type === C.TextDisplay.NAME && edge.q === 'Text'));
  const unloaded = S('Insert cartridge');
  let stateText = c.sel(R(context.waiting), unloaded, S('Listening'));
  stateText = c.sel(R(context.loaded), stateText, S('Ready'));
  stateText = c.sel(R(context.running), stateText, S('Playing'));
  stateText = c.sel(R(context.copyBusy), stateText, S('Loading'));
  const statusText = c.fmt('{A} | {B}\r\nVOL {C}  SPD {D}  PITCH {E}',
    stateText, timbreName, R(volumeState), R(speedState), R(pitchState));
  c.bind(displays.load_status, 'Text', R(context.title));
  c.bind(displays.commit_status, 'Text', statusText);

  const bytes = finish.call(b, {x: 600, y: 600, z: 200},
    'Intermediate proven SQM1 V4 graph with automatic zone intake and frame-control proxies.');
  return {context, bytes, controls, zone, pitchState, speedState, volumeState, steps,
    timbre, timbreName, timbrePrevious, timbreNext, harmonics, candidate, autoPulse, entered,
    arrival, getTag, randomNonce, saveRandomNonce, offerTimeout, consume,
    statusText, displays, countAck};
}

function cartridgeLogic() {
  const baseBuilder = require('./build-midi-wireless-integration-cartridge-v1.cjs');
  const {context, finish} = unfinished(baseBuilder);
  const {b, disk} = context;
  context.request.data.bIsObjectEvent = true;
  context.ack.data.bIsObjectEvent = true;

  const acceptedCounter = edgeFromVar(b, context.requestAccepted, C.Exec_Var_Increment.NAME);
  const sendTrigger = b.edges.find(edge => edge.a === context.sendEdge
    && edge.p === 'OnRisingEdge' && edge.q === 'Exec');
  assert(sendTrigger, 'V1 manual-send branch');
  const canSend = sendTrigger.z;
  b.edges = b.edges.filter(edge => edge !== sendTrigger);
  const requestPublished = disk.wait(acceptedCounter, 1);
  disk.link(requestPublished, canSend, 'Output', 'Exec');

  const bytes = finish.call(b, {x: 180, y: 170, z: 130},
    'Intermediate SQM1 V1 cartridge graph with object-scoped request/ack and automatic offer.');
  return {context, bytes, acceptedCounter, canSend, requestPublished};
}

function nodeKey(scene, node, grid) {
  const matches = scene.bricks.filter(brick => brick.g === grid
    && samePosition(brick.data.position, node.pos)
    && brick.comps.some(component => component.type === node.type));
  assert.equal(matches.length, 1, `Serialized node ${node.id} in grid ${grid}`);
  return matches[0].key;
}

function component(brick, type) {
  return brick?.comps.find(candidate => candidate.type === type);
}

function oneBrick(scene, predicate, label) {
  const matches = scene.bricks.filter(predicate);
  assert.equal(matches.length, 1, label);
  return matches[0];
}

function entityClone(entity, persistentIndex = entity.persistentIndex) {
  return {...entity, persistentIndex, data: clone(entity.data), location: clone(entity.location),
    rotation: clone(entity.rotation), colors: clone(entity.colors)};
}

function proxyReader(reader, entityFilter) {
  return new Proxy(reader, {
    get(target, property) {
      if (property === 'entities') return () => [...target.entities()].filter(entityFilter);
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function addIoBrick(scene, kind, key, position, label, order, value) {
  const definition = kind === 'input' ? C.MicrochipInput : C.MicrochipOutput;
  const variant = typeof value === 'boolean' ? B(value)
    : typeof value === 'string' ? S(value) : N(value);
  const data = kind === 'input'
    ? {PortLabel: label, PortOrder: order, CallableDefault: variant, CallableMirror: clone(variant)}
    : {PortLabel: label, PortOrder: order, CallableDefault: variant, CallableResult: clone(variant)};
  scene.bricks.push({key, g: OUTER_GRID, data: {
    size: [0, 0, 0], position, direction: 4, rotation: 0,
    collision: {player: true, weapon: true, interaction: true, tool: true, physics: true},
    visibility: true, material_intensity: 5, color: kind === 'input' ? [55, 120, 190] : [160, 95, 190],
    owner_index: 0, asset: definition.BRICK, material: 'BMC_Plastic',
  }, comps: [{type: definition.NAME, data}]});
  return key;
}

function build(frameFile = FRAME_DEFAULT) {
  assert(fs.existsSync(frameFile), `Frame source not found: ${frameFile}`);
  const frame = read(fs.readFileSync(frameFile));
  const player = playerLogic();
  const cartridge = cartridgeLogic();
  const playerScene = read(player.bytes);
  const cartridgeScene = read(cartridge.bytes);

  const zone = oneBrick(frame, brick => component(brick, C.AttachedZone.NAME), 'Existing frame zone');
  Object.assign(component(zone, C.AttachedZone.NAME).data, {
    bDetectEntities: true, bDetectPlayers: false, bDetectPlayers1: false,
    bDetectPlayers2: false, bDetectPlayers3: false, bDetectProjectiles: false,
    TagFilter: TAG,
  });
  const physical = {};
  for (const label of ['Play', 'Stop', 'Playback speed down', 'Playback speed Up',
    'Pitch Down', 'Pitch Up', 'Volume down', 'Volume Up']) {
    physical[label] = oneBrick(frame, brick => component(brick, C.Button.NAME)?.data.PromptCustomLabel === label,
      `Frame button ${label}`);
  }
  const songDisplay = oneBrick(frame,
    brick => component(brick, C.TextDisplay.NAME)?.data.Text === 'Song Name', 'Song Name display');
  const statusDisplay = oneBrick(frame,
    brick => component(brick, C.TextDisplay.NAME)?.data.Text === 'Status', 'Status display');
  const musicPanels = frame.bricks.filter(brick => component(brick, C.TextDisplay.NAME)?.data.Text === '🎼');
  assert.equal(musicPanels.length, 2, 'Two music-note panels');
  musicPanels.sort((a, z) => a.data.position[0] - z.data.position[0]);
  for (const [index, brick] of musicPanels.entries()) brick.comps.push({type: C.Button.NAME, data: {
    PressSound: 2, ReleaseSound: 3, bAllowNearbyInteraction: true, bHiddenInteraction: false,
    PromptCustomLabel: index === 0 ? 'Previous instrument' : 'Next instrument',
  }});
  physical['Previous instrument'] = musicPanels[0];
  physical['Next instrument'] = musicPanels[1];

  const playerGridMap = new Map([[2, PLAYER_GRID], [3, FUNCTION_GRID]]);
  const playerKeyMap = new Map();
  for (const brick of playerScene.bricks.filter(candidate => candidate.g === 2 || candidate.g === 3)) {
    const copy = clone(brick);
    copy.key = `azp:${brick.key}`;
    copy.g = playerGridMap.get(brick.g);
    for (const item of copy.comps) if (item.type === C.AudioEmitter.NAME) {
      const sine = {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'};
      let asset = frame.r.externalAssets().findIndex(entry => JSON.stringify(entry) === JSON.stringify(sine));
      if (asset < 0) asset = frame.r.externalAssets().length;
      item.data.AudioDescriptor = asset;
    }
    frame.bricks.push(copy);
    playerKeyMap.set(brick.key, copy.key);
  }

  const playerRootMap = new Map();
  const rootKeyForNode = node => nodeKey(playerScene, node, 1);
  playerRootMap.set(rootKeyForNode(player.context.buttons.playButton), physical.Play.key);
  playerRootMap.set(rootKeyForNode(player.context.buttons.stopButton), physical.Stop.key);
  for (const [name, node] of Object.entries(player.controls)) {
    const label = {
      speedDown: 'Playback speed down', speedUp: 'Playback speed Up',
      pitchDown: 'Pitch Down', pitchUp: 'Pitch Up', volumeDown: 'Volume down',
      volumeUp: 'Volume Up', timbrePrevious: 'Previous instrument', timbreNext: 'Next instrument',
    }[name];
    playerRootMap.set(rootKeyForNode(node), physical[label].key);
  }
  playerRootMap.set(rootKeyForNode(player.zone), zone.key);
  playerRootMap.set(rootKeyForNode(player.displays.load_status), songDisplay.key);
  playerRootMap.set(rootKeyForNode(player.displays.commit_status), statusDisplay.key);

  const playerByKey = new Map(playerScene.bricks.map(brick => [brick.key, brick]));
  for (const edge of playerScene.edges) {
    const source = playerByKey.get(edge.a);
    const target = playerByKey.get(edge.z);
    const a = source?.g === 1 ? playerRootMap.get(edge.a) : playerKeyMap.get(edge.a);
    const z = target?.g === 1 ? playerRootMap.get(edge.z) : playerKeyMap.get(edge.z);
    if (a && z) frame.edges.push({...edge, a, z});
  }
  for (const link of playerScene.links) if (playerKeyMap.has(link.key)) {
    frame.links.push({key: playerKeyMap.get(link.key), grid: playerGridMap.get(link.grid)});
  }

  const cartridgeKeyMap = new Map();
  for (const brick of cartridgeScene.bricks.filter(candidate => candidate.g === 2)) {
    const copy = clone(brick);
    copy.key = `azc:${brick.key}`;
    copy.g = CARTRIDGE_GRID;
    frame.bricks.push(copy);
    cartridgeKeyMap.set(brick.key, copy.key);
  }
  for (const edge of cartridgeScene.edges) if (cartridgeKeyMap.has(edge.a) && cartridgeKeyMap.has(edge.z)) {
    frame.edges.push({...edge, a: cartridgeKeyMap.get(edge.a), z: cartridgeKeyMap.get(edge.z)});
  }
  const cartridgeLabel = oneBrick(frame,
    brick => brick.g === CARTRIDGE_ENTITY && component(brick, C.TextDisplay.NAME), 'Cartridge title label');
  component(cartridgeLabel, C.TextDisplay.NAME).data.Text = cartridge.context.TITLE;

  // Expose the useful controls and state on the frame's outermost chip. The
  // physical buttons remain directly wired, while positive numeric inputs
  // override their retained defaults.
  const inputs = {
    Play: addIoBrick(frame, 'input', 'azio:input:play', [-60, 30, 2], 'Play (Pulse)', 1, false),
    Stop: addIoBrick(frame, 'input', 'azio:input:stop', [-30, 30, 2], 'Stop (Pulse)', 2, false),
    Pitch: addIoBrick(frame, 'input', 'azio:input:pitch', [0, 30, 2], 'Pitch (0=buttons)', 3, 0),
    Speed: addIoBrick(frame, 'input', 'azio:input:speed', [30, 30, 2], 'Speed (0=buttons)', 4, 0),
    Volume: addIoBrick(frame, 'input', 'azio:input:volume', [60, 30, 2], 'Volume (0=buttons)', 5, 0),
  };
  const outputs = {
    Loaded: addIoBrick(frame, 'output', 'azio:output:loaded', [-45, 60, 2], 'Loaded', 1, false),
    Playing: addIoBrick(frame, 'output', 'azio:output:playing', [-15, 60, 2], 'Playing', 2, false),
    Title: addIoBrick(frame, 'output', 'azio:output:title', [15, 60, 2], 'Song Title', 3, ''),
    Status: addIoBrick(frame, 'output', 'azio:output:status', [45, 60, 2], 'Status', 4, ''),
  };

  const innerInputMap = new Map([
    [player.context.inputs.playInput, inputs.Play],
    [player.context.inputs.stopInput, inputs.Stop],
    [player.context.inputs.pitchInput, inputs.Pitch],
    [player.context.inputs.speedInput, inputs.Speed],
    [player.context.inputs.volumeInput, inputs.Volume],
  ]);
  for (const [node, replacement] of innerInputMap) {
    const old = playerKeyMap.get(nodeKey(playerScene, node, 2));
    for (const edge of frame.edges) if (edge.a === old && edge.p === 'RER_Output') edge.a = replacement;
  }
  const sourceFor = node => playerKeyMap.get(nodeKey(playerScene, node, 2));
  frame.edges.push(
    {a: sourceFor(player.context.loaded), at: C.Var.NAME, p: 'Value', z: outputs.Loaded,
      zt: C.MicrochipOutput.NAME, q: 'RER_Input'},
    {a: sourceFor(player.context.running), at: C.Var.NAME, p: 'Value', z: outputs.Playing,
      zt: C.MicrochipOutput.NAME, q: 'RER_Input'},
    {a: sourceFor(player.context.title), at: C.Var.NAME, p: 'Value', z: outputs.Title,
      zt: C.MicrochipOutput.NAME, q: 'RER_Input'},
    {a: sourceFor(player.statusText[0]), at: player.statusText[0].type, p: player.statusText[1],
      z: outputs.Status, zt: C.MicrochipOutput.NAME, q: 'RER_Input'},
  );

  const assets = clone(frame.r.externalAssets());
  const sineAsset = {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'};
  if (!assets.some(entry => JSON.stringify(entry) === JSON.stringify(sineAsset))) assets.push(sineAsset);

  const v4FunctionEntity = [...playerScene.r.entities()].find(entity => entity.persistentIndex === 3);
  assert(v4FunctionEntity, 'V4 DecodeNote function grid entity');
  frame.extraEntities = [entityClone(v4FunctionEntity, FUNCTION_GRID)];
  frame.extraGridIds = new Set([FUNCTION_GRID]);
  frame.entityOverrides = new Map();
  const entities = [...frame.r.entities()];
  const playerGridEntity = entities.find(entity => entity.persistentIndex === PLAYER_GRID);
  const outerGridEntity = entities.find(entity => entity.persistentIndex === OUTER_GRID);
  const cartridgeGridEntity = entities.find(entity => entity.persistentIndex === CARTRIDGE_GRID);
  const cartridgeEntity = entities.find(entity => entity.persistentIndex === CARTRIDGE_ENTITY);
  const v4GridEntity = [...playerScene.r.entities()].find(entity => entity.persistentIndex === 2);
  const v1GridEntity = [...cartridgeScene.r.entities()].find(entity => entity.persistentIndex === 2);
  assert(playerGridEntity && outerGridEntity && cartridgeGridEntity && cartridgeEntity && v4GridEntity && v1GridEntity);
  frame.entityOverrides.set(PLAYER_GRID, {...entityClone(playerGridEntity), data: clone(v4GridEntity.data)});
  frame.entityOverrides.set(CARTRIDGE_GRID, {...entityClone(cartridgeGridEntity), data: clone(v1GridEntity.data)});
  const expandedOuter = entityClone(outerGridEntity);
  expandedOuter.data.PlaneCenter = {X: 0, Y: 25, Z: 0};
  expandedOuter.data.PlaneExtent = {X: 85, Y: 55, Z: 0};
  frame.entityOverrides.set(OUTER_GRID, expandedOuter);
  const taggedCartridge = entityClone(cartridgeEntity);
  taggedCartridge.data.EntityTag = TAG;
  taggedCartridge.data.bDetectableByAnyone = true;
  taggedCartridge.frozen = false;
  frame.entityOverrides.set(CARTRIDGE_ENTITY, taggedCartridge);

  const playerEntityIds = new Set([OUTER_GRID, PLAYER_GRID, 1392429, FUNCTION_GRID]);
  const playerSceneOut = {...frame,
    r: proxyReader(frame.r, entity => playerEntityIds.has(entity.persistentIndex)),
    bricks: frame.bricks.filter(brick => brick.g !== CARTRIDGE_ENTITY && brick.g !== CARTRIDGE_GRID),
    edges: frame.edges.filter(edge => !String(edge.a).startsWith('azc:') && !String(edge.z).startsWith('azc:')
      && !String(edge.a).startsWith(`[${CARTRIDGE_ENTITY},`) && !String(edge.z).startsWith(`[${CARTRIDGE_ENTITY},`)),
    links: frame.links.filter(link => link.grid !== CARTRIDGE_GRID && !String(link.key).startsWith(`[${CARTRIDGE_ENTITY},`)),
    entityOverrides: new Map([...frame.entityOverrides].filter(([id]) => playerEntityIds.has(id))),
  };
  const playerOut = write(playerSceneOut, {assets,
    name: 'SQM1 Auto-Zone Music Player Frame V1',
    description: 'Supplied music-player frame with proven SQM1 V4 two-voice Sine playback, automatic object-targeted cartridge loading, commit-gated consumption, physical controls, sine-envelope presets and exposed control/status ports.',
  });

  const cartridgeEntityIds = new Set([CARTRIDGE_ENTITY, CARTRIDGE_GRID]);
  const standaloneCartridge = entityClone(taggedCartridge);
  standaloneCartridge.location = {X: 0, Y: 0, Z: 0};
  const cartridgeSceneOut = {...frame,
    r: proxyReader(frame.r, entity => cartridgeEntityIds.has(entity.persistentIndex)),
    bricks: frame.bricks.filter(brick => brick.g === CARTRIDGE_ENTITY || brick.g === CARTRIDGE_GRID),
    edges: frame.edges.filter(edge => String(edge.a).startsWith('azc:') && String(edge.z).startsWith('azc:')),
    links: frame.links.filter(link => link.grid === CARTRIDGE_GRID),
    extraEntities: [], extraGridIds: new Set(),
    entityOverrides: new Map([[CARTRIDGE_ENTITY, standaloneCartridge],
      [CARTRIDGE_GRID, frame.entityOverrides.get(CARTRIDGE_GRID)]]),
  };
  const cartridgeOut = write(cartridgeSceneOut, {assets,
    prefab: metadata({x: 20, y: 20, z: 10}),
    name: 'SQM1 Auto-Offer Test Cartridge V1',
    description: 'Separate tagged dynamic cartridge for the auto-zone player. A targeted request automatically offers the proven 46-Quaternion two-voice test score; a targeted acknowledgment is retained before the player consumes the spawn.',
  });

  return {playerBytes: playerOut.bytes, cartridgeBytes: cartridgeOut.bytes,
    frameFile, player, cartridge, playerScene: read(playerOut.bytes),
    cartridgeScene: read(cartridgeOut.bytes), constants: {TAG, PLAYER_GRID, OUTER_GRID,
      CARTRIDGE_ENTITY, CARTRIDGE_GRID, FUNCTION_GRID}, physical,
    io: {inputs, outputs}, assets};
}

module.exports = build;

if (require.main === module) {
  const [frameFile = FRAME_DEFAULT, playerFile = PLAYER_DEFAULT, cartridgeFile = CARTRIDGE_DEFAULT] = process.argv.slice(2);
  try {
    const context = build(frameFile);
    require('./test-sqm1-auto-zone-frame-integration-v1.cjs')(context);
    fs.mkdirSync(path.dirname(playerFile), {recursive: true});
    fs.mkdirSync(path.dirname(cartridgeFile), {recursive: true});
    fs.writeFileSync(playerFile, context.playerBytes);
    fs.writeFileSync(cartridgeFile, context.cartridgeBytes);
    console.log(JSON.stringify({playerFile, cartridgeFile,
      playerBytes: context.playerBytes.length, cartridgeBytes: context.cartridgeBytes.length,
      playerBricks: context.playerScene.bricks.length,
      cartridgeBricks: context.cartridgeScene.bricks.length}, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
