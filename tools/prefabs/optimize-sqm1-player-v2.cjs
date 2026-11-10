'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');

const PREFIX = 'MWSP5:';

const clone = value => structuredClone(value);

function component(brick, type) {
  return brick?.comps.find(candidate => candidate.type === type);
}

function optimizeSqm1PlayerV2(scene) {
  assert(scene && Array.isArray(scene.bricks) && Array.isArray(scene.edges),
    'Decoded SQM1 scene is required');

  const before = {
    bricks: scene.bricks.length,
    edges: scene.edges.length,
    components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
  };
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const markers = new Map();
  for (const brick of scene.bricks) {
    const marker = component(brick, C.Interact.NAME);
    if (!marker?.data.Message?.startsWith(PREFIX)) continue;
    const label = marker.data.Message.slice(PREFIX.length);
    assert(!markers.has(label), `Duplicate ${PREFIX}${label}`);
    markers.set(label, brick);
  }
  assert(markers.size >= 500, 'Expected the marked V5 player graph');

  const marked = label => {
    const brick = markers.get(label);
    assert(brick, `Missing ${PREFIX}${label}`);
    return brick;
  };
  const running = marked('running');
  const runningVar = component(running, C.Var.NAME);
  assert(runningVar, 'Marked running state is not a Var');
  const runningValue = Boolean(runningVar.data.Value?.value);
  const logicGrid = running.g;

  const clocks = scene.bricks.filter(brick => brick.g === logicGrid
    && component(brick, C.Stopwatch.NAME));
  assert.equal(clocks.length, 1, 'One V5 playback Stopwatch');
  const clock = clocks[0];
  const clockComponent = component(clock, C.Stopwatch.NAME);
  assert(!scene.edges.some(edge => edge.z === clock.key
    && edge.zt === C.Stopwatch.NAME && ['Pause', 'Resume'].includes(edge.q)),
  'Playback Stopwatch already has pause/resume drivers');

  // Capture the four original, output-free expression gates before pruning.
  // Three are detached diagnostic strings; the fourth is a detached UI blend.
  const outgoingKeys = new Set(scene.edges.map(edge => edge.a));
  const orphanPure = scene.bricks.filter(brick => !outgoingKeys.has(brick.key)
    && brick.comps.some(item => item.type.startsWith('BrickComponentType_Expr_')));
  assert.equal(orphanPure.length, 4, 'Four output-free expression gates');
  const runningGridDonor = orphanPure.find(brick => brick.g === logicGrid);
  assert(runningGridDonor, 'A removable expression position on the player grid');
  const removeKeys = new Set(orphanPure.map(brick => brick.key));
  const removedLabels = [];
  const removeMarkedVar = label => {
    const brick = marked(label);
    assert(component(brick, C.Var.NAME), `${PREFIX}${label} must be a Var`);
    removeKeys.add(brick.key);
    removedLabels.push(label);
    const consumers = scene.edges.filter(edge => edge.a === brick.key
      && edge.at === C.Var.NAME && edge.p === 'VarRef');
    assert(consumers.length >= 1, `${PREFIX}${label} must have a VarRef consumer`);
    for (const edge of consumers) {
      assert([C.Exec_Var_Set.NAME, C.Exec_Var_Increment.NAME].includes(edge.zt),
        `${PREFIX}${label} has an unexpected VarRef consumer ${edge.zt}`);
      removeKeys.add(edge.z);
    }
    return {brick, consumers};
  };

  // These counters and snapshots feed no user-facing output. They were useful
  // while proving the two-voice transport, but add work to every decoded note.
  removeMarkedVar('notes.armed');
  removeMarkedVar('notes.finished');
  const voiceIndices = [...markers.keys()]
    .map(label => /^voice(\d+)\.cursor$/.exec(label))
    .filter(Boolean).map(match => Number(match[1])).sort((a, b) => a - b);
  assert.deepEqual(voiceIndices, Array.from({length: 18}, (_, index) => index),
    'V5 fixed voice set');

  let oobBranches = 0;
  let enableEdges = 0;
  for (const voice of voiceIndices) {
    const prefix = `voice${voice}.`;
    removeMarkedVar(`${prefix}getter.outOfBoundsCount`);
    const oobSnapshot = removeMarkedVar(`${prefix}getter.lastOutOfBounds`);
    const snapshotSetterKeys = new Set(oobSnapshot.consumers.map(edge => edge.z));
    const branches = scene.edges.filter(edge => snapshotSetterKeys.has(edge.a)
      && edge.p === 'ExecOut' && edge.zt === C.Exec_Branch.NAME);
    assert.equal(branches.length, 1, `${prefix}OOB diagnostic branch`);
    removeKeys.add(branches[0].z);
    oobBranches++;

    removeMarkedVar(`${prefix}notes.armed`);
    removeMarkedVar(`${prefix}notes.finished`);
    const rise = removeMarkedVar(`${prefix}enable.rises`);
    const fall = removeMarkedVar(`${prefix}enable.falls`);
    const counterKeys = new Set([...rise.consumers, ...fall.consumers].map(edge => edge.z));
    const execSources = scene.edges.filter(edge => counterKeys.has(edge.z)
      && edge.q === 'Exec').map(edge => edge.a);
    const edgeKeys = [...new Set(execSources)].filter(key =>
      component(byKey.get(key), C.Expr_EdgeDetectorExec.NAME));
    assert.equal(edgeKeys.length, 1, `${prefix}enable diagnostic edge`);
    const edgeKey = edgeKeys[0];
    assert(scene.edges.filter(edge => edge.a === edgeKey)
      .every(edge => counterKeys.has(edge.z)), `${prefix}enable edge is diagnostic-only`);
    removeKeys.add(edgeKey);
    enableEdges++;
  }
  assert.equal(oobBranches, 18);
  assert.equal(enableEdges, 18);

  // The control patch repurposes all five inherited input bricks for clamps
  // and shared emitter settings. Only the two superseded inner outputs remain.
  const deadInnerPorts = [];
  for (const brick of scene.bricks) {
    if (brick.g !== logicGrid) continue;
    if (component(brick, C.MicrochipOutput.NAME)
      && !scene.edges.some(edge => edge.a === brick.key)) {
      deadInnerPorts.push(brick.key);
    }
  }
  assert.equal(deadInnerPorts.length, 2, 'Two replaced inner outputs');
  for (const key of deadInnerPorts) removeKeys.add(key);

  // Pause the only continuously changing source while transport is idle. The
  // saved bRunning field is not a wire port, so use the Stopwatch's real
  // Resume/Pause execution inputs. Seeding the edge detector from retained
  // running state prevents a false transition when the prefab is placed.
  const edgeTemplate = scene.bricks.find(brick => brick.g === logicGrid
    && component(brick, C.Expr_EdgeDetectorExec.NAME) && !removeKeys.has(brick.key));
  assert(edgeTemplate, 'Edge detector template');
  const runningEdge = clone(edgeTemplate);
  runningEdge.key = 'sqm1opt:running-edge';
  assert(!byKey.has(runningEdge.key), 'Unique optimization gate key');
  runningEdge.data.position = clone(runningGridDonor.data.position);
  runningEdge.comps = runningEdge.comps
    .filter(item => item.type === C.Expr_EdgeDetectorExec.NAME)
    .map(item => ({...item, data: {
      ...clone(item.data),
      Input: runningValue ? 1 : 0,
      InputLast: runningValue ? 1 : 0,
      bSeeded: true,
    }}));
  assert.equal(runningEdge.comps.length, 1);
  clockComponent.data.bRunning = runningValue;

  scene.bricks = scene.bricks.filter(brick => !removeKeys.has(brick.key));
  scene.edges = scene.edges.filter(edge => !removeKeys.has(edge.a) && !removeKeys.has(edge.z));
  scene.bricks.push(runningEdge);
  scene.edges.push(
    {a: running.key, at: C.Var.NAME, p: 'Value', z: runningEdge.key,
      zt: C.Expr_EdgeDetectorExec.NAME, q: 'Input'},
    {a: runningEdge.key, at: C.Expr_EdgeDetectorExec.NAME, p: 'OnRisingEdge',
      z: clock.key, zt: C.Stopwatch.NAME, q: 'Resume'},
    {a: runningEdge.key, at: C.Expr_EdgeDetectorExec.NAME, p: 'OnFallingEdge',
      z: clock.key, zt: C.Stopwatch.NAME, q: 'Pause'},
  );

  let strippedMarkers = 0;
  for (const brick of scene.bricks) {
    brick.comps = brick.comps.filter(item => {
      const strip = item.type === C.Interact.NAME
        && item.data.Message?.startsWith(PREFIX);
      if (strip) strippedMarkers++;
      return !strip;
    });
  }

  const targets = new Set();
  for (const edge of scene.edges) {
    assert(scene.bricks.some(brick => brick.key === edge.a), `Missing source ${edge.a}`);
    assert(scene.bricks.some(brick => brick.key === edge.z), `Missing target ${edge.z}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `Duplicate driver ${target}`);
    targets.add(target);
  }

  const after = {
    bricks: scene.bricks.length,
    edges: scene.edges.length,
    components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0),
  };
  return {
    before,
    after,
    removed: {
      bricks: before.bricks - after.bricks,
      edges: before.edges - after.edges,
      components: before.components - after.components,
      orphanPure: orphanPure.length,
      diagnosticVars: removedLabels.length,
      oobBranches,
      enableEdges,
      deadInnerPorts: deadInnerPorts.length,
      hiddenMarkers: markers.size,
      markersStrippedFromRetainedBricks: strippedMarkers,
    },
    logicGrid,
    runningKey: running.key,
    stopwatchKey: clock.key,
    runningEdgeKey: runningEdge.key,
    clockControl: 'running edge -> Stopwatch Resume/Pause',
  };
}

module.exports = optimizeSqm1PlayerV2;
