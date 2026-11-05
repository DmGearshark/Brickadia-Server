'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const build = require('./add-shark-pose-probe-v2.cjs');
const validate = require('./validate-placement.cjs');
const {C} = require('./loadboard-lib.cjs');

const input = process.argv[2];
const result = build(input);
assert.equal(result.scene.bricks.length, result.original.bricks.length + 15);
assert.equal(result.scene.edges.length, result.original.edges.length + 29);
const sweeps = result.scene.bricks.flatMap(brick => brick.comps.map(comp => ({brick, comp})))
  .filter(x => x.comp.type === C.Exec_Sweep.NAME && x.comp.data.bOnlyHitPlayerBodyParts);
assert.equal(sweeps.length, 7);
assert(sweeps.every(x => x.comp.data.Radius === 2));
assert.equal(sweeps.filter(x => x.comp.data.Distance === 60).length, 6);
assert.equal(sweeps.filter(x => x.comp.data.Distance === 120).length, 1);
const report = result.scene.bricks.flatMap(brick => brick.comps.map(comp => ({brick, comp})))
  .find(x => x.comp.type === C.Expr_String_FormatText.NAME && x.comp.data.FormatString.startsWith('ANIMATED BODY COLLISION'));
assert(report);
assert.equal(result.scene.edges.filter(e => e.z === report.brick.key && e.zt === report.comp.type && /^Input[A-G]$/.test(e.q)).length, 7);
const before = validate(fs.readFileSync(input)), after = validate(result.bytes);
assert(after.ok);
assert.equal(after.invalidBricks.length, 0);
assert.equal(after.confirmedPairs.length, 0);
const contact = p => [p.aAsset, p.zAsset, p.aPosition, p.zPosition];
assert.deepEqual(after.uncertainPairs.map(contact), before.uncertainPairs.map(contact));
console.log(JSON.stringify({outsideInSweeps: 7, liveDistances: 7, originalWiresPreserved: result.original.edges.length, newPlacementIssues: 0}, null, 2));
