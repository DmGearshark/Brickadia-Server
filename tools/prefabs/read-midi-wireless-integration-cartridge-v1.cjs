'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');
const expected = require('./build-midi-wireless-integration-cartridge-v1.cjs').SCORE;

const file = process.argv[2];
if (!file) {
  throw new Error('Usage: node read-midi-wireless-integration-cartridge-v1.cjs <returned.brz>');
}

const bytes = fs.readFileSync(file);
const scene = read(bytes);
const PREFIX = 'MWIC1:';
const values = {};
let score = null;
const buttons = [];
const warnings = [];

function unwrap(value) {
  return value && typeof value === 'object' && '$variant' in value ? value.value : value;
}

for (const brick of scene.bricks) {
  const marker = brick.comps.find(component => component.type === C.Interact.NAME
    && component.data.Message?.startsWith(PREFIX));
  if (!marker) continue;
  const label = marker.data.Message.slice(PREFIX.length);
  const variable = brick.comps.find(component => component.type === C.Var.NAME);
  const array = brick.comps.find(component => component.type === C.ArrayVar.NAME);
  const button = brick.comps.find(component => component.type === C.Button.NAME);
  if (variable) values[label] = unwrap(variable.data.Value);
  else if (array && label === 'score') score = array.data.Value;
  else if (button) buttons.push(button.data.PromptCustomLabel);
  else warnings.push(`Marker ${label} has no retained state component`);
}

const tolerance = 1e-7;
const sameNumber = (a, b) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= tolerance;
const sameQuat = (a, b) => a && b && ['X', 'Y', 'Z', 'W']
  .every(field => sameNumber(a[field], b[field]));
const scoreExact = score?.$elementType === 'Quat' && Array.isArray(score.$array)
  && score.$array.length === expected.length
  && score.$array.every((value, index) => sameQuat(value, expected[index]));

const request = {
  received: Number(values['state.request.received'] ?? 0),
  accepted: Number(values['state.request.accepted'] ?? 0),
  rejected: Number(values['state.request.rejected'] ?? 0),
  valid: values['state.request.valid'],
  nonce: values['state.request.nonce'],
  mode: values['state.request.mode'],
  seen: {
    magic: values['state.request.seen.magic'],
    channel: values['state.request.seen.channel'],
    nonce: values['state.request.seen.nonce'],
    mode: values['state.request.seen.mode'],
    maxVoices: values['state.request.seen.maxVoices'],
    capacity: values['state.request.seen.capacity'],
    format: values['state.request.seen.format'],
    capabilities: values['state.request.seen.capabilities'],
  },
};
const offer = {
  sent: Number(values['state.offer.sent'] ?? 0),
  blocked: Number(values['state.offer.blocked'] ?? 0),
};
const ack = {
  awaiting: values['state.ack.awaiting'],
  received: Number(values['state.ack.received'] ?? 0),
  accepted: Number(values['state.ack.accepted'] ?? 0),
  rejected: Number(values['state.ack.rejected'] ?? 0),
  nonce: values['state.ack.nonce'],
  result: values['state.ack.result'],
  copiedLength: values['state.ack.copiedLength'],
  status: values['state.ack.status'],
  mode: values['state.ack.mode'],
};
const requestExact = request.received >= 1 && request.accepted >= 1 && request.rejected === 0
  && request.seen.magic === 7702001 && request.seen.channel === 1
  && request.seen.nonce === request.nonce && request.seen.mode === 0
  && request.seen.maxVoices >= 2 && request.seen.capacity >= expected.length
  && request.seen.format === 1 && request.seen.capabilities >= 1;
const ackExact = ack.received >= 1 && ack.accepted >= 1 && ack.rejected === 0
  && ack.awaiting === false && ack.nonce === request.nonce && ack.result === 1
  && ack.copiedLength === expected.length && ack.mode === 0;
const passed = scoreExact && requestExact && offer.sent >= 1 && offer.blocked === 0 && ackExact;

let interpretation;
if (passed) {
  interpretation = 'PASS: cartridge accepted a compatible SQM1 request, offered its exact score reference, and retained the player success acknowledgment for all 46 Quaternions.';
} else if (request.received === 0) {
  interpretation = 'NOT RUN: paste the separate player, press its LOAD / LISTEN button, then inspect this cartridge again.';
} else if (request.accepted === 0) {
  interpretation = 'REQUEST REJECTED: the received player capabilities or protocol fields did not match this cartridge.';
} else if (offer.sent === 0) {
  interpretation = 'WAITING FOR SEND: the request was accepted; press the green Send SQM1 test song button once.';
} else if (ack.received === 0) {
  interpretation = 'NO ACK: the cartridge offered its score, but no player acknowledgment returned.';
} else if (ack.result !== 1) {
  interpretation = `PLAYER REJECTED LOAD: acknowledgment result ${ack.result}; inspect player validation diagnostics.`;
} else {
  interpretation = 'INCOMPLETE: inspect request/offer/ack counters and nonce fields for the first mismatch.';
}

console.log(JSON.stringify({
  passed,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  score: {exact: scoreExact, length: Array.isArray(score?.$array) ? score.$array.length : null,
    expectedLength: expected.length},
  request,
  offer,
  ack,
  graph: {
    bricks: scene.bricks.length,
    components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
    wires: scene.edges.length,
    linkedGrids: scene.links.length,
    requestReceivers: scene.bricks.filter(brick => brick.comps.some(component =>
      component.type === C.Event_CustomGlobal.NAME
        && component.data.EventName === 'SQM1.Request')).length,
    offerSenders: scene.bricks.filter(brick => brick.comps.some(component =>
      component.type === C.Exec_SendCustomEventGlobal.NAME
        && component.data.EventName === 'SQM1.Offer')).length,
    ackReceivers: scene.bricks.filter(brick => brick.comps.some(component =>
      component.type === C.Event_CustomGlobal.NAME
        && component.data.EventName === 'SQM1.Ack')).length,
    buttons,
  },
  warnings,
  retainedFields: Object.keys(values).sort(),
  interpretation,
}, null, 2));
