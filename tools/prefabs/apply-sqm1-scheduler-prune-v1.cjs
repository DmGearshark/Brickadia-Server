'use strict';

const assert = require('assert/strict');
const {C} = require('./loadboard-lib.cjs');

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function edgeSource(edge) {
  return {a: edge.a, at: edge.at, p: edge.p};
}

function edgeTarget(edge) {
  return {z: edge.z, zt: edge.zt, q: edge.q};
}

function apply(scene, context) {
  const voiceCount = context?.singleSourcePatch?.voices?.length;
  assert(Number.isInteger(voiceCount) && voiceCount >= 1 && voiceCount <= 32,
    'applied V10 Piano player context');
  const generated = context?.assembly?.generatedContext?.player?.context;
  assert(generated?.voiceBuilds?.length === voiceCount && Array.isArray(generated.records),
    'retained generated scheduler context');
  const logicGrid = context.continuousBodyPatch?.logicGrid;
  assert(Number.isInteger(logicGrid), 'V10 scheduler logic grid');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const records = new Map(generated.records.map(record => [record.label, record.node]));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const locateNode = (node, label) => one(scene.bricks.filter(brick => brick.g === logicGrid
    && JSON.stringify(brick.data.position) === JSON.stringify(node.pos)
    && component(brick, node.type)), label);
  const markedVar = label => {
    const node = records.get(label);
    assert(node, `generated scheduler record ${label}`);
    const brick = locateNode(node, label);
    assert(component(brick, C.Var.NAME), `${label} is a retained Var`);
    return brick;
  };
  const writerForVar = (brick, label) => {
    const reference = one(outgoing(brick, C.Var.NAME, 'VarRef'),
      `${label} has one writer`);
    assert([C.Exec_Var_Set.NAME, C.Exec_Var_Increment.NAME].includes(reference.zt),
      `${label} consumer is a setter or counter`);
    return byKey.get(reference.z);
  };
  const diagnosticWriter = (brick, label) => {
    assert.equal(outgoing(brick, C.Var.NAME, 'Value').length, 0,
      `${label} has no runtime Value consumers`);
    return writerForVar(brick, label);
  };

  const removedKeys = new Set();
  const bypassEdges = [];
  const voices = [];

  for (let voice = 0; voice < voiceCount; voice++) {
    const prefix = `voice${voice}.`;
    const diagnosticLabels = [
      `${prefix}decode.calls`,
      `${prefix}decode.completed`,
      `${prefix}decode.failures`,
      `${prefix}decode.abortedCount`,
      `${prefix}decode.lastAborted`,
      `${prefix}decode.lastIterations`,
      `${prefix}lastNote`,
      ...Array.from({length: 4}, (_, output) => `${prefix}decode.rawOutput${output}`),
    ];
    const diagnosticVars = diagnosticLabels.map(markedVar);
    const diagnosticWriters = diagnosticVars.map((brick, index) =>
      diagnosticWriter(brick, diagnosticLabels[index]));
    for (const brick of [...diagnosticVars, ...diagnosticWriters]) removedKeys.add(brick.key);

    const writerFor = label => writerForVar(markedVar(label), label);
    const completedWriter = diagnosticWriters[1];
    const failureWriter = diagnosticWriters[2];
    const abortedWriter = diagnosticWriters[3];
    assert(component(completedWriter, C.Exec_Var_Increment.NAME),
      `${prefix}decode completed counter`);
    assert(component(failureWriter, C.Exec_Var_Increment.NAME),
      `${prefix}decode failure counter`);
    assert(component(abortedWriter, C.Exec_Var_Increment.NAME),
      `${prefix}decode aborted counter`);

    const abortBranchEdge = one(outgoing(completedWriter,
      C.Exec_Var_Increment.NAME, 'ExecOut'), `${prefix}completed -> abort branch`);
    const abortBranch = byKey.get(abortBranchEdge.z);
    assert(component(abortBranch, C.Exec_Branch.NAME), `${prefix}abort branch`);
    const abortUnionEdge = one(outgoing(abortedWriter,
      C.Exec_Var_Increment.NAME, 'ExecOut'), `${prefix}aborted counter -> union`);
    const abortUnion = byKey.get(abortUnionEdge.z);
    assert(component(abortUnion, C.Exec_Union.NAME), `${prefix}abort union`);
    assert.equal(one(outgoing(abortBranch, C.Exec_Branch.NAME, 'ExecOutA'),
      `${prefix}aborted branch`).z, abortedWriter.key);
    assert.equal(one(outgoing(abortBranch, C.Exec_Branch.NAME, 'ExecOutB'),
      `${prefix}non-aborted branch`).z, abortUnion.key);
    assert.equal(one(outgoing(abortedWriter, C.Exec_Var_Increment.NAME, 'ExecOut'),
      `${prefix}aborted join`).z, abortUnion.key);
    removedKeys.add(abortBranch.key);
    removedKeys.add(abortUnion.key);

    const voiceBuild = generated.voiceBuilds[voice];
    assert.equal(voiceBuild.voiceIndex, voice, `${prefix}generated voice context`);
    const call = locateNode(voiceBuild.call, `${prefix}FunctionCall`);
    const decodePublication = locateNode(voiceBuild.decodeConditionPublished,
      `${prefix}decode publication buffer`);
    assert(component(call, C.FunctionCall.NAME), `${prefix}FunctionCall`);
    assert(component(decodePublication, C.BufferTicks.NAME), `${prefix}decode publication buffer`);

    const pitchWriter = writerFor(`${prefix}note.pitch`);
    const velocityWriter = writerFor(`${prefix}note.velocity`);
    const startWriter = writerFor(`${prefix}note.start`);
    const endWriter = writerFor(`${prefix}note.end`);
    assert(component(pitchWriter, C.Exec_Var_Set.NAME), `${prefix}pitch writer`);
    assert(component(velocityWriter, C.Exec_Var_Set.NAME), `${prefix}velocity writer`);
    assert(component(startWriter, C.Exec_Var_Set.NAME), `${prefix}start writer`);
    assert(component(endWriter, C.Exec_Var_Set.NAME), `${prefix}end writer`);
    assert.equal(one(outgoing(pitchWriter, C.Exec_Var_Set.NAME, 'ExecOut'),
      `${prefix}pitch -> velocity`).z, velocityWriter.key);
    assert.equal(one(outgoing(velocityWriter, C.Exec_Var_Set.NAME, 'ExecOut'),
      `${prefix}velocity -> start`).z, startWriter.key);
    assert.equal(one(outgoing(startWriter, C.Exec_Var_Set.NAME, 'ExecOut'),
      `${prefix}start -> end`).z, endWriter.key);

    const callCompletion = one(outgoing(call, C.FunctionCall.NAME, 'Completed'),
      `${prefix}FunctionCall completion`);
    assert(removedKeys.has(callCompletion.z), `${prefix}completion entered diagnostics`);
    const endContinuation = one(outgoing(endWriter, C.Exec_Var_Set.NAME, 'ExecOut'),
      `${prefix}end continuation`);
    assert(removedKeys.has(endContinuation.z), `${prefix}end entered completion diagnostics`);
    assert.equal(one(outgoing(abortUnion, C.Exec_Union.NAME, 'ExecOut'),
      `${prefix}abort union publication`).z, decodePublication.key);

    const decodeBranchEdge = one(outgoing(decodePublication,
      C.BufferTicks.NAME, 'Output'), `${prefix}published decode branch`);
    const decodeBranch = byKey.get(decodeBranchEdge.z);
    assert(component(decodeBranch, C.Exec_Branch.NAME), `${prefix}decode acceptance branch`);
    const failureContinuation = one(outgoing(failureWriter,
      C.Exec_Var_Increment.NAME, 'ExecOut'), `${prefix}failure -> mark done`);
    const markFailedDone = byKey.get(failureContinuation.z);
    assert(component(markFailedDone, C.Exec_Var_Set.NAME), `${prefix}failed voice done writer`);
    assert.equal(one(outgoing(decodeBranch, C.Exec_Branch.NAME, 'ExecOutB'),
      `${prefix}old failed decode path`).z, failureWriter.key);

    bypassEdges.push(
      {a: call.key, at: C.FunctionCall.NAME, p: 'Completed',
        z: pitchWriter.key, zt: C.Exec_Var_Set.NAME, q: 'Exec'},
      {a: endWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut',
        z: decodePublication.key, zt: C.BufferTicks.NAME, q: 'Input'},
      {a: decodeBranch.key, at: C.Exec_Branch.NAME, p: 'ExecOutB',
        z: markFailedDone.key, zt: C.Exec_Var_Set.NAME, q: 'Exec'},
    );

    voices.push({voice, diagnosticLabels, diagnosticVars, diagnosticWriters,
      abortBranch, abortUnion, call, pitchWriter, velocityWriter, startWriter,
      endWriter, decodePublication, decodeBranch, markFailedDone});
  }

  assert.equal(removedKeys.size, voiceCount * 24,
    'eleven diagnostic Vars, eleven writers, branch and union per voice');

  // V5 generated one shared !running for start eligibility, then one identical
  // !running per voice for note shutdown. Reuse the shared result exactly.
  const running = context.continuousBodyPatch.running;
  assert(component(running, C.Var.NAME), 'retained running Var');
  const runningNotEdges = outgoing(running, C.Var.NAME, 'Value').filter(edge =>
    edge.zt === C.Expr_LogicalNOT.NAME && edge.q === 'bInput');
  assert.equal(runningNotEdges.length, voiceCount + 1,
    'one shared and one per-voice not-running gate');
  const notRunningGates = runningNotEdges.map(edge => byKey.get(edge.z));
  const sharedNotRunning = one(notRunningGates.filter(brick =>
    outgoing(brick, C.Expr_LogicalNOT.NAME, 'bOutput').some(edge =>
      edge.zt === C.Expr_LogicalAND.NAME)), 'shared not-running gate');
  const perVoiceNotRunning = notRunningGates.filter(brick => brick !== sharedNotRunning);
  assert.equal(perVoiceNotRunning.length, voiceCount);
  const notRunningTargets = [];
  for (const brick of perVoiceNotRunning) {
    const target = one(outgoing(brick, C.Expr_LogicalNOT.NAME, 'bOutput'),
      `${brick.key} one end-or-stop consumer`);
    assert.equal(target.zt, C.Expr_LogicalOR.NAME, `${brick.key} feeds end-or-stop OR`);
    assert.equal(target.q, 'bInputB', `${brick.key} feeds not-running input`);
    removedKeys.add(brick.key);
    notRunningTargets.push(edgeTarget(target));
    bypassEdges.push({a: sharedNotRunning.key, at: C.Expr_LogicalNOT.NAME, p: 'bOutput',
      ...edgeTarget(target)});
  }

  const before = {bricks: scene.bricks.length, edges: scene.edges.length,
    components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0)};
  const removedBricks = scene.bricks.filter(brick => removedKeys.has(brick.key));
  assert.equal(removedBricks.length, voiceCount * 25,
    '24 diagnostic bricks plus one duplicate not-running gate per voice');
  assert(removedBricks.every(brick => brick.comps.length === 1),
    'scheduler pruning removes single-component logic bricks only');
  const removedEdges = scene.edges.filter(edge =>
    removedKeys.has(edge.a) || removedKeys.has(edge.z)).map(edge => structuredClone(edge));
  scene.bricks = scene.bricks.filter(brick => !removedKeys.has(brick.key));
  scene.edges = scene.edges.filter(edge => !removedKeys.has(edge.a)
    && !removedKeys.has(edge.z));
  const targetIds = new Set(scene.edges.map(edge => `${edge.z}:${edge.zt}:${edge.q}`));
  for (const edge of bypassEdges) {
    assert(byKey.has(edge.a) && byKey.has(edge.z), 'bypass endpoints exist');
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targetIds.has(target), `unwired bypass target ${target}`);
    targetIds.add(target);
    scene.edges.push(edge);
  }
  const after = {bricks: scene.bricks.length, edges: scene.edges.length,
    components: scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0)};
  assert.deepEqual({bricks: before.bricks - after.bricks,
    edges: before.edges - after.edges,
    components: before.components - after.components},
  {bricks: voiceCount * 25, edges: voiceCount * 34, components: voiceCount * 25},
  'exact scheduler-pruning graph delta');
  assert.equal(bypassEdges.length, voiceCount * 4,
    'three decode bypasses and one shared not-running route per voice');

  return {voices, running, sharedNotRunning, perVoiceNotRunning, notRunningTargets,
    removedBricks, removedEdges, bypassEdges, before, after, logicGrid,
    constants: {
      VOICES: voiceCount,
      DIAGNOSTIC_BRICKS_PER_VOICE: 24,
      DUPLICATE_NOTS_PER_VOICE: 1,
      BYPASS_EDGES_PER_VOICE: 4,
      REMOVED_BRICKS: voiceCount * 25,
      REMOVED_EDGES_NET: voiceCount * 34,
      NORMAL_DECODE_EXECUTIONS_REMOVED: 11,
    }};
}

module.exports = {apply};
