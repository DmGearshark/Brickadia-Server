'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const build = require('./add-shark-pose-probe.cjs');
const validate = require('./validate-placement.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
const result = build(input);
const scene = result.scene;
assert.equal(scene.bricks.length, result.original.bricks.length + 19);
assert.equal(scene.edges.length, result.original.edges.length + 38);
const probeSweeps = scene.bricks.filter(brick => brick.comps.some(c => c.type === C.Exec_Sweep.NAME && c.data.bOnlyHitPlayerBodyParts));
assert.equal(probeSweeps.length, 6);
for (const brick of probeSweeps) {
  const sweep = brick.comps.find(c => c.type === C.Exec_Sweep.NAME);
  assert.equal(sweep.data.bOnlyHitPlayerBodyParts, true);
  assert.equal(sweep.data.Distance, 10);
}
const report = scene.bricks.flatMap(brick => brick.comps.map(comp => ({brick, comp})))
  .find(x => x.comp.type === C.Expr_String_FormatText.NAME && x.comp.data.FormatString.startsWith('BODY-PART POSE PROBE'));
assert(report);
assert.equal(scene.edges.filter(e => e.z === report.brick.key && e.zt === report.comp.type && /^Input[A-G]$/.test(e.q)).length, 7);
const placement = validate(result.bytes);
const originalPlacement = validate(fs.readFileSync(input));
assert(placement.ok, JSON.stringify(placement));
assert.equal(placement.invalidBricks.length, 0);
assert.equal(placement.confirmedPairs.length, 0);
const contact = p => [p.aAsset, p.zAsset, p.aPosition, p.zPosition];
assert.deepEqual(placement.uncertainPairs.map(contact), originalPlacement.uncertainPairs.map(contact), 'Probe adds no placement contacts');
console.log(JSON.stringify({addedGates: 19, bodyPartSweeps: 6, liveFields: 7, originalWiresPreserved: result.original.edges.length, newPlacementIssues: 0}, null, 2));
