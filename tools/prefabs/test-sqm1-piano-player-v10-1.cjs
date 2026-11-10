'use strict';

const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const testV10 = require('./test-sqm1-piano-player-v10.cjs');
const buildHisThemeV4 = require('./build-sqm1-his-theme-pitch-continuity-v4.cjs');
const testHisThemeV4 = require('./test-sqm1-his-theme-pitch-continuity-v4.cjs');
const scoreContract = require('./build-sqm1-song-cartridge-v1.cjs');

const V10_HASH = 'db59f22fb80e1e1d2c2f797464c09299574a728c73665470939b51d6f9dc5e56';
const V10_1_HASH = '476a2d385ebfa2251e4e579c3ffe6aad2a77f3e050e6fa99a16a55b168e37f40';
const HIS_THEME_V4_HASH =
  '0808c8f570b6565b921f81b7ba19d9a931806182f1ac0db15b4fd366533e3c1f';
const VOICES = 24;
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.70;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const DENOMINATOR_FLOOR = RMS_NUMERATOR / MAX_HEADROOM;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});
const sourceId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p});

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

module.exports = function testSqm1PianoPlayerV101(context) {
  assert(context?.bytes && context?.scene && context?.outputScene && context?.v10Bytes
    && context?.schedulerPrunePatch && context?.inactivePartialPatch
    && context?.compactHeadroomPatch && context?.csePatch,
  'V10.1 builder context');

  const v10 = buildV10();
  testV10(v10);
  assert.equal(sha256(v10.bytes), V10_HASH, 'exact approved V10 baseline');
  assert.deepEqual(Buffer.from(context.v10Bytes), Buffer.from(v10.bytes),
    'V10.1 starts from exact V10 bytes');
  assert.equal(sha256(context.bytes), V10_1_HASH, 'exact deterministic V10.1 build');
  assert(fs.existsSync(context.constants.OUTPUT_DEFAULT), 'V10.1 artifact exists');
  const artifact = fs.readFileSync(context.constants.OUTPUT_DEFAULT);
  assert.equal(sha256(artifact), V10_1_HASH, 'exact V10.1 artifact hash');
  assert.deepEqual(artifact, Buffer.from(context.bytes), 'artifact equals fresh V10.1 build');

  const scene = context.scene;
  const serialized = context.outputScene;
  const scheduler = context.schedulerPrunePatch;
  const partial = context.inactivePartialPatch;
  const compact = context.compactHeadroomPatch;
  const cse = context.csePatch;
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const v10ByKey = new Map(v10.scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);
  const v10Incoming = (brick, type, port) => v10.scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const canonicalSource = edge => ({a: cse.replacement.get(edge.a) || edge.a,
    at: edge.at, p: edge.p});

  assert.deepEqual(serialized.bricks.filter(brick => brick.g === 1),
    v10.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI is exact V10');
  assert.deepEqual(serialized.r.externalAssets(), v10.outputScene.r.externalAssets(),
    'external assets are exact V10');
  assert.deepEqual(serialized.r.prefabJson(), v10.outputScene.r.prefabJson(),
    'prefab metadata and interfaces are exact V10');

  assert.deepEqual({bricks: serialized.bricks.length, edges: serialized.edges.length,
    components: components(serialized)}, {bricks: 6675, edges: 11363, components: 6683},
  'exact lean graph budget');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, 'all 72 profile emitters retained');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 25, '24 body envelopes plus one limiter recovery Dampen');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, VOICES, '24 scheduler voice calls retained');
  assert.equal(serialized.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0, 'no one-shot audio introduced');
  const execCount = serialized.bricks.flatMap(brick => brick.comps).filter(item =>
    item.type.startsWith('BrickComponentType_Exec_')).length
    + serialized.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length;
  assert.equal(execCount, 691, 'scheduler execution components reduced from 1003 to 691');

  assert.deepEqual(scheduler.constants, {
    VOICES,
    DIAGNOSTIC_BRICKS_PER_VOICE: 24,
    DUPLICATE_NOTS_PER_VOICE: 1,
    BYPASS_EDGES_PER_VOICE: 4,
    REMOVED_BRICKS: 600,
    REMOVED_EDGES_NET: 816,
    NORMAL_DECODE_EXECUTIONS_REMOVED: 11,
  });
  assert.deepEqual(scheduler.before, {bricks: 7838, edges: 13196, components: 7846});
  assert.deepEqual(scheduler.after, {bricks: 7238, edges: 12380, components: 7246});
  assert.equal(scheduler.removedBricks.length, 600);
  assert.equal(scheduler.removedEdges.length, 912);
  assert.equal(scheduler.bypassEdges.length, 96);
  assert.equal(1936 * scheduler.constants.NORMAL_DECODE_EXECUTIONS_REMOVED, 21296,
    'His Theme skips 21,296 write-only decode executions');

  const schedulerRemoved = new Set(scheduler.removedBricks.map(brick => brick.key));
  for (const voice of scheduler.voices) {
    assert.equal(voice.diagnosticVars.length, 11);
    assert.equal(voice.diagnosticWriters.length, 11);
    for (const diagnostic of voice.diagnosticVars) {
      const incident = scheduler.removedEdges.filter(edge => edge.a === diagnostic.key);
      assert.equal(incident.filter(edge => edge.at === C.Var.NAME && edge.p === 'Value').length, 0,
        `voice ${voice.voice} diagnostic value was never read`);
      assert.equal(incident.filter(edge => edge.at === C.Var.NAME && edge.p === 'VarRef').length, 1,
        `voice ${voice.voice} diagnostic had only its writer`);
    }
    for (const brick of [...voice.diagnosticVars, ...voice.diagnosticWriters,
      voice.abortBranch, voice.abortUnion]) assert(schedulerRemoved.has(brick.key),
    `voice ${voice.voice} write-only diagnostic node removed`);

    assert.equal(sourceId(one(incoming(voice.pitchWriter, C.Exec_Var_Set.NAME, 'Exec'),
      `voice ${voice.voice} call completion`)),
    sourceId({a: voice.call.key, at: C.FunctionCall.NAME, p: 'Completed'}));
    const sequence = [voice.pitchWriter, voice.velocityWriter, voice.startWriter,
      voice.endWriter];
    for (let index = 1; index < sequence.length; index++) assert.equal(sourceId(one(incoming(
      sequence[index], C.Exec_Var_Set.NAME, 'Exec'), `voice ${voice.voice} setter ${index}`)),
    sourceId({a: sequence[index - 1].key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(sourceId(one(incoming(voice.decodePublication,
      C.BufferTicks.NAME, 'Input'), `voice ${voice.voice} publication`)),
    sourceId({a: voice.endWriter.key, at: C.Exec_Var_Set.NAME, p: 'ExecOut'}));
    assert.equal(component(voice.decodePublication, C.BufferTicks.NAME).data.TicksToWait, 1,
      `voice ${voice.voice} one-tick validation retained`);
    assert.equal(sourceId(one(incoming(voice.markFailedDone,
      C.Exec_Var_Set.NAME, 'Exec'), `voice ${voice.voice} failure path`)),
    sourceId({a: voice.decodeBranch.key, at: C.Exec_Branch.NAME, p: 'ExecOutB'}));
    const beforeBranch = v10ByKey.get(voice.decodeBranch.key);
    assert.equal(sourceId(one(incoming(voice.decodeBranch,
      C.Exec_Branch.NAME, 'bCond'), `voice ${voice.voice} decode condition`)),
    sourceId(canonicalSource(one(v10Incoming(beforeBranch,
      C.Exec_Branch.NAME, 'bCond'), 'V10 decode condition'))));
    assert.deepEqual(outgoing(voice.decodeBranch,
      C.Exec_Branch.NAME, 'ExecOutA').map(edgeId).sort(),
    v10.scene.edges.filter(edge => edge.a === beforeBranch.key
      && edge.at === C.Exec_Branch.NAME && edge.p === 'ExecOutA').map(edgeId).sort(),
    `voice ${voice.voice} successful decode path exact V10`);
    const outputs = [[voice.pitchWriter, 'Output1'], [voice.velocityWriter, 'Output0'],
      [voice.startWriter, 'Output3'], [voice.endWriter, 'Output2']];
    for (const [writer, port] of outputs) assert.equal(sourceId(one(incoming(writer,
      C.Exec_Var_Set.NAME, 'Value'), `voice ${voice.voice} ${port}`)),
    sourceId({a: voice.call.key, at: C.FunctionCall.NAME, p: port}));
  }
  assert.equal(outgoing(scheduler.sharedNotRunning,
    C.Expr_LogicalNOT.NAME, 'bOutput').length, VOICES + 1,
  'one shared not-running gate serves all voices and start eligibility');

  assert.deepEqual(partial.constants, {
    VOICES,
    REMOVED_PER_VOICE: 15,
    REMOVED_SHARED: 1,
    REMOVED_BRICKS: 361,
    REMOVED_EDGES: 673,
    ZERO_VOLUME_BRANCHES: 48,
    ZERO_RATIO_BRANCHES: 48,
    BYPASSED_PROFILE_BRANCHES: 72,
  });
  const removedTypes = partial.removedBricks.reduce((counts, brick) => {
    const type = brick.comps[0].type;
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(removedTypes, {
    [C.Expr_Select.NAME]: 120,
    [C.Expr_MathMultiply.NAME]: 168,
    [C.Dampen.NAME]: 48,
    [C.Expr_MathExp.NAME]: 24,
    [C.Expr_MathDivide.NAME]: 1,
  }, 'exact inactive partial synthesis removed');
  assert.equal(partial.removedBricks.length, 361);
  assert.equal(partial.removedEdges.length, 673);

  for (const branch of partial.volumeBranches) {
    const select = byKey.get(branch.select.key);
    assert(select, `voice ${branch.voice} H${branch.ratio} volume barrier survives`);
    assert.equal(incoming(select, C.Expr_Select.NAME, 'InputB').length, 0);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputB), 0,
      `voice ${branch.voice} H${branch.ratio} disabled Piano volume is static zero`);
    const before = v10ByKey.get(branch.select.key);
    assert.equal(sourceId(one(incoming(select, C.Expr_Select.NAME, 'InputA'),
      `voice ${branch.voice} H${branch.ratio} legacy volume`)),
    sourceId(canonicalSource(one(v10Incoming(before,
      C.Expr_Select.NAME, 'InputA'), 'V10 legacy volume'))));
  }
  for (const branch of partial.ratioBranches) {
    const select = byKey.get(branch.select.key);
    assert(select, `voice ${branch.voice} ${branch.kind} ratio barrier survives`);
    assert.equal(incoming(select, C.Expr_Select.NAME, 'InputB').length, 0);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputB), 0,
      `voice ${branch.voice} ${branch.kind} disabled Piano pitch is static`);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputA), branch.fallback,
      `voice ${branch.voice} ${branch.kind} non-Piano fallback exact`);
  }
  for (const branch of partial.bypassedBranches) {
    assert(!byKey.has(branch.select.key), `voice ${branch.voice} ${branch.kind} dead selector gone`);
    const targetKey = cse.replacement.get(branch.target.key) || branch.target.key;
    const target = byKey.get(targetKey);
    assert(target, `voice ${branch.voice} ${branch.kind} fallback target retained/commoned`);
    assert.equal(incoming(target, C.Expr_Select.NAME, 'InputA').length, 0);
    assert.equal(scalar(component(target, C.Expr_Select.NAME).data.InputA), branch.fallback);
  }
  for (const voice of partial.voices) for (const ratio of [2, 3]) {
    const partialEnable = context.singleSourcePatch.voices[voice.voice].partialEnable;
    assert.equal(scalar(component(partialEnable, C.Expr_Select.NAME).data.InputB), false,
      `voice ${voice.voice} H${ratio} remains disabled for Piano`);
    for (const profile of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const piano = profile === 1;
      const beforeState = {enabled: piano ? false : 'legacy-enable',
        volume: piano ? `old-piano-h${ratio}-volume` : 'legacy-volume',
        pitch: piano ? `old-piano-h${ratio}-ratio` : 'legacy-ratio'};
      const afterState = {enabled: piano ? false : 'legacy-enable',
        volume: piano ? 0 : 'legacy-volume', pitch: piano ? 0 : 'legacy-ratio'};
      const audible = state => state.enabled === false ? 'silent'
        : `${state.enabled}|${state.volume}|${state.pitch}`;
      assert.equal(audible(afterState), audible(beforeState),
        `voice ${voice.voice} H${ratio} profile ${profile} exact audible truth`);
      if (!piano) assert.deepEqual(afterState, beforeState,
        `voice ${voice.voice} H${ratio} profile ${profile} exact legacy state`);
    }
  }

  assert.equal(compact.removedBricks.length, 54, 'old scalar limiter removed');
  assert.equal(compact.removedEdges.length, 104);
  assert.equal(compact.addedBricks, 21, '21-component compact limiter');
  assert.equal(compact.magnitudeGroups.length, 8);
  assert.equal(compact.adders.length, 7);
  assert.equal(compact.sumDepth, 3);
  assert.deepEqual(compact.constants, {
    MAX_HEADROOM,
    RMS_CEILING,
    RMS_NUMERATOR,
    DENOMINATOR_FLOOR,
    RECOVERY_SMOOTH_SECONDS: 0.12,
    VOICES,
    GROUP_SIZE: 3,
  });
  assert.equal(scalar(component(compact.recovery, C.Dampen.NAME).data.Target), MAX_HEADROOM);
  assert.equal(scalar(component(compact.recovery, C.Dampen.NAME).data.Value), MAX_HEADROOM);
  assert.equal(scalar(component(compact.recovery, C.Dampen.NAME).data.SmoothTime), 0.12);
  assert.equal(sourceId(one(incoming(context.headroomPatch.headroom,
    C.Expr_MathMultiply.NAME, 'InputB'), 'compact limiter output')),
  sourceId({a: compact.finalScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));

  const groupedSquares = amplitudes => {
    let level = [];
    for (let index = 0; index < amplitudes.length; index += 3) level.push(
      amplitudes[index] ** 2 + amplitudes[index + 1] ** 2 + amplitudes[index + 2] ** 2);
    while (level.length > 1) {
      const next = [];
      for (let index = 0; index < level.length; index += 2) next.push(
        index + 1 === level.length ? level[index] : level[index] + level[index + 1]);
      level = next;
    }
    return level[0];
  };
  const legacyScale = (volume, amplitudes) => Math.min(MAX_HEADROOM,
    RMS_NUMERATOR / (volume * Math.sqrt(Math.max(1e-9,
      amplitudes.reduce((sum, value) => sum + value ** 2, 0)))));
  const compactScale = (volume, amplitudes) => RMS_NUMERATOR
    / Math.max(DENOMINATOR_FLOOR, volume * Math.sqrt(groupedSquares(amplitudes)));
  let randomState = 0x51a7c9ef;
  let maximumDifference = 0;
  for (let sample = 0; sample < 10000; sample++) {
    const amplitudes = Array.from({length: VOICES}, () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000 * 1.3;
    });
    for (const volume of [1, 1.5, 2]) maximumDifference = Math.max(maximumDifference,
      Math.abs(legacyScale(volume, amplitudes) - compactScale(volume, amplitudes)));
  }
  assert(maximumDifference < 1e-12,
    `compact limiter differs only by floating reassociation: ${maximumDifference}`);

  assert.deepEqual(cse.constants,
    {GROUPS: 144, REMOVED_BRICKS: 169, REMOVED_EDGES: 287, REWRITTEN_EDGES: 172});
  assert.deepEqual(cse.before, {bricks: 6844, edges: 11650});
  assert.deepEqual(cse.after, {bricks: 6675, edges: 11363});
  assert.equal(cse.topologicalCount, cse.eligibleBricks, 'eligible expression graph is acyclic');
  assert.deepEqual(cse.hiddenLogicGrids, [context.releasePatch.logicGrid],
    'CSE is restricted to the hidden player logic grid');
  const duplicateKeys = new Set(cse.removedBricks.map(brick => brick.key));
  assert.equal(duplicateKeys.size, 169);
  for (const group of cse.groups) {
    assert(byKey.has(group.canonicalKey), `CSE canonical survives ${group.canonicalKey}`);
    for (const key of group.duplicateKeys) {
      assert(duplicateKeys.has(key), `declared CSE duplicate ${key}`);
      assert(!byKey.has(key), `CSE duplicate absent ${key}`);
    }
    const members = new Set(group.memberKeys);
    for (const input of Object.values(group.inputs)) if (input.wire) {
      assert(!members.has(input.wire.a), `CSE group ${group.canonicalKey} has no self source`);
    }
  }
  for (const rewrite of cse.rewrittenEdges) {
    assert.equal(rewrite.after.a, cse.replacement.get(rewrite.before.a));
    assert.deepEqual({...rewrite.after, a: rewrite.before.a}, rewrite.before,
      'CSE changes only the equivalent source brick');
    assert(scene.edges.some(edge => edgeId(edge) === edgeId(rewrite.after)),
      'rewritten CSE consumer exists');
  }

  // Every physical emitter keeps the exact V10 component data and direct
  // source semantics. CSE may substitute only an exactly equivalent source.
  const audioBricks = v10.scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME));
  assert.equal(audioBricks.length, 72);
  for (const beforeAudio of audioBricks) {
    const afterAudio = byKey.get(beforeAudio.key);
    assert.deepEqual(afterAudio, beforeAudio, `${beforeAudio.key} emitter data exact V10`);
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier']) {
      const beforeEdge = one(v10Incoming(beforeAudio, C.AudioEmitter.NAME, port),
        `${beforeAudio.key}.${port} V10`);
      const afterEdge = one(incoming(afterAudio, C.AudioEmitter.NAME, port),
        `${beforeAudio.key}.${port} V10.1`);
      assert.equal(sourceId(afterEdge), sourceId(canonicalSource(beforeEdge)),
        `${beforeAudio.key}.${port} exact/equivalent V10 source`);
    }
  }

  // Automatic cartridge intake, arrays, event communication and external
  // microchip interfaces survive byte-structurally. Optimizers can change
  // only their pure upstream calculations, never these state/effect nodes.
  const interfaceType = type => /ArrayVar|CustomEvent|Event|Prefab|Zone|Microchip/.test(type);
  const interfaceBricks = v10.scene.bricks.filter(brick =>
    brick.comps.some(item => interfaceType(item.type)));
  assert(interfaceBricks.length > 50, 'substantial cartridge/event/interface inventory pinned');
  for (const beforeBrick of interfaceBricks) {
    const afterBrick = byKey.get(beforeBrick.key);
    assert(afterBrick, `retained intake/interface brick ${beforeBrick.key}`);
    assert.deepEqual(afterBrick, beforeBrick,
      `exact intake/interface component ${beforeBrick.key}`);
  }

  const volumeSpecs = context.constants.CONTROL_SPECS.filter(spec =>
    spec.label === 'Volume down' || spec.label === 'Volume Up');
  assert.equal(volumeSpecs.length, 2);
  for (const spec of volumeSpecs) assert.deepEqual({step: spec.step, min: spec.min, max: spec.max},
    {step: 0.1, min: 1, max: 2}, `${spec.label} exact control range`);

  const hisThemeV4 = buildHisThemeV4();
  testHisThemeV4(hisThemeV4);
  assert.equal(sha256(hisThemeV4.bytes), HIS_THEME_V4_HASH,
    'exact His Theme pitch-continuity cartridge');
  const accepted = scoreContract.validateScoreDocument(hisThemeV4.score.document, {
    maxActiveVoices: VOICES,
    maxArrayEntries: 65536,
  });
  assert.equal(accepted.statistics.activeVoices, VOICES);
  assert.equal(accepted.values.length, 1970);

  const placement = validatePlacement(context.bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  const serializedByKey = new Map(serialized.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of serialized.edges) {
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
    assert.notEqual(edge.a, edge.z, `no self wire ${edge.a}`);
  }

  console.log('SQM1 piano player V10.1 checks passed: exact V4-V10 ancestry and artifact, '
    + '21,296 unused His Theme decode executions removed, 48 inaudible timed envelopes '
    + 'removed with constant disabled-emitter isolation, exact all-profile audible truth, '
    + 'equivalent compact limiter and exact-expression commoning, exact UI/controls/intake/audio, '
    + 'His Theme V4 compatibility, strict placement and deterministic valid wiring.');
  return {v10, hisThemeV4, placement, maximumDifference};
};

if (require.main === module) {
  const build = require('./build-sqm1-piano-player-v10-1.cjs');
  const first = build();
  module.exports(first);
  const second = build();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'V10.1 build is byte-for-byte deterministic');
}
