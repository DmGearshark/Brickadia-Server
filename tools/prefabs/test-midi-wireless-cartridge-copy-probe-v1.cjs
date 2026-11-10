'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testMidiWirelessCartridgeCopyProbeV1(ctx) {
  const scene = read(ctx.bytes);
  const components = scene.bricks.flatMap(brick => brick.comps);
  const placement = validatePlacement(ctx.bytes);

  assert.equal(placement.invalidBricks.length, 0,
    `Invalid probe bricks: ${JSON.stringify(placement.invalidBricks)}`);
  assert.equal(placement.confirmedPairs.length, 0,
    `Confirmed probe overlaps: ${JSON.stringify(placement.confirmedPairs)}`);
  assert.equal(placement.uncertainPairs.length, 0,
    `Uncertain probe overlaps: ${JSON.stringify(placement.uncertainPairs)}`);
  assert.equal(placement.warnings.length, 0,
    `Probe placement warnings: ${JSON.stringify(placement.warnings)}`);
  assert.equal(placement.strictOk, true, 'Probe placement must pass strict validation');

  function component(brick, type) {
    return brick.comps.find(candidate => candidate.type === type);
  }
  function marked(label) {
    const brick = scene.bricks.find(candidate => candidate.comps.some(candidateComponent =>
      candidateComponent.type === C.Interact.NAME
        && candidateComponent.data.Message === `MWCP1:${label}`));
    assert(brick, `Missing retained field ${label}`);
    return brick;
  }
  function uniqueBrick(type, predicate = () => true) {
    const matches = scene.bricks.filter(brick => {
      const candidate = component(brick, type);
      return candidate && predicate(candidate.data, brick);
    });
    assert.equal(matches.length, 1, `Expected one ${type}, found ${matches.length}`);
    return matches[0];
  }
  function edge(sourceBrick, sourceType, sourcePort, targetBrick, targetType, targetPort) {
    return scene.edges.some(candidate => candidate.a === sourceBrick.key
      && candidate.at === sourceType && candidate.p === sourcePort
      && candidate.z === targetBrick.key && candidate.zt === targetType
      && candidate.q === targetPort);
  }

  assert.equal(components.filter(candidate => candidate.type === C.Microchip.NAME).length, 2,
    'Probe needs distinct disk and player microchip assemblies');
  assert.equal(scene.links.length, 2, 'Both physical microchips need linked logic grids');
  assert.equal(new Set(scene.links.map(link => link.grid)).size, 2,
    'Disk and player cannot share one hidden grid');
  assert.equal(components.filter(candidate => candidate.type === C.Button.NAME).length, 2,
    'Probe needs wireless and direct-control buttons');

  const wirelessButton = uniqueBrick(C.Button.NAME,
    data => data.PromptCustomLabel === 'Transmit MIDI cartridge');
  const directButton = uniqueBrick(C.Button.NAME,
    data => data.PromptCustomLabel === 'DIRECT COPY control');
  const sender = uniqueBrick(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === ctx.EVENT_NAME);
  const receiver = uniqueBrick(C.Event_CustomGlobal.NAME,
    data => data.EventName === ctx.EVENT_NAME);
  assert.equal(component(receiver, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, false,
    'Receiver must be a broadcast global event');
  assert.equal(component(receiver, C.Event_CustomGlobal.NAME).data.DataOut3.$variant,
    'BRSavedComponentRef', 'Receiver DataOut3 must preserve component-ref typing');
  assert.equal(scene.edges.some(candidate => candidate.z === sender.key
    && candidate.zt === C.Exec_SendCustomEventGlobal.NAME && candidate.q === 'Target'), false,
  'Broadcast sender Target must remain null/unwired');

  const diskSong = marked('disk.song');
  const wirelessCache = marked('player.cache');
  const directCache = marked('direct.cache');
  assert.deepEqual(component(diskSong, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: ctx.SCORE.map(value => ({...value}))},
    'Disk score changed during serialization');
  assert.deepEqual(component(wirelessCache, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: []}, 'Wireless cache must start empty');
  assert.deepEqual(component(directCache, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: []}, 'Direct-control cache must start empty');
  assert.notEqual(diskSong.g, wirelessCache.g, 'Disk and player arrays must occupy different chips');
  assert.equal(wirelessCache.g, directCache.g, 'Both result caches belong to the player chip');

  const copyBricks = scene.bricks.filter(brick => component(brick, C.Exec_ArrayVar_CopyFrom.NAME));
  assert.equal(copyBricks.length, 2, 'Probe needs wireless and hardwired CopyFrom gates');
  const wirelessCopy = copyBricks.find(brick => edge(receiver, C.Event_CustomGlobal.NAME,
    'DataOut3', brick, C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef'));
  assert(wirelessCopy, 'Receiver DataOut3 must wire directly to wireless CopyFrom.SourceRef');
  assert(edge(wirelessCache, C.ArrayVar.NAME, 'ArrayVarRef', wirelessCopy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef'),
  'Wireless CopyFrom must target the player-owned cache');

  const directCopy = copyBricks.find(brick => edge(diskSong, C.ArrayVar.NAME,
    'ArrayVarRef', brick, C.Exec_ArrayVar_CopyFrom.NAME, 'SourceRef'));
  assert(directCopy, 'Hardwired control must connect disk ArrayVarRef to CopyFrom.SourceRef');
  assert(edge(directCache, C.ArrayVar.NAME, 'ArrayVarRef', directCopy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'ArrayVarRef'),
  'Hardwired CopyFrom must target its independent player-owned cache');
  assert.notEqual(diskSong.g, directCopy.g,
    'Direct control must actually test a remote cross-chip ArrayVarRef wire');

  assert(edge(diskSong, C.ArrayVar.NAME, 'ArrayVarRef', sender,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'),
  'Disk ArrayVarRef must occupy global event DataIn3');
  const senderData = component(sender, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(senderData.DataIn1.value, ctx.PROTOCOL_MAGIC);
  assert.equal(senderData.DataIn2.value, ctx.CHANNEL);
  assert.equal(senderData.DataIn4.value, ctx.TITLE);
  assert.equal(senderData.DataIn5.value, ctx.SCORE.length);

  const wirelessEdge = uniqueBrick(C.Expr_EdgeDetectorExec.NAME,
    (_data, brick) => edge(wirelessButton, C.Button.NAME, 'bHeld', brick,
      C.Expr_EdgeDetectorExec.NAME, 'Input'));
  const directEdge = uniqueBrick(C.Expr_EdgeDetectorExec.NAME,
    (_data, brick) => edge(directButton, C.Button.NAME, 'bHeld', brick,
      C.Expr_EdgeDetectorExec.NAME, 'Input'));
  assert(edge(wirelessEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', sender,
    C.Exec_SendCustomEventGlobal.NAME, 'ExecIn'),
  'Wireless physical button path must visibly reach the sender');
  assert(edge(directEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', directCopy,
    C.Exec_ArrayVar_CopyFrom.NAME, 'Exec'),
  'Direct physical button path must visibly reach the control CopyFrom');

  const compareEqualCount = components.filter(candidate =>
    candidate.type === C.Expr_CompareEqual.NAME).length;
  assert(compareEqualCount >= 3 + 1 + 5 * 4 + 1 + 3 * 4,
    'Envelope, length and selected Quaternion fields need explicit checks');
  assert(components.filter(candidate => candidate.type === C.Exec_ArrayVar_GetLength.NAME).length >= 2,
    'Both caches need length verification');
  assert(components.filter(candidate => candidate.type === C.Exec_ArrayVar_Get.NAME).length >= 8,
    'Selected header/note records must be read from both caches');

  const labels = components
    .filter(candidate => candidate.type === C.Interact.NAME
      && candidate.data.Message?.startsWith('MWCP1:'))
    .map(candidate => candidate.data.Message);
  assert.equal(new Set(labels).size, labels.length, 'Retained-result labels must be unique');
  for (const record of ctx.records) {
    const brick = marked(record.label);
    const savedComponent = component(brick, C[record.key].NAME);
    assert(savedComponent, `Missing native component for ${record.label}`);
    assert.deepEqual(savedComponent.data, record.node.data,
      `Retained field ${record.label} changed during serialization`);
  }

  const refVars = components.filter(candidate => candidate.type === C.Var.NAME
    && candidate.data.Value?.$variant === 'BRSavedComponentRef');
  assert.equal(refVars.length, 0,
    'Probe cannot latch a component reference in a Var across ticks');

  const sourceRefEdges = scene.edges.filter(candidate => candidate.q === 'SourceRef');
  assert.equal(sourceRefEdges.length, 2, 'Only wireless and direct CopyFrom sources are expected');
  assert(sourceRefEdges.every(candidate => candidate.p === 'DataOut3'
    || candidate.p === 'ArrayVarRef'), 'CopyFrom source must be direct event data or direct array ref');
  for (const candidate of scene.edges.filter(candidate => candidate.q === 'VarRef')) {
    const source = scene.bricks.find(brick => brick.key === candidate.a);
    const target = scene.bricks.find(brick => brick.key === candidate.z);
    assert.equal(source.g, target.g, 'Ordinary VarRef crossed a chip boundary');
  }

  const targets = new Set();
  for (const candidate of scene.edges) {
    const source = scene.bricks.find(brick => brick.key === candidate.a);
    const target = scene.bricks.find(brick => brick.key === candidate.z);
    assert(source?.comps.some(sourceComponent => sourceComponent.type === candidate.at),
      `Missing source component for ${candidate.at}.${candidate.p}`);
    assert(target?.comps.some(targetComponent => targetComponent.type === candidate.zt),
      `Missing target component for ${candidate.zt}.${candidate.q}`);
    const targetKey = `${candidate.z}|${candidate.zt}|${candidate.q}`;
    assert(!targets.has(targetKey), `Duplicate input wire ${targetKey}`);
    targets.add(targetKey);
    const sourceDefinition = Object.values(C).find(definition => definition.NAME === candidate.at);
    const targetDefinition = Object.values(C).find(definition => definition.NAME === candidate.zt);
    assert(Object.values(sourceDefinition.PORTS).includes(candidate.p),
      `Unknown source port ${candidate.at}.${candidate.p}`);
    assert(Object.values(targetDefinition.PORTS).includes(candidate.q),
      `Unknown target port ${candidate.zt}.${candidate.q}`);
  }
  assert.equal(scene.edges.length, ctx.b.edges.length, 'Serialized wire count changed');

  const displays = scene.bricks.filter(brick => component(brick, C.TextDisplay.NAME));
  assert.equal(displays.length, 3, 'Probe needs instructions plus two independent live readouts');
  assert.equal(scene.edges.filter(candidate => candidate.zt === C.TextDisplay.NAME
    && candidate.q === 'Text').length, 2, 'Both result panels must be live-wired');

  console.log('MIDI wireless cartridge probe serialization checks passed: two linked chips, '
    + 'two visibly wired controls, broadcast envelope/filter, direct event-to-CopyFrom ref, '
    + 'hardwired cross-chip control, independent caches, retained exact checks, all endpoints, '
    + 'and strict zero-warning placement. Live ref transport remains intentionally unproven.');
};
