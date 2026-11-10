'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const {Build, C, R, N, B, S} = require('./loadboard-lib.cjs');

const FONT = [{type: 'BrickFontDescriptor', name: 'GlacialIndifferencePlus'}];
const PREFIX = 'MWCP1';
const EVENT_NAME = 'MIDI.Cartridge.Offer.V1';
const PROTOCOL_MAGIC = 7701001;
const CHANNEL = 1;
const TITLE = 'Wireless probe: two-note sine score';
const HEADER_QUATS = 34;

const Q = value => ({$variant: 'Quat', value: {...value}});
const NULL_COMPONENT_REF = Object.freeze({
  Brick: Object.freeze({
    GridPersistentIndex: 0,
    ChunkIndex: Object.freeze({X: 0, Y: 0, Z: 0}),
    BrickIndexInChunk: 4294967295,
  }),
  ComponentTypeIndex: 0,
});
const CR = value => ({$variant: 'BRSavedComponentRef', value: structuredClone(value)});

function makeScore() {
  const values = [
    {X: PROTOCOL_MAGIC, Y: 1, Z: 1, W: 2},
    {X: HEADER_QUATS, Y: 0.125, Z: 60, W: 64},
    {X: HEADER_QUATS, Y: 2, Z: 0, W: 0},
  ];
  while (values.length < HEADER_QUATS) values.push({X: 36, Y: 0, Z: -1, W: -1});
  values.push(
    {X: 0, Y: 0.75, Z: 60, W: 100},
    {X: 0.875, Y: 1.5, Z: 64, W: 80},
  );
  assert.equal(values.length, 36);
  return Object.freeze(values.map(value => Object.freeze(value)));
}

const SCORE = makeScore();
const OBSERVED_INDICES = Object.freeze([0, 1, 2, 34, 35]);

function wireValue(value) {
  if (typeof value === 'boolean') return B(value);
  if (typeof value === 'string') return S(value);
  if (typeof value === 'number') return N(value);
  return value;
}

module.exports = function buildMidiWirelessCartridgeCopyProbeV1() {
  const b = new Build('MIDI Wireless Cartridge Copy Probe V1', FONT);
  const diskShell = b.w.addMicrochip({position: [-48, -120, 4], color: [40, 150, 95]});
  const playerShell = b.w.addMicrochip({position: [48, -120, 4], color: [55, 115, 205]});
  const disk = b.circuit(diskShell.grid, 'disk');
  const player = b.circuit(playerShell.grid, 'player');
  const records = [];

  function marked(circuit, label, key, data, color) {
    const definition = C[key];
    const i = circuit.i++;
    // Match Circuit.n's allocator exactly. Mixing allocators previously caused
    // hidden gate collisions in an engine probe.
    const position = [(i % 16) * 48, Math.floor(i / 16) * 48, 2];
    const node = {
      id: `${circuit.prefix}_marked_${label}`,
      type: definition.NAME,
      pos: position,
      grid: circuit.grid,
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
    }, circuit.grid);
    records.push({label, node, key});
    return node;
  }

  const saved = (circuit, label, value) =>
    marked(circuit, label, 'Var', {Value: wireValue(value)}, [205, 145, 45]);
  const savedArray = (circuit, label, values) => marked(circuit, label, 'ArrayVar', {
    Value: {$elementType: 'Quat', $array: values.map(value => ({...value}))},
  }, [80, 170, 115]);

  function addDisplay(id, position, size, text, color = [225, 235, 245]) {
    const node = {
      id,
      type: C.TextDisplay.NAME,
      pos: position,
      grid: undefined,
      data: {
        Text: typeof text === 'string' ? text : 'Waiting for transmission',
        Font: 0,
        Face: 0,
        LineHeight: 1.15,
        WidthScale: 0.78,
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
    if (Array.isArray(text)) player.bind(node, 'Text', text);
    return node;
  }

  const diskSong = savedArray(disk, 'disk.song', SCORE);
  const diskSent = saved(disk, 'disk.sent', 0);

  const button = {
    id: 'transmit_button',
    type: C.Button.NAME,
    pos: [-96, -120, 4],
    grid: undefined,
    data: {
      PromptCustomLabel: 'Transmit MIDI cartridge',
      bAllowNearbyInteraction: true,
      bHiddenInteraction: false,
    },
  };
  b.add(button, {
    asset: C.Button.BRICK,
    position: button.pos,
    direction: 4,
    rotation: 2,
    color: [35, 205, 95],
    components: [{type: button.type, data: button.data}],
  });

  const directButton = {
    id: 'direct_copy_button',
    type: C.Button.NAME,
    pos: [96, -120, 4],
    grid: undefined,
    data: {
      PromptCustomLabel: 'DIRECT COPY control',
      bAllowNearbyInteraction: true,
      bHiddenInteraction: false,
    },
  };
  b.add(directButton, {
    asset: C.Button.BRICK,
    position: directButton.pos,
    direction: 4,
    rotation: 2,
    color: [235, 155, 40],
    components: [{type: directButton.type, data: directButton.data}],
  });

  // This is a deliberately visible physical Button -> wire -> edge path.
  const transmitEdge = disk.edge(R(button, 'bHeld'));
  const send = disk.send(EVENT_NAME, [
    N(PROTOCOL_MAGIC),
    N(CHANNEL),
    R(diskSong, 'ArrayVarRef'),
    S(TITLE),
    N(SCORE.length),
  ]);
  disk.link(transmitEdge, send, 'OnRisingEdge', 'ExecIn');
  const countSent = disk.n('Exec_Var_Increment', {VarRef: R(diskSent, 'VarRef'), Value: N(1)});
  disk.link(send, countSent);

  const cache = savedArray(player, 'player.cache', []);
  const received = saved(player, 'player.received', 0);
  const accepted = saved(player, 'player.accepted', 0);
  const rejected = saved(player, 'player.rejected', 0);
  const copyCompleted = saved(player, 'player.copy.completed', 0);
  const seenMagic = saved(player, 'player.seen.magic', -1);
  const seenChannel = saved(player, 'player.seen.channel', -1);
  const seenTitle = saved(player, 'player.seen.title', '');
  const seenDeclaredLength = saved(player, 'player.seen.declaredLength', -1);
  const observedLength = saved(player, 'player.observed.length', -1);
  const passed = saved(player, 'player.passed', false);
  const observed = new Map();
  const outOfBounds = new Map();
  for (const index of OBSERVED_INDICES) {
    observed.set(index, saved(player, `player.observed.q${index}`, Q({X: -1, Y: -1, Z: -1, W: -1})));
    outOfBounds.set(index, saved(player, `player.observed.q${index}.outOfBounds`, true));
  }
  const checks = {
    length: saved(player, 'player.check.length', false),
    q0: saved(player, 'player.check.q0', false),
    q1: saved(player, 'player.check.q1', false),
    q2: saved(player, 'player.check.q2', false),
    q34: saved(player, 'player.check.q34', false),
    q35: saved(player, 'player.check.q35', false),
  };

  // DataOut3 is typed as a component reference by its null default. It is
  // consumed synchronously by CopyFrom.SourceRef; no delayed ref latch exists.
  const offer = player.event(EVENT_NAME, [
    N(0), N(0), CR(NULL_COMPONENT_REF), S(''), N(0),
  ], false);
  const countReceived = player.n('Exec_Var_Increment', {VarRef: R(received, 'VarRef'), Value: N(1)});
  player.link(offer, countReceived);
  const saveMagic = player.set(seenMagic, R(offer, 'DataOut1'));
  const saveChannel = player.set(seenChannel, R(offer, 'DataOut2'));
  const saveTitle = player.set(seenTitle, R(offer, 'DataOut4'));
  const saveDeclaredLength = player.set(seenDeclaredLength, R(offer, 'DataOut5'));
  player.link(countReceived, saveMagic);
  player.link(saveMagic, saveChannel);
  player.link(saveChannel, saveTitle);
  player.link(saveTitle, saveDeclaredLength);

  const correctProtocol = player.cmp('Equal', R(offer, 'DataOut1'), N(PROTOCOL_MAGIC));
  const correctChannel = player.cmp('Equal', R(offer, 'DataOut2'), N(CHANNEL));
  const correctDeclaredLength = player.cmp('Equal', R(offer, 'DataOut5'), N(SCORE.length));
  const envelopeAccepted = player.and(correctProtocol, correctChannel, correctDeclaredLength);
  const filter = player.branch(saveDeclaredLength, envelopeAccepted);
  const countAccepted = player.n('Exec_Var_Increment', {VarRef: R(accepted, 'VarRef'), Value: N(1)});
  const countRejected = player.n('Exec_Var_Increment', {VarRef: R(rejected, 'VarRef'), Value: N(1)});
  player.link(filter, countAccepted, 'ExecOutA');
  player.link(filter, countRejected, 'ExecOutB');

  const copy = player.n('Exec_ArrayVar_CopyFrom', {
    ArrayVarRef: R(cache, 'ArrayVarRef'),
    SourceRef: R(offer, 'DataOut3'),
  });
  player.link(countAccepted, copy);
  const countCopied = player.n('Exec_Var_Increment', {
    VarRef: R(copyCompleted, 'VarRef'), Value: N(1),
  });
  player.link(copy, countCopied);

  // Only the local snapshot crosses a tick boundary. Query delays make the
  // retained result independent of reactive-output publication timing.
  const afterCopy = player.wait(countCopied, 1);
  const getLength = player.ao('GetLength', cache);
  player.link(afterCopy, getLength, 'Output');
  const lengthReady = player.wait(getLength, 1);
  const saveLength = player.set(observedLength, R(getLength, 'Length'));
  player.link(lengthReady, saveLength, 'Output');

  let tail = saveLength;
  for (const index of OBSERVED_INDICES) {
    const get = player.ao('Get', cache, {Index: index});
    player.link(tail, get);
    const ready = player.wait(get, 1);
    const saveValue = player.set(observed.get(index), R(get, 'Value'));
    player.link(ready, saveValue, 'Output');
    const saveBounds = player.set(outOfBounds.get(index), R(get, 'bOutOfBounds'));
    player.link(saveValue, saveBounds);
    tail = saveBounds;
  }

  const checkSignals = [];
  const lengthEqual = player.cmp('Equal', R(observedLength), N(SCORE.length));
  checkSignals.push(lengthEqual);
  const checkLength = player.set(checks.length, lengthEqual);
  const verifyDelay = player.wait(tail, 1);
  player.link(verifyDelay, checkLength, 'Output');
  tail = checkLength;

  for (const index of OBSERVED_INDICES) {
    const actual = observed.get(index);
    const split = player.n('Expr_SplitQuaternion', {Input: R(actual)});
    const expected = SCORE[index];
    const componentSignals = ['X', 'Y', 'Z', 'W'].map(component =>
      player.cmp('Equal', R(split, component), N(expected[component])));
    const inBounds = player.not(R(outOfBounds.get(index)));
    const matches = player.and(...componentSignals, inBounds);
    checkSignals.push(matches);
    const saveCheck = player.set(checks[`q${index}`], matches);
    player.link(tail, saveCheck);
    tail = saveCheck;
  }
  const allPassed = player.and(...checkSignals);
  const savePassed = player.set(passed, allPassed);
  player.link(tail, savePassed);

  // A hardwired control separates ArrayVar_CopyFrom/cross-chip reference
  // support from global-event reference transport. It intentionally uses one
  // direct disk ArrayVarRef -> player CopyFrom.SourceRef remote wire and no
  // intermediate reference variable.
  const directIndices = Object.freeze([0, 34, 35]);
  const directCache = savedArray(player, 'direct.cache', []);
  const directCopyCompleted = saved(player, 'direct.copy.completed', 0);
  const directObservedLength = saved(player, 'direct.observed.length', -1);
  const directPassed = saved(player, 'direct.passed', false);
  const directObserved = new Map();
  const directOutOfBounds = new Map();
  const directChecks = {length: saved(player, 'direct.check.length', false)};
  for (const index of directIndices) {
    directObserved.set(index,
      saved(player, `direct.observed.q${index}`, Q({X: -1, Y: -1, Z: -1, W: -1})));
    directOutOfBounds.set(index,
      saved(player, `direct.observed.q${index}.outOfBounds`, true));
    directChecks[`q${index}`] = saved(player, `direct.check.q${index}`, false);
  }

  const directEdge = player.edge(R(directButton, 'bHeld'));
  const directCopy = player.n('Exec_ArrayVar_CopyFrom', {
    ArrayVarRef: R(directCache, 'ArrayVarRef'),
    SourceRef: R(diskSong, 'ArrayVarRef'),
  });
  player.link(directEdge, directCopy, 'OnRisingEdge');
  const countDirectCopy = player.n('Exec_Var_Increment', {
    VarRef: R(directCopyCompleted, 'VarRef'), Value: N(1),
  });
  player.link(directCopy, countDirectCopy);
  const directAfterCopy = player.wait(countDirectCopy, 1);
  const directGetLength = player.ao('GetLength', directCache);
  player.link(directAfterCopy, directGetLength, 'Output');
  const directLengthReady = player.wait(directGetLength, 1);
  const saveDirectLength = player.set(directObservedLength, R(directGetLength, 'Length'));
  player.link(directLengthReady, saveDirectLength, 'Output');

  let directTail = saveDirectLength;
  for (const index of directIndices) {
    const get = player.ao('Get', directCache, {Index: index});
    player.link(directTail, get);
    const ready = player.wait(get, 1);
    const saveValue = player.set(directObserved.get(index), R(get, 'Value'));
    player.link(ready, saveValue, 'Output');
    const saveBounds = player.set(directOutOfBounds.get(index), R(get, 'bOutOfBounds'));
    player.link(saveValue, saveBounds);
    directTail = saveBounds;
  }

  const directSignals = [];
  const directLengthEqual = player.cmp('Equal', R(directObservedLength), N(SCORE.length));
  directSignals.push(directLengthEqual);
  const saveDirectLengthCheck = player.set(directChecks.length, directLengthEqual);
  const directVerifyDelay = player.wait(directTail, 1);
  player.link(directVerifyDelay, saveDirectLengthCheck, 'Output');
  directTail = saveDirectLengthCheck;
  for (const index of directIndices) {
    const split = player.n('Expr_SplitQuaternion', {Input: R(directObserved.get(index))});
    const expected = SCORE[index];
    const components = ['X', 'Y', 'Z', 'W'].map(component =>
      player.cmp('Equal', R(split, component), N(expected[component])));
    const inBounds = player.not(R(directOutOfBounds.get(index)));
    const matches = player.and(...components, inBounds);
    directSignals.push(matches);
    const saveCheck = player.set(directChecks[`q${index}`], matches);
    player.link(directTail, saveCheck);
    directTail = saveCheck;
  }
  const directAllPassed = player.and(...directSignals);
  const saveDirectPassed = player.set(directPassed, directAllPassed);
  player.link(directTail, saveDirectPassed);

  addDisplay('instructions', [0, 0, 92], [1, 140, 16],
    'MIDI WIRELESS CARTRIDGE COPY PROBE V1\r\n'
      + 'ORANGE DIRECT first; then GREEN WIRELESS. Wait 3 seconds after each.\r\n'
      + 'Export this WHOLE assembly with both chips and both buttons.',
    [115, 225, 255]);
  const wirelessStatusText = player.fmt(
    'WIRELESS STATUS\r\nReceived {A} | Accepted {B} | Rejected {C}\r\nCopies {D} | Length {E}/36 | Passed {F}\r\nTitle: {G}',
    R(received), R(accepted), R(rejected), R(copyCompleted), R(observedLength), R(passed), R(seenTitle));
  const status = addDisplay('wireless_status', [0, 0, 50], [1, 140, 18],
    wirelessStatusText, [255, 225, 125]);
  const directStatusText = player.fmt(
    'DIRECT CONTROL | Copies {A} | Length {B}/36 | Passed {C}',
    R(directCopyCompleted), R(directObservedLength), R(directPassed));
  const directStatus = addDisplay('direct_status', [0, 0, 16], [1, 140, 12],
    directStatusText, [255, 185, 85]);

  const bytes = b.finish(
    {x: 155, y: 145, z: 115},
    'Live-engine probe for a MIDI cartridge ArrayVarRef broadcast. A green disk chip sends a '
      + 'Quat ArrayVar reference through a global event; a blue player filters the envelope, '
      + 'copies synchronously into its own array, and retains exact header/note checks. An '
      + 'orange hardwired CopyFrom control isolates global-event transport from copy support.',
  );

  return {
    bytes, b, disk, player, records, diskShell, playerShell, diskSong, diskSent,
    button, directButton, transmitEdge, directEdge, send, offer, cache, received, accepted, rejected,
    copyCompleted, seenMagic, seenChannel, seenTitle, seenDeclaredLength,
    observedLength, observed, outOfBounds, checks, passed, copy, getLength,
    directCache, directCopyCompleted, directObservedLength, directPassed,
    directObserved, directOutOfBounds, directChecks, directCopy, directGetLength,
    directIndices, status, directStatus, SCORE, OBSERVED_INDICES,
    EVENT_NAME, PROTOCOL_MAGIC, CHANNEL, TITLE,
  };
};

if (require.main === module) {
  const output = process.argv[2];
  assert(output,
    'Usage: node build-midi-wireless-cartridge-copy-probe-v1.cjs <output.brz>');
  try {
    const context = module.exports();
    require('./test-midi-wireless-cartridge-copy-probe-v1.cjs')(context);
    fs.writeFileSync(output, context.bytes);
    console.log(JSON.stringify({
      output,
      components: context.b.nodes.length,
      wires: context.b.edges.length,
      scoreQuaternions: context.SCORE.length,
      recordedFields: context.records.length,
    }, null, 2));
  } catch (error) {
    console.error(String(error.message).slice(0, 2500));
    console.error(String(error.stack).split('\n')
      .filter(line => line.includes('/tools/prefabs/') && !line.includes('/node_modules/')).join('\n'));
    process.exitCode = 1;
  }
}
