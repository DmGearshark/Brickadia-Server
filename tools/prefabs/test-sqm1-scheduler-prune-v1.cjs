'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const testV10 = require('./test-sqm1-piano-player-v10.cjs');
const schedulerPrune = require('./apply-sqm1-scheduler-prune-v1.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const VOICES = 24;
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});
const sourceId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p});

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function fixture(runV10Test = false) {
  const context = buildV10();
  if (runV10Test) testV10(context);
  const v10Bytes = Buffer.from(context.bytes);
  const before = {
    bricks: structuredClone(context.scene.bricks),
    edges: structuredClone(context.scene.edges),
    prefab: structuredClone(context.scene.r.prefabJson()),
    assets: structuredClone(context.scene.r.externalAssets()),
  };
  const schedulerPrunePatch = schedulerPrune.apply(context.scene, context);
  const result = write(context.scene, {
    name: 'SQM1 V10.1 Scheduler-Prune Test Fixture',
    description: 'Exact V10 audio and controls with write-only per-note diagnostics removed.',
  });
  return {...context, v10Bytes, before, schedulerPrunePatch,
    bytes: result.bytes, outputScene: read(result.bytes)};
}

function test(context) {
  const {scene, outputScene, bytes, v10Bytes, before, schedulerPrunePatch: patch} = context;
  assert(scene && outputScene && bytes && v10Bytes && before && patch,
    'scheduler-prune fixture context');
  assert.deepEqual(patch.constants, {
    VOICES,
    DIAGNOSTIC_BRICKS_PER_VOICE: 24,
    DUPLICATE_NOTS_PER_VOICE: 1,
    BYPASS_EDGES_PER_VOICE: 4,
    REMOVED_BRICKS: 600,
    REMOVED_EDGES_NET: 816,
    NORMAL_DECODE_EXECUTIONS_REMOVED: 11,
  });
  assert.deepEqual(patch.before, {bricks: 7838, edges: 13196, components: 7846});
  assert.deepEqual(patch.after, {bricks: 7238, edges: 12380, components: 7246});
  assert.equal(patch.voices.length, VOICES);
  assert.equal(patch.removedBricks.length, 600);
  assert.equal(patch.removedEdges.length, 912);
  assert.equal(patch.bypassEdges.length, 96);

  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const beforeIncoming = (brick, type, port) => before.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const beforeOutgoing = (brick, type, port) => before.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const removedKeys = new Set(patch.removedBricks.map(brick => brick.key));
  assert.equal(removedKeys.size, 600);
  assert([...removedKeys].every(key => !byKey.has(key)), 'every declared scheduler brick removed');
  for (const brick of before.bricks) if (!removedKeys.has(brick.key)) {
    assert.deepEqual(byKey.get(brick.key), brick, `retained brick ${brick.key} is exact V10`);
  }

  const beforeEdgeIds = new Set(before.edges.map(edgeId));
  const afterEdgeIds = new Set(scene.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdgeIds.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdgeIds.has(edgeId(edge)));
  assert.equal(removedEdges.length, 912);
  assert.equal(addedEdges.length, 96);
  assert.deepEqual(removedEdges.map(edgeId).sort(), patch.removedEdges.map(edgeId).sort(),
    'patch reports every removed scheduler edge');
  assert.deepEqual(addedEdges.map(edgeId).sort(), patch.bypassEdges.map(edgeId).sort(),
    'only declared scheduler bypasses added');
  assert(removedEdges.every(edge => removedKeys.has(edge.a) || removedKeys.has(edge.z)),
    'only edges touching removed scheduler bricks disappear');

  for (const voice of patch.voices) {
    assert.equal(voice.diagnosticLabels.length, 11, `voice ${voice.voice} diagnostic Vars`);
    assert.equal(voice.diagnosticVars.length, 11);
    assert.equal(voice.diagnosticWriters.length, 11);
    for (const diagnostic of voice.diagnosticVars) {
      assert(component(diagnostic, C.Var.NAME), `voice ${voice.voice} diagnostic Var`);
      assert.equal(beforeOutgoing(diagnostic, C.Var.NAME, 'Value').length, 0,
        `voice ${voice.voice} diagnostic state was never read`);
      assert.equal(beforeOutgoing(diagnostic, C.Var.NAME, 'VarRef').length, 1,
        `voice ${voice.voice} diagnostic state had one writer`);
    }
    for (const writer of voice.diagnosticWriters) {
      assert([C.Exec_Var_Set.NAME, C.Exec_Var_Increment.NAME]
        .some(type => component(writer, type)), `voice ${voice.voice} diagnostic writer`);
    }
    assert(component(voice.abortBranch, C.Exec_Branch.NAME));
    assert(component(voice.abortUnion, C.Exec_Union.NAME));
    assert(component(voice.call, C.FunctionCall.NAME));
    assert(component(voice.decodePublication, C.BufferTicks.NAME));
    assert.equal(component(voice.decodePublication, C.BufferTicks.NAME).data.TicksToWait, 1,
      `voice ${voice.voice} decode publication tick retained`);

    assert.equal(sourceId(one(incoming(voice.pitchWriter, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} FunctionCall -> pitch`)),
    sourceId({a: voice.call.key, at: C.FunctionCall.NAME, p: 'Completed'}));
    assert.equal(sourceId(one(incoming(voice.velocityWriter, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} pitch -> velocity`)),
    sourceId({a: voice.pitchWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(sourceId(one(incoming(voice.startWriter, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} velocity -> start`)),
    sourceId({a: voice.velocityWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(sourceId(one(incoming(voice.endWriter, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} start -> end`)),
    sourceId({a: voice.startWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(sourceId(one(incoming(voice.decodePublication, C.BufferTicks.NAME, 'Input'),
      `voice ${voice.voice} end -> publication`)),
    sourceId({a: voice.endWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(sourceId(one(incoming(voice.markFailedDone, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} failed decode -> done`)),
    sourceId({a: voice.decodeBranch.key, at: C.Exec_Branch.NAME, p: 'ExecOutB'}));

    // The four Function outputs still drive the same pitch, velocity, start
    // and end setter values; only the unobserved copies between them are gone.
    const outputRoutes = [
      [voice.pitchWriter, 'Output1'],
      [voice.velocityWriter, 'Output0'],
      [voice.startWriter, 'Output3'],
      [voice.endWriter, 'Output2'],
    ];
    for (const [writer, port] of outputRoutes) {
      assert.equal(sourceId(one(incoming(writer, C.Exec_Var_Set.NAME, 'Value'),
        `voice ${voice.voice} ${port} value`)),
      sourceId({a: voice.call.key, at: C.FunctionCall.NAME, p: port}));
    }
    assert.deepEqual(incoming(voice.decodeBranch, C.Exec_Branch.NAME, 'Condition').map(edgeId),
      beforeIncoming(beforeByKey.get(voice.decodeBranch.key),
        C.Exec_Branch.NAME, 'Condition').map(edgeId),
    `voice ${voice.voice} decode acceptance condition is exact V10`);
    assert.deepEqual(outgoing(voice.decodeBranch, C.Exec_Branch.NAME, 'ExecOutA').map(edgeId),
      beforeOutgoing(beforeByKey.get(voice.decodeBranch.key),
        C.Exec_Branch.NAME, 'ExecOutA').map(edgeId),
    `voice ${voice.voice} successful decode path is exact V10`);
  }

  assert(component(patch.sharedNotRunning, C.Expr_LogicalNOT.NAME),
    'one retained shared not-running gate');
  assert.equal(outgoing(patch.running, C.Var.NAME, 'Value').filter(edge =>
    edge.zt === C.Expr_LogicalNOT.NAME && edge.q === 'bInput').length, 1,
  'running drives only one NOT after sharing');
  assert.equal(outgoing(patch.sharedNotRunning,
    C.Expr_LogicalNOT.NAME, 'bOutput').length, VOICES + 1,
  'shared not-running feeds start eligibility and all end-or-stop gates');
  assert.equal(outgoing(patch.sharedNotRunning, C.Expr_LogicalNOT.NAME, 'bOutput')
    .filter(edge => edge.zt === C.Expr_LogicalOR.NAME && edge.q === 'bInputB').length,
  VOICES, 'all per-voice stop paths use shared not-running');

  // No audio, UI, controls, cartridge/event, array, or function component was
  // removed. All wires into the physical sources remain byte-exact.
  assert.deepEqual(scene.bricks.filter(brick => brick.g === 1),
    before.bricks.filter(brick => brick.g === 1), 'visible UI is exact V10');
  assert.deepEqual(scene.r.externalAssets(), before.assets, 'assets unchanged');
  assert.deepEqual(scene.r.prefabJson(), before.prefab, 'prefab metadata unchanged');
  const audioKeys = before.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).map(brick => brick.key);
  assert.equal(audioKeys.length, 72);
  for (const key of audioKeys) {
    const brick = byKey.get(key);
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier']) {
      assert.deepEqual(incoming(brick, C.AudioEmitter.NAME, port).map(edgeId).sort(),
        before.edges.filter(edge => edge.z === key && edge.zt === C.AudioEmitter.NAME
          && edge.q === port).map(edgeId).sort(), `${key}.${port} exact V10 audio route`);
    }
  }
  assert.equal(scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME)).length, 72);
  assert.equal(scene.bricks.filter(brick => component(brick, C.Dampen.NAME)).length, 73);
  assert.equal(scene.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length, VOICES);
  assert.equal(scene.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0);
  assert.deepEqual({bricks: outputScene.bricks.length, edges: outputScene.edges.length,
    components: outputScene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0)},
  {bricks: 7238, edges: 12380, components: 7246}, 'exact pruned graph budget');

  const placement = validatePlacement(bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  const serializedByKey = new Map(outputScene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of outputScene.edges) {
    assert(serializedByKey.get(edge.a)?.comps.some(item => item.type === edge.at),
      `valid source ${edge.a}`);
    assert(serializedByKey.get(edge.z)?.comps.some(item => item.type === edge.zt),
      `valid target ${edge.z}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `unique target ${target}`);
    targets.add(target);
  }

  console.log('SQM1 scheduler-prune checks passed: exact V4-V10 baseline, 264 write-only '
    + 'diagnostic Vars and 312 diagnostic execution nodes removed, 24 duplicate not-running '
    + 'gates shared, exact FunctionCall value/validation paths, unchanged audio/UI/intake '
    + 'components, 600-brick/816-wire reduction, strict placement and valid unique wiring.');
  return {placement, removedEdges, addedEdges};
}

module.exports = test;
module.exports.fixture = fixture;

if (require.main === module) {
  const first = fixture(true);
  test(first);
  const second = fixture(false);
  test(second);
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'scheduler-pruned fixture rebuilds byte-for-byte');
}
