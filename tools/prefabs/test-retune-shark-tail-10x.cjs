'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const build = require('./retune-shark-tail-10x.cjs');
const { read } = require('./reskin-loadboard.cjs');
const validate = require('./validate-placement.cjs');

const input = process.argv[2];
assert(input, 'Usage: node test-retune-shark-tail-10x.cjs input.brz');
const result = build(input);
const saved = read(result.bytes);

assert.equal(saved.bricks.length, result.original.bricks.length);
assert.equal(saved.edges.length, result.original.edges.length);
assert.equal(saved.links.length, result.original.links.length);
assert.equal(saved.joints.length, result.original.joints.length);
assert.deepEqual(result.values, {
  follow: -50,
  crouchHeight: 200,
  sweepDistance: 1500,
  sweepRadius: 0,
  servoPower: 10000000,
  servoDamping: 1000000,
});

// No brick geometry or component count may change before serialization.
assert.deepEqual(result.scene.bricks.map(brick => brick.data),
  result.original.bricks.map(brick => brick.data));
assert.deepEqual(result.scene.bricks.map(brick => brick.comps.length),
  result.original.bricks.map(brick => brick.comps.length));

const beforePlacement = validate(fs.readFileSync(input));
const afterPlacement = validate(result.bytes);
assert.equal(afterPlacement.ok, beforePlacement.ok);
assert.deepEqual(afterPlacement.invalidBricks, beforePlacement.invalidBricks);
assert.deepEqual(afterPlacement.confirmedPairs, beforePlacement.confirmedPairs);
assert.deepEqual(afterPlacement.uncertainPairs, beforePlacement.uncertainPairs);

console.log(JSON.stringify({
  bricks: saved.bricks.length,
  wires: saved.edges.length,
  geometryPreserved: true,
  helperPreserved: true,
  placementIssuesAdded: 0,
  values: result.values,
}, null, 2));
