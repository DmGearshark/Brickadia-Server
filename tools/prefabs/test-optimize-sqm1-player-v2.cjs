'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');
const {read, write} = require('./reskin-loadboard.cjs');
const validatePlacement = require('./validate-placement.cjs');
const patchControls = require('./patch-sqm1-user-player-controls-v1.cjs');

function component(brick, type) {
  return brick?.comps.find(candidate => candidate.type === type);
}

function count(scene, type) {
  return scene.bricks.filter(brick => component(brick, type)).length;
}

function main() {
  const controls = patchControls();
  const scene = controls.scene;
  const source = read(controls.sourceBytes);
  const rootBefore = structuredClone(source.bricks.filter(brick => brick.g === 1));
  const arraysBefore = structuredClone(source.bricks
    .filter(brick => component(brick, C.ArrayVar.NAME))
    .map(brick => component(brick, C.ArrayVar.NAME).data.Value));
  const essentialBefore = {
    emitters: count(source, C.AudioEmitter.NAME),
    functions: count(source, C.FunctionCall.NAME),
    dampens: count(source, C.Dampen.NAME),
    arrayGets: count(source, C.Exec_ArrayVar_Get.NAME),
    arrayCopies: count(source, C.Exec_ArrayVar_CopyFrom.NAME),
  };

  const stats = controls.optimization;
  assert.deepEqual(stats.before, {bricks: 5142, edges: 8355, components: 5703});
  assert.deepEqual(stats.after, {bricks: 4847, edges: 7975, components: 4855});
  assert.equal(stats.removed.bricks, 295);
  assert.equal(stats.removed.edges, 380);
  assert.equal(stats.removed.components, 848);
  assert.equal(stats.removed.orphanPure, 4);
  assert.equal(stats.removed.diagnosticVars, 110);
  assert.equal(stats.removed.oobBranches, 18);
  assert.equal(stats.removed.enableEdges, 18);
  assert.equal(stats.removed.deadInnerPorts, 2);
  assert.equal(stats.removed.hiddenMarkers, 553);
  assert.equal(stats.removed.markersStrippedFromRetainedBricks, 443);

  assert.deepEqual(scene.bricks.filter(brick => brick.g === 1), rootBefore,
    'Visible root-grid UI is byte-structurally unchanged');
  assert.deepEqual(scene.bricks.filter(brick => component(brick, C.ArrayVar.NAME))
    .map(brick => component(brick, C.ArrayVar.NAME).data.Value), arraysBefore,
  'Staging and retained score arrays are unchanged');
  assert.deepEqual({
    emitters: count(scene, C.AudioEmitter.NAME),
    functions: count(scene, C.FunctionCall.NAME),
    dampens: count(scene, C.Dampen.NAME),
    arrayGets: count(scene, C.Exec_ArrayVar_Get.NAME),
    arrayCopies: count(scene, C.Exec_ArrayVar_CopyFrom.NAME),
  }, essentialBefore, 'Playback, score and copy components are retained');

  assert.equal(scene.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Interact.NAME
      && item.data.Message?.startsWith('MWSP5:')).length, 0,
  'Hidden development markers are stripped');
  assert.equal(scene.bricks.flatMap(brick => brick.comps)
    .filter(item => item.type === C.Interact.NAME
      && item.data.Message?.startsWith('SQM1CFG:')).length, 6,
  'Editable production-control markers are retained');
  const clock = scene.bricks.find(brick => brick.key === stats.stopwatchKey);
  assert.equal(component(clock, C.Stopwatch.NAME).data.bRunning, false,
    'Idle playback clock is paused');
  const runningEdge = scene.bricks.find(brick => brick.key === stats.runningEdgeKey);
  assert(component(runningEdge, C.Expr_EdgeDetectorExec.NAME));
  assert(scene.edges.some(edge => edge.a === stats.runningKey
    && edge.z === stats.runningEdgeKey && edge.q === 'Input'));
  assert(scene.edges.some(edge => edge.a === stats.runningEdgeKey
    && edge.p === 'OnRisingEdge' && edge.z === stats.stopwatchKey && edge.q === 'Resume'));
  assert(scene.edges.some(edge => edge.a === stats.runningEdgeKey
    && edge.p === 'OnFallingEdge' && edge.z === stats.stopwatchKey && edge.q === 'Pause'));
  assert(!scene.edges.some(edge => edge.z === stats.stopwatchKey && edge.q === 'bRunning'),
    'Saved bRunning is not an invalid wire target');

  const output = write(scene, {
    name: 'SQM1 Auto-Zone Music Player Frame V2 - optimization test',
    description: 'Structural optimization test output.',
  });
  const placement = validatePlacement(output.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  const roundTrip = read(output.bytes);
  assert.equal(roundTrip.bricks.length, stats.after.bricks);
  assert.equal(roundTrip.edges.length, stats.after.edges);
  console.log('SQM1 V2 conservative optimization checks passed: visible UI and score arrays retained, '
    + 'idle clock paused, low-risk note diagnostics removed, dead ports/expressions pruned, '
    + 'development markers stripped, unique wiring and strict placement preserved.');
}

if (require.main === module) main();

module.exports = main;
