'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const testV10 = require('./test-sqm1-piano-player-v10.cjs');
const inactivePartialPrune = require('./apply-sqm1-piano-inactive-partial-prune-v1.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const VOICES = 24;
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

function fixture(runV10Test = false) {
  const context = buildV10();
  if (runV10Test) testV10(context);
  const v10Bytes = Buffer.from(context.bytes);
  const v10OutputScene = context.outputScene;
  const before = {
    bricks: structuredClone(context.scene.bricks),
    edges: structuredClone(context.scene.edges),
  };
  const inactivePartialPatch = inactivePartialPrune.apply(context.scene,
    context.pianoPatch, context.releasePatch);
  const result = write(context.scene, {
    name: 'SQM1 V10.1 Inactive Partial Prune Test',
    description: 'V10 with mathematically inaudible Piano partial synthesis removed while '
      + 'retaining zero-output isolation at disabled emitter volume and pitch ports.',
  });
  return {...context, bytes: result.bytes, outputScene: read(result.bytes),
    v10Bytes, v10OutputScene, before, inactivePartialPatch};
}

function test(context) {
  const {scene, bytes, outputScene, v10Bytes, v10OutputScene, before,
    inactivePartialPatch: patch} = context;
  assert(scene && bytes && outputScene && v10Bytes && v10OutputScene && before && patch,
    'inactive-partial prune fixture');
  assert.deepEqual(patch.constants, {
    VOICES,
    REMOVED_PER_VOICE: 15,
    REMOVED_SHARED: 1,
    REMOVED_BRICKS: 361,
    REMOVED_EDGES: 673,
    ZERO_VOLUME_BRANCHES: 48,
    ZERO_RATIO_BRANCHES: 48,
    BYPASSED_PROFILE_BRANCHES: 72,
  });
  assert.equal(patch.voices.length, VOICES);
  assert.equal(patch.removedBricks.length, 361);
  assert.equal(patch.removedEdges.length, 673);
  assert.equal(patch.volumeBranches.length, 48);
  assert.equal(patch.ratioBranches.length, 48);
  assert.equal(patch.bypassedBranches.length, 72);

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const beforeIncoming = (brick, type, port) => before.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const beforeOutgoing = (brick, type, port) => before.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));

  const removedKeys = new Set(patch.removedBricks.map(brick => brick.key));
  assert.equal(removedKeys.size, 361);
  assert(patch.removedBricks.every(brick => !byKey.has(brick.key)),
    'every declared inactive brick is absent');
  const typeCounts = patch.removedBricks.reduce((counts, brick) => {
    assert.equal(brick.comps.length, 1, `single component on removed ${brick.key}`);
    const type = brick.comps[0].type;
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(typeCounts, {
    [C.Expr_Select.NAME]: 120,
    [C.Expr_MathMultiply.NAME]: 168,
    [C.Dampen.NAME]: 48,
    [C.Expr_MathExp.NAME]: 24,
    [C.Expr_MathDivide.NAME]: 1,
  }, 'exact removed runtime component types');

  // This patch removes edges only. Every surviving edge is the exact V10 edge,
  // which pins transport, controls, intake, UI, body audio and non-Piano paths.
  const beforeEdgeIds = new Set(before.edges.map(edgeId));
  const afterEdgeIds = new Set(scene.edges.map(edgeId));
  const removedEdges = before.edges.filter(edge => !afterEdgeIds.has(edgeId(edge)));
  const addedEdges = scene.edges.filter(edge => !beforeEdgeIds.has(edgeId(edge)));
  assert.equal(addedEdges.length, 0, 'no new route can change V10 audio or controls');
  assert.deepEqual(removedEdges.map(edgeId).sort(), patch.removedEdges.map(edgeId).sort(),
    'patch reports every removed edge');
  assert(patch.removedEdges.every(edge => removedKeys.has(edge.a) || removedKeys.has(edge.z)),
    'every removed edge is incident to a removed component');

  // Only the two zero-isolation selectors and three bypass targets per lane
  // are retained mutations. Every other retained brick is byte-structurally V10.
  const mutatedKeys = new Set([
    ...patch.volumeBranches.map(branch => branch.select.key),
    ...patch.ratioBranches.map(branch => branch.select.key),
    ...patch.bypassedBranches.map(branch => branch.target.key),
  ]);
  assert.equal(mutatedKeys.size, VOICES * 7, 'seven retained data mutations per lane');
  for (const brick of before.bricks) {
    if (removedKeys.has(brick.key) || mutatedKeys.has(brick.key)) continue;
    assert.deepEqual(byKey.get(brick.key), brick, `untouched V10 brick ${brick.key}`);
  }

  // Exact audible truth table for the default profile zero and all seven
  // resolved profiles. Profile 1 is Piano, where both partial emitters remain
  // disabled and their volume/ratio branches are exact zero. Profiles 0 and
  // 2..7 take the exact retained V10 legacy branch for enable, volume and pitch.
  for (const voice of patch.voices) {
    const number = voice.voice;
    const isPiano = voice.isPiano;
    assert.equal(scalar(component(isPiano, C.Expr_CompareEqual.NAME).data.InputB), 1,
      `voice ${number} Piano is profile 1`);
    const singleVoice = context.singleSourcePatch.voices[number];
    const h2 = singleVoice.harmonics.find(harmonic => harmonic.ratio === 2);
    const h3 = singleVoice.harmonics.find(harmonic => harmonic.ratio === 3);
    const partialEnable = singleVoice.partialEnable;
    assert.equal(scalar(component(partialEnable, C.Expr_Select.NAME).data.InputB), false,
      `voice ${number} Piano partial enable is exact false`);
    assert.equal(sourceId(one(incoming(partialEnable, C.Expr_Select.NAME, 'bSelectB'),
      `voice ${number} partial profile`)),
    sourceId({a: isPiano.key, at: C.Expr_CompareEqual.NAME, p: 'bOutput'}));
    const legacyEnable = one(incoming(partialEnable, C.Expr_Select.NAME, 'InputA'),
      `voice ${number} exact legacy partial enable`);
    const beforeLegacyEnable = one(beforeIncoming(partialEnable,
      C.Expr_Select.NAME, 'InputA'), `voice ${number} prior legacy partial enable`);
    assert.equal(edgeId(legacyEnable), edgeId(beforeLegacyEnable));
    assert.equal(sourceId(one(incoming(h2.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `voice ${number} H2 enable`)),
    sourceId({a: partialEnable.key, at: C.Expr_Select.NAME, p: 'Output'}));
    const h3Policy = context.denseProfilePatch.voices[number].h3DensePolicy;
    assert.equal(sourceId(one(incoming(h3Policy, C.Expr_LogicalAND.NAME, 'bInputA'),
      `voice ${number} H3 profile enable`)),
    sourceId({a: partialEnable.key, at: C.Expr_Select.NAME, p: 'Output'}));
    assert.equal(sourceId(one(incoming(h3.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `voice ${number} H3 enable`)),
    sourceId({a: h3Policy.key, at: C.Expr_LogicalAND.NAME, p: 'bOutput'}));

    for (const ratio of [2, 3]) for (const profile of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const piano = profile === 1;
      const beforeState = {
        enabled: piano ? false : 'legacy-enable',
        volume: piano ? `old-piano-h${ratio}-volume` : 'legacy-volume',
        pitch: piano ? `old-piano-h${ratio}-ratio` : 'legacy-ratio',
      };
      const afterState = {
        enabled: piano ? false : 'legacy-enable',
        volume: piano ? 0 : 'legacy-volume',
        pitch: piano ? 0 : 'legacy-ratio',
      };
      const audible = state => state.enabled === false ? 'silent'
        : `${state.enabled}|${state.volume}|${state.pitch}`;
      assert.equal(audible(afterState), audible(beforeState),
        `voice ${number} H${ratio} profile ${profile} exact audible truth`);
      if (!piano) assert.deepEqual(afterState, beforeState,
        `voice ${number} H${ratio} profile ${profile} exact legacy values`);
    }
  }

  for (const branch of patch.volumeBranches) {
    const select = byKey.get(branch.select.key);
    const beforeSelect = beforeByKey.get(branch.select.key);
    assert(select && beforeSelect, `voice ${branch.voice} H${branch.ratio} volume selector`);
    assert.equal(incoming(select, C.Expr_Select.NAME, 'InputB').length, 0,
      `voice ${branch.voice} H${branch.ratio} removed dead Piano volume wire`);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputB), 0,
      `voice ${branch.voice} H${branch.ratio} Piano volume is exact zero`);
    assert.deepEqual(incoming(select, C.Expr_Select.NAME, 'InputA').map(edgeId),
      beforeIncoming(beforeSelect, C.Expr_Select.NAME, 'InputA').map(edgeId),
    `voice ${branch.voice} H${branch.ratio} exact legacy volume branch`);
    assert.deepEqual(incoming(select, C.Expr_Select.NAME, 'bSelectB').map(edgeId),
      beforeIncoming(beforeSelect, C.Expr_Select.NAME, 'bSelectB').map(edgeId),
    `voice ${branch.voice} H${branch.ratio} exact profile condition`);
    assert.deepEqual(outgoing(select, C.Expr_Select.NAME, 'Output').map(edgeId),
      beforeOutgoing(beforeSelect, C.Expr_Select.NAME, 'Output').map(edgeId),
    `voice ${branch.voice} H${branch.ratio} exact emitter volume route`);
  }

  for (const branch of patch.ratioBranches) {
    const select = byKey.get(branch.select.key);
    const beforeSelect = beforeByKey.get(branch.select.key);
    assert.equal(incoming(select, C.Expr_Select.NAME, 'InputB').length, 0);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputB), 0,
      `voice ${branch.voice} ${branch.kind} Piano ratio is exact zero`);
    assert.equal(scalar(component(select, C.Expr_Select.NAME).data.InputA), branch.fallback,
      `voice ${branch.voice} ${branch.kind} non-Piano fallback exact`);
    assert.deepEqual(incoming(select, C.Expr_Select.NAME, 'bSelectB').map(edgeId),
      beforeIncoming(beforeSelect, C.Expr_Select.NAME, 'bSelectB').map(edgeId));
    assert.deepEqual(outgoing(select, C.Expr_Select.NAME, 'Output').map(edgeId),
      beforeOutgoing(beforeSelect, C.Expr_Select.NAME, 'Output').map(edgeId),
    `voice ${branch.voice} ${branch.kind} exact remaining profile chain`);

    // Profiles 2..7 are the only later overrides. At Piano profile 1 every
    // later condition is false, so zero passes through the entire ratio chain
    // and prevents retunes from reaching disabled emitter pitch ports.
    let current = select;
    const laterProfiles = [];
    while (true) {
      const output = one(outgoing(current, C.Expr_Select.NAME, 'Output'),
        `voice ${branch.voice} ${branch.kind} chain output`);
      const target = byKey.get(output.z);
      if (!component(target, C.Expr_Select.NAME) || output.q !== 'InputA') break;
      const condition = one(incoming(target, C.Expr_Select.NAME, 'bSelectB'),
        `voice ${branch.voice} ${branch.kind} later profile`);
      const compare = byKey.get(condition.a);
      assert(component(compare, C.Expr_CompareEqual.NAME));
      laterProfiles.push(scalar(component(compare, C.Expr_CompareEqual.NAME).data.InputB));
      current = target;
    }
    assert.deepEqual(laterProfiles.sort((a, b) => a - b), [2, 3, 4, 5, 6, 7],
      `voice ${branch.voice} ${branch.kind} zero survives profile 1`);
  }

  for (const branch of patch.bypassedBranches) {
    assert(!byKey.has(branch.select.key),
      `voice ${branch.voice} ${branch.kind} dead bottom selector removed`);
    const target = byKey.get(branch.target.key);
    assert.equal(incoming(target, C.Expr_Select.NAME, 'InputA').length, 0,
      `voice ${branch.voice} ${branch.kind} bypass is now constant`);
    assert.equal(scalar(component(target, C.Expr_Select.NAME).data.InputA), branch.fallback,
      `voice ${branch.voice} ${branch.kind} exact non-Piano fallback retained`);
  }

  // Body emitters and their ports are exact V10. The body profile-smoothing
  // Piano branch remains the V10 flush selector; all non-Piano branches retain
  // the same constants and later profile overrides after the bottom bypass.
  for (const voice of context.singleSourcePatch.voices) {
    const body = voice.body.emitter;
    const beforeBody = beforeByKey.get(body.key);
    for (const port of ['bEnabled', 'VolumeMultiplier', 'PitchMultiplier']) {
      assert.deepEqual(incoming(body, C.AudioEmitter.NAME, port).map(edgeId),
        beforeIncoming(beforeBody, C.AudioEmitter.NAME, port).map(edgeId),
      `voice ${voice.voice} body ${port} is exact V10`);
    }
    const profileSmooth = context.pianoPatch.voices[voice.voice].body.profileSmooth;
    assert.deepEqual(incoming(profileSmooth, C.Expr_Select.NAME, 'InputB').map(edgeId),
      beforeIncoming(beforeByKey.get(profileSmooth.key), C.Expr_Select.NAME, 'InputB').map(edgeId),
    `voice ${voice.voice} Piano body smoothing remains exact V10`);
  }

  assert.deepEqual({bricks: scene.bricks.length, edges: scene.edges.length,
    components: components(scene)}, {bricks: 7477, edges: 12523, components: 7485},
  'exact conservative inactive-partial graph budget');
  assert.equal(scene.bricks.filter(brick => component(brick, C.Dampen.NAME)).length, 25,
    '24 audible body envelopes plus one adaptive recovery Dampen');
  assert.equal(scene.bricks.filter(brick => component(brick, C.AudioEmitter.NAME)).length, 72,
    'all instrument-profile emitters retained');
  assert.equal(scene.bricks.filter(brick => component(brick, C.FunctionCall.NAME)).length, 24,
    'scheduler voice calls retained');

  // UI, assets, prefab metadata, controls and automatic cartridge intake are
  // outside the removal/mutation set and serialize exactly as V10.
  assert.deepEqual(outputScene.bricks.filter(brick => brick.g === 1),
    v10OutputScene.bricks.filter(brick => brick.g === 1), 'visible UI exact V10');
  assert.deepEqual(outputScene.r.externalAssets(), v10OutputScene.r.externalAssets(),
    'external assets exact V10');
  assert.deepEqual(outputScene.r.prefabJson(), v10OutputScene.r.prefabJson(),
    'prefab metadata exact V10');
  assert.deepEqual(Buffer.from(v10Bytes), Buffer.from(buildV10().bytes),
    'V10 baseline remains byte-exact and unmodified');

  const placement = validatePlacement(bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  assert.deepEqual({invalid: placement.invalidBricks.length,
    confirmed: placement.confirmedPairs.length,
    uncertain: placement.uncertainPairs.length,
    warnings: placement.warnings.length},
  {invalid: 0, confirmed: 0, uncertain: 0, warnings: 0});

  const serializedByKey = new Map(outputScene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of outputScene.edges) {
    const source = serializedByKey.get(edge.a);
    const target = serializedByKey.get(edge.z);
    assert(source?.comps.some(item => item.type === edge.at), `valid source ${edge.a}`);
    assert(target?.comps.some(item => item.type === edge.zt), `valid target ${edge.z}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
    const targetId = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(targetId), `unique target ${targetId}`);
    targets.add(targetId);
  }

  console.log('SQM1 inactive Piano partial prune checks passed: exact V4-V10 baseline, 361 '
    + 'provably inaudible components and 48 unused Dampens removed, constant-zero disabled '
    + 'emitter volume/ratio isolation, exhaustive eight-profile enable/volume/pitch truth, exact '
    + 'body/UI/controls/intake retention, strict placement and deterministic valid wiring.');
  return {placement, removedKeys, mutatedKeys};
}

module.exports = test;
module.exports.fixture = fixture;

if (require.main === module) {
  const first = fixture(true);
  test(first);
  const second = fixture(false);
  test(second);
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'inactive-partial prune rebuilds byte-for-byte');
}
