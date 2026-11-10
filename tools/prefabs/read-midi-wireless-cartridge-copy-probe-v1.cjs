'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const file = process.argv[2];
if (!file) {
  throw new Error('Usage: node read-midi-wireless-cartridge-copy-probe-v1.cjs <returned.brz>');
}

const PREFIX = 'MWCP1:';
const bytes = fs.readFileSync(file);
const scene = read(bytes);
const values = {};
const arrays = {};
const warnings = [];

function unwrap(value) {
  if (value && typeof value === 'object' && '$variant' in value) return value.value;
  return value;
}

for (const brick of scene.bricks) {
  const marker = brick.comps.find(component => component.type === C.Interact.NAME
    && component.data.Message?.startsWith(PREFIX));
  if (!marker) continue;
  const label = marker.data.Message.slice(PREFIX.length);
  const variable = brick.comps.find(component => component.type === C.Var.NAME);
  const array = brick.comps.find(component => component.type === C.ArrayVar.NAME);
  if (variable) values[label] = unwrap(variable.data.Value);
  else if (array) arrays[label] = array.data.Value;
  else warnings.push(`Marker ${label} has no Var or ArrayVar`);
}

function score() {
  const result = [
    {X: 7701001, Y: 1, Z: 1, W: 2},
    {X: 34, Y: 0.125, Z: 60, W: 64},
    {X: 34, Y: 2, Z: 0, W: 0},
  ];
  while (result.length < 34) result.push({X: 36, Y: 0, Z: -1, W: -1});
  result.push(
    {X: 0, Y: 0.75, Z: 60, W: 100},
    {X: 0.875, Y: 1.5, Z: 64, W: 80},
  );
  return result;
}

const expected = score();
const tolerance = 1e-7;
function sameNumber(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}
function sameQuat(a, b) {
  return a && b && ['X', 'Y', 'Z', 'W'].every(field => sameNumber(a[field], b[field]));
}
function sameArray(array, wanted) {
  return array?.$elementType === 'Quat' && Array.isArray(array.$array)
    && array.$array.length === wanted.length
    && array.$array.every((item, index) => sameQuat(item, wanted[index]));
}

function analyzePath(prefix, indices, extras = {}) {
  const cache = arrays[`${prefix}.cache`];
  const observations = Object.fromEntries(indices.map(index => [
    `q${index}`,
    {
      value: values[`${prefix}.observed.q${index}`],
      outOfBounds: values[`${prefix}.observed.q${index}.outOfBounds`],
      expected: expected[index],
      matches: sameQuat(values[`${prefix}.observed.q${index}`], expected[index])
        && values[`${prefix}.observed.q${index}.outOfBounds`] === false,
      engineCheck: values[`${prefix}.check.q${index}`],
    },
  ]));
  const copied = Number(values[`${prefix}.copy.completed`] ?? 0);
  const length = values[`${prefix}.observed.length`];
  const cacheExact = sameArray(cache, expected);
  const observationsExact = Object.values(observations).every(item => item.matches);
  const engineChecks = values[`${prefix}.check.length`] === true
    && Object.values(observations).every(item => item.engineCheck === true)
    && values[`${prefix}.passed`] === true;
  return {
    passed: copied >= 1 && length === expected.length && cacheExact
      && observationsExact && engineChecks && (extras.accepted === undefined || extras.accepted >= 1),
    copiesCompleted: copied,
    observedLength: length,
    expectedLength: expected.length,
    cacheLength: Array.isArray(cache?.$array) ? cache.$array.length : null,
    cacheExact,
    observationsExact,
    engineChecks,
    enginePassed: values[`${prefix}.passed`],
    observations,
    ...extras,
  };
}

const wireless = analyzePath('player', [0, 1, 2, 34, 35], {
  received: Number(values['player.received'] ?? 0),
  accepted: Number(values['player.accepted'] ?? 0),
  rejected: Number(values['player.rejected'] ?? 0),
  envelope: {
    magic: values['player.seen.magic'],
    channel: values['player.seen.channel'],
    title: values['player.seen.title'],
    declaredLength: values['player.seen.declaredLength'],
  },
});
wireless.passed = wireless.passed && wireless.received >= 1 && wireless.rejected === 0
  && wireless.envelope.magic === 7701001 && wireless.envelope.channel === 1
  && wireless.envelope.title === 'Wireless probe: two-note sine score'
  && wireless.envelope.declaredLength === expected.length;

const direct = analyzePath('direct', [0, 34, 35]);
const diskSent = Number(values['disk.sent'] ?? 0);
const graph = {
  bricks: scene.bricks.length,
  components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
  wires: scene.edges.length,
  linkedGrids: scene.links.length,
  senders: scene.bricks.filter(brick => brick.comps.some(component =>
    component.type === C.Exec_SendCustomEventGlobal.NAME
      && component.data.EventName === 'MIDI.Cartridge.Offer.V1')).length,
  receivers: scene.bricks.filter(brick => brick.comps.some(component =>
    component.type === C.Event_CustomGlobal.NAME
      && component.data.EventName === 'MIDI.Cartridge.Offer.V1')).length,
  copyFromGates: scene.bricks.filter(brick => brick.comps.some(component =>
    component.type === C.Exec_ArrayVar_CopyFrom.NAME)).length,
  buttons: scene.bricks.flatMap(brick => brick.comps)
    .filter(component => component.type === C.Button.NAME)
    .map(component => component.data.PromptCustomLabel),
};

let interpretation;
if (direct.passed && wireless.passed) {
  interpretation = 'PASS: hardwired cross-chip CopyFrom and global-event ArrayVarRef transport both copied the exact 36-Quaternion MIDI score into independent local caches.';
} else if (direct.passed && !wireless.passed) {
  interpretation = 'PARTIAL: hardwired cross-chip CopyFrom works, but the wireless global-event ArrayVarRef path did not establish an exact copy. Inspect wireless counters/envelope to isolate filtering versus ref transport.';
} else if (!direct.passed && wireless.passed) {
  interpretation = 'UNEXPECTED PARTIAL: wireless copy passed while the hardwired control did not. Inspect the direct button/counters before drawing a transport conclusion.';
} else if (diskSent === 0 && direct.copiesCompleted === 0) {
  interpretation = 'NOT RUN: press ORANGE DIRECT, wait three seconds, then GREEN WIRELESS, wait three seconds, and re-export the whole assembly.';
} else {
  interpretation = 'FAIL/INCOMPLETE: the hardwired baseline was not established, so this save cannot yet isolate global-event reference transport. Inspect counters, paste warnings, and retained observations.';
}

console.log(JSON.stringify({
  passed: direct.passed && wireless.passed && diskSent >= 1,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  diskSent,
  direct,
  wireless,
  graph,
  warnings,
  retainedFields: Object.keys(values).sort(),
  retainedArrays: Object.fromEntries(Object.entries(arrays).map(([key, array]) => [key, {
    elementType: array?.$elementType,
    length: Array.isArray(array?.$array) ? array.$array.length : null,
  }])),
  interpretation,
}, null, 2));
