'use strict';

const fs = require('fs');
const {read} = require('./reskin-loadboard.cjs');
const {C} = require('./loadboard-lib.cjs');

const file = process.argv[2];
if (!file) throw new Error('Usage: node read-midi-decode-function-probe.cjs <returned.brz>');

const scene = read(fs.readFileSync(file));
const results = {};
const calls = [];
for (const brick of scene.bricks) {
  const marker = brick.comps.find(component => component.type === C.Interact.NAME
    && component.data.Message?.startsWith('MDFP1:'));
  const variable = brick.comps.find(component => component.type === C.Var.NAME);
  if (marker && variable) results[marker.data.Message.slice('MDFP1:'.length)] = variable.data.Value;
  const native = brick.comps.find(component => component.type === C.FunctionCall.NAME);
  if (native) calls.push(native.data);
}

function value(wireValue) {
  if (typeof wireValue === 'number' || typeof wireValue === 'boolean') return wireValue;
  return wireValue && typeof wireValue === 'object' && 'value' in wireValue ? wireValue.value : wireValue;
}

const tolerance = 1e-5;

function inferMapping(expected, raw) {
  const mapping = {};
  for (const [name, wanted] of Object.entries(expected)) {
    const matches = raw.flatMap((actual, index) =>
      Number.isFinite(actual) && Number.isFinite(wanted) && Math.abs(actual - wanted) <= tolerance
        ? [`Output${index}`] : []);
    mapping[name] = matches.length === 1 ? matches[0] : matches;
  }
  return mapping;
}

function analyze(name) {
  const expected = Object.fromEntries(['start', 'end', 'pitch', 'velocity']
    .map(field => [field, value(results[`${name}.expected.${field}`])]));
  const immediate = [0, 1, 2, 3]
    .map(index => value(results[`${name}.immediate.output${index}`]));
  const after1tick = [0, 1, 2, 3]
    .map(index => value(results[`${name}.after1tick.output${index}`]));
  const immediateMapping = inferMapping(expected, immediate);
  const delayedMapping = inferMapping(expected, after1tick);
  const uniqueImmediate = new Set(Object.values(immediateMapping)
    .filter(slot => typeof slot === 'string'));
  const stable = immediate.every((actual, index) => Number.isFinite(actual)
    && Number.isFinite(after1tick[index]) && Math.abs(actual - after1tick[index]) <= tolerance);
  const completed = value(results[`${name}.completed`]);
  const iterations = value(results[`${name}.iterations`]);
  const aborted = value(results[`${name}.aborted`]);
  return {
    passed: completed >= 1 && iterations === 1 && aborted === false
      && uniqueImmediate.size === 4 && stable
      && JSON.stringify(immediateMapping) === JSON.stringify(delayedMapping),
    completed,
    iterations,
    aborted,
    expected,
    immediate,
    after1tick,
    stable,
    mapping: immediateMapping,
    delayedMapping,
  };
}

const callerA = analyze('a');
const callerB = analyze('b');
const sameMapping = JSON.stringify(callerA.mapping) === JSON.stringify(callerB.mapping);
const passed = value(results.runs) >= 1 && callerA.passed && callerB.passed && sameMapping;

console.log(JSON.stringify({
  passed,
  results: Object.fromEntries(Object.entries(results).map(([key, item]) => [key, value(item)])),
  callers: {a: callerA, b: callerB},
  sameMapping,
  nativeFunctionCalls: calls,
  interpretation: passed
    ? 'Two same-tick calls shared one pure DecodeNote definition, completed without abort, retained independent outputs through +1 tick, and established one common slot mapping.'
    : 'Probe did not establish the full two-caller contract; inspect caller raw values and native fields.',
}, null, 2));
