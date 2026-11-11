'use strict';

// Small browser replacement for the subset of node:assert/strict used by the
// cartridge builder. Keeping this local lets esbuild package the proven Node
// graph without pulling a general-purpose assertion dependency into the app.
function inspect(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fail(message) {
  throw new Error(message || 'Assertion failed');
}

function assert(value, message) {
  if (!value) fail(message);
}

assert.equal = (actual, expected, message) => {
  if (actual !== expected) {
    fail(message || `Expected ${inspect(actual)} to equal ${inspect(expected)}`);
  }
};

assert.notEqual = (actual, expected, message) => {
  if (actual === expected) {
    fail(message || `Expected ${inspect(actual)} to differ from ${inspect(expected)}`);
  }
};

assert.deepEqual = (actual, expected, message) => {
  if (inspect(actual) !== inspect(expected)) {
    fail(message || `Expected ${inspect(actual)} to deeply equal ${inspect(expected)}`);
  }
};

module.exports = assert;
