'use strict';

const assert = require('assert/strict');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

module.exports = function testMidiWirelessIntegrationCartridgeV1(ctx) {
  const scene = read(ctx.bytes);
  const components = scene.bricks.flatMap(brick => brick.comps);
  const placement = validatePlacement(ctx.bytes);
  assert.equal(placement.invalidBricks.length, 0);
  assert.equal(placement.confirmedPairs.length, 0);
  assert.equal(placement.uncertainPairs.length, 0);
  assert.equal(placement.warnings.length, 0);
  assert.equal(placement.strictOk, true, 'Cartridge must pass strict placement');

  const component = (brick, type) => brick.comps.find(item => item.type === type);
  const bricksOf = type => scene.bricks.filter(brick => component(brick, type));
  const edge = (source, sourceType, sourcePort, target, targetType, targetPort) =>
    scene.edges.some(candidate => candidate.a === source.key && candidate.at === sourceType
      && candidate.p === sourcePort && candidate.z === target.key
      && candidate.zt === targetType && candidate.q === targetPort);
  const marked = label => {
    const brick = scene.bricks.find(candidate => candidate.comps.some(item =>
      item.type === C.Interact.NAME && item.data.Message === `MWIC1:${label}`));
    assert(brick, `Missing marked cartridge field ${label}`);
    return brick;
  };
  const unique = (type, predicate = () => true) => {
    const matches = scene.bricks.filter(brick => {
      const item = component(brick, type);
      return item && predicate(item.data, brick);
    });
    assert.equal(matches.length, 1, `Expected one ${type}, found ${matches.length}`);
    return matches[0];
  };

  assert.equal(bricksOf(C.Microchip.NAME).length, 1);
  assert.equal(scene.links.length, 1, 'Cartridge shell must retain one linked logic grid');
  assert.equal(bricksOf(C.ArrayVar.NAME).length, 1, 'Cartridge must contain exactly one score array');
  const score = marked('score');
  assert.deepEqual(component(score, C.ArrayVar.NAME).data.Value,
    {$elementType: 'Quat', $array: ctx.SCORE.map(value => ({...value}))});
  assert.equal(ctx.SCORE.length, 46);
  assert.deepEqual(ctx.SCORE[0], {X: 7701001, Y: 1, Z: 2, W: 8});
  assert.deepEqual(ctx.SCORE[1], {X: 34, Y: 0.15, Z: 48, W: 72});
  assert.deepEqual(ctx.SCORE[2], {X: 34, Y: 8, Z: 0, W: 0});
  assert.deepEqual(ctx.SCORE[3], {X: 42, Y: 4, Z: 40, W: 16});
  assert(ctx.SCORE.slice(4, 34).every(value =>
    value.X === 46 && value.Y === 0 && value.Z === -1 && value.W === -1));

  const request = unique(C.Event_CustomGlobal.NAME,
    data => data.EventName === ctx.REQUEST_EVENT);
  const ack = unique(C.Event_CustomGlobal.NAME, data => data.EventName === ctx.ACK_EVENT);
  const offer = unique(C.Exec_SendCustomEventGlobal.NAME,
    data => data.EventName === ctx.OFFER_EVENT);
  assert.equal(component(request, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, false);
  assert.equal(component(ack, C.Event_CustomGlobal.NAME).data.bIsObjectEvent, false);
  assert.equal(scene.edges.some(candidate => candidate.z === offer.key
    && candidate.zt === C.Exec_SendCustomEventGlobal.NAME && candidate.q === 'Target'), false,
  'Offer must be a broadcast');
  const offerData = component(offer, C.Exec_SendCustomEventGlobal.NAME).data;
  assert.equal(offerData.DataIn1.value, ctx.TRANSPORT_MAGIC);
  assert.equal(offerData.DataIn2.value, ctx.CHANNEL);
  assert.equal(offerData.DataIn6.value, ctx.TITLE);
  assert.equal(offerData.DataIn7.value, ctx.PREFERRED_MODE);
  assert.equal(offerData.DataIn8.value, ctx.SCORE_FORMAT);
  assert(edge(score, C.ArrayVar.NAME, 'ArrayVarRef', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn3'),
  'Offer Data3 must carry the live score ArrayVarRef');

  const nonce = marked('state.request.nonce');
  assert(edge(nonce, C.Var.NAME, 'Value', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn4'),
  'Offer Data4 must echo the retained request nonce');
  const getLength = unique(C.Exec_ArrayVar_GetLength.NAME);
  assert(edge(score, C.ArrayVar.NAME, 'ArrayVarRef', getLength,
    C.Exec_ArrayVar_GetLength.NAME, 'ArrayVarRef'));
  assert(edge(getLength, C.Exec_ArrayVar_GetLength.NAME, 'Length', offer,
    C.Exec_SendCustomEventGlobal.NAME, 'DataIn5'));

  const button = unique(C.Button.NAME,
    data => data.PromptCustomLabel === 'Send SQM1 test song');
  const sendEdge = unique(C.Expr_EdgeDetectorExec.NAME,
    (_data, brick) => edge(button, C.Button.NAME, 'bHeld', brick,
      C.Expr_EdgeDetectorExec.NAME, 'Input'));
  const sendBranch = scene.bricks.find(brick => component(brick, C.Exec_Branch.NAME)
    && edge(sendEdge, C.Expr_EdgeDetectorExec.NAME, 'OnRisingEdge', brick,
      C.Exec_Branch.NAME, 'Exec'));
  assert(sendBranch, 'Visible send button must reach the send eligibility branch');
  assert(scene.edges.some(candidate => candidate.a === sendBranch.key
    && candidate.at === C.Exec_Branch.NAME && candidate.p === 'ExecOutA'
    && candidate.z === getLength.key), 'Eligible send path must query exact score length');
  assert(scene.edges.some(candidate => candidate.z === offer.key
    && candidate.zt === C.Exec_SendCustomEventGlobal.NAME && candidate.q === 'ExecIn'),
  'Eligible send path must execute the offer sender');

  const requestDefaults = component(request, C.Event_CustomGlobal.NAME).data;
  for (let index = 1; index <= 8; index++) {
    assert.equal(requestDefaults[`DataOut${index}`].$variant, 'f64');
  }
  const ackDefaults = component(ack, C.Event_CustomGlobal.NAME).data;
  assert.equal(ackDefaults.DataOut6.$variant, 'str');
  for (const index of [1, 2, 3, 4, 5, 7, 8]) {
    assert.equal(ackDefaults[`DataOut${index}`].$variant, 'f64');
  }

  const labels = components.filter(item => item.type === C.Interact.NAME
    && item.data.Message?.startsWith('MWIC1:')).map(item => item.data.Message);
  assert.equal(new Set(labels).size, labels.length, 'Cartridge marker labels must be unique');
  for (const record of ctx.records) {
    const brick = marked(record.label);
    assert.deepEqual(component(brick, C[record.key].NAME).data, record.node.data,
      `Marked field ${record.label} changed during serialization`);
  }
  for (const required of [
    'state.request.received', 'state.request.accepted', 'state.request.rejected',
    'state.request.valid', 'state.request.nonce', 'state.request.seen.magic',
    'state.request.seen.channel', 'state.request.seen.capabilities',
    'state.offer.sent', 'state.offer.blocked', 'state.ack.awaiting',
    'state.ack.received', 'state.ack.accepted', 'state.ack.rejected',
    'state.ack.nonce', 'state.ack.result', 'state.ack.copiedLength',
    'state.ack.status', 'state.ack.mode',
  ]) marked(required);

  const textDisplays = bricksOf(C.TextDisplay.NAME);
  assert.equal(textDisplays.length, 3, 'Instructions plus two live status panels are required');
  assert.equal(scene.edges.filter(candidate => candidate.zt === C.TextDisplay.NAME
    && candidate.q === 'Text').length, 2, 'Both status panels must remain live wired');

  const targets = new Set();
  for (const candidate of scene.edges) {
    const source = scene.bricks.find(brick => brick.key === candidate.a);
    const target = scene.bricks.find(brick => brick.key === candidate.z);
    assert(source?.comps.some(item => item.type === candidate.at));
    assert(target?.comps.some(item => item.type === candidate.zt));
    const targetKey = `${candidate.z}|${candidate.zt}|${candidate.q}`;
    assert(!targets.has(targetKey), `Duplicate input wire ${targetKey}`);
    targets.add(targetKey);
    const sourceDefinition = Object.values(C).find(item => item.NAME === candidate.at);
    const targetDefinition = Object.values(C).find(item => item.NAME === candidate.zt);
    assert(Object.values(sourceDefinition.PORTS).includes(candidate.p));
    assert(Object.values(targetDefinition.PORTS).includes(candidate.q));
  }
  assert.equal(scene.edges.length, ctx.b.edges.length);
  console.log('MIDI wireless integration cartridge checks passed: exact 46-Quat score, '
    + 'production SQM1 request/offer/ack slots, direct ArrayVarRef offer, retained diagnostics, '
    + 'visible send control, live panels, all endpoints and strict zero-warning placement.');
};
