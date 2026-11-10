'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const buildV10 = require('./build-sqm1-piano-player-v10.cjs');
const testV10 = require('./test-sqm1-piano-player-v10.cjs');
const exactCse = require('./apply-sqm1-exact-expression-cse-v1.cjs');
const validatePlacement = require('./validate-placement.cjs');
const {read, write} = require('./reskin-loadboard.cjs');

const component = (brick, type) => brick?.comps.find(item => item.type === type);
const components = scene => scene.bricks.reduce((sum, brick) => sum + brick.comps.length, 0);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;
const edgeId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p,
  z: edge.z, zt: edge.zt, q: edge.q});
const sourceId = edge => JSON.stringify({a: edge.a, at: edge.at, p: edge.p});

function semanticDescriptor(brick, edges) {
  assert.equal(brick.comps.length, 1, `one component on ${brick.key}`);
  const gate = brick.comps[0];
  const ports = brdb.COMPONENT_WIRE_PORTS.get(gate.type);
  assert(ports, `ports for ${gate.type}`);
  const effectiveData = structuredClone(gate.data);
  const inputs = {};
  for (const port of [...ports.inputs].sort()) {
    const incoming = edges.filter(edge => edge.z === brick.key
      && edge.zt === gate.type && edge.q === port);
    assert(incoming.length <= 1, `at most one ${brick.key}.${port} input`);
    if (incoming.length) {
      delete effectiveData[port];
      inputs[port] = {wire: {a: incoming[0].a, at: incoming[0].at, p: incoming[0].p}};
    } else if (Object.hasOwn(gate.data, port)) inputs[port] = {constant: gate.data[port]};
    else inputs[port] = {missing: true};
  }
  return {grid: brick.g, asset: brick.data.asset, type: gate.type, effectiveData, inputs};
}

function evaluate(type, inputs) {
  switch (type) {
    case C.Expr_LogicalNOT.NAME: return !Boolean(inputs.bInput);
    case C.Expr_LogicalAND.NAME: return Boolean(inputs.bInputA) && Boolean(inputs.bInputB);
    case C.Expr_CompareEqual.NAME: return inputs.InputA === inputs.InputB;
    case C.Expr_CompareGreaterOrEqual.NAME: return inputs.InputA >= inputs.InputB;
    case C.Expr_MathAdd.NAME: return Number(inputs.InputA) + Number(inputs.InputB);
    case C.Expr_MathMultiply.NAME: return Number(inputs.InputA) * Number(inputs.InputB);
    default: throw new Error(`unexpected duplicate operation ${type}`);
  }
}

function sampledValue(source, sample, boolean) {
  const text = sourceId(source);
  let hash = 0;
  for (const character of text) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  if (boolean) return Boolean((hash + sample) & 1);
  return [-2.5, -1, 0, 0.25, 1, 3.5][(hash + sample) % 6];
}

function evaluateDescriptor(descriptor, sample) {
  const values = {};
  for (const [port, input] of Object.entries(descriptor.inputs)) {
    if (input.wire) values[port] = sampledValue(input.wire, sample, port.startsWith('b'));
    else if (input.constant) values[port] = scalar(input.constant);
    else values[port] = port.startsWith('b') ? false : 0;
  }
  return evaluate(descriptor.type, values);
}

function fixture(runV10Test = false) {
  const context = buildV10();
  if (runV10Test) testV10(context);
  const before = {
    bricks: structuredClone(context.scene.bricks),
    edges: structuredClone(context.scene.edges),
    outputScene: context.outputScene,
  };
  const csePatch = exactCse.apply(context.scene, {
    hiddenLogicGrids: [context.singleSourcePatch.logicGrid],
  });
  const result = write(context.scene, {
    name: 'SQM1 V10.1 Exact Expression CSE Test Fixture',
    description: 'V10 with exact stateless expression commoning for structural validation.',
  });
  return {...context, before, csePatch, bytes: result.bytes, outputScene: read(result.bytes)};
}

function test(context) {
  const {scene, before, csePatch: patch, bytes, outputScene} = context;
  assert(scene && before && patch && bytes && outputScene, 'CSE test fixture');
  assert.deepEqual(patch.hiddenLogicGrids, [context.singleSourcePatch.logicGrid]);
  assert.equal(context.singleSourcePatch.logicGrid, 3, 'expected hidden V10 logic grid');
  assert.equal(patch.eligibleBricks, 5823, 'only stateless single-component expression gates');
  assert.equal(patch.topologicalCount, patch.eligibleBricks,
    'complete eligible expression graph is acyclic');
  assert.deepEqual(patch.constants, {
    GROUPS: 146,
    REMOVED_BRICKS: 216,
    REMOVED_EDGES: 334,
    REWRITTEN_EDGES: 219,
  });
  assert.deepEqual(patch.before, {bricks: 7838, edges: 13196});
  assert.deepEqual(patch.after, {bricks: 7622, edges: 12862});
  assert.equal(patch.groups.length, 146);
  assert.equal(patch.removedBricks.length, 216);
  assert.equal(patch.removedEdges.length, 334);
  assert.equal(patch.rewrittenEdges.length, 219);

  const expectedByType = {
    [C.Expr_LogicalNOT.NAME]: 27,
    [C.Expr_CompareEqual.NAME]: 48,
    [C.Expr_MathAdd.NAME]: 46,
    [C.Expr_CompareGreaterOrEqual.NAME]: 24,
    [C.Expr_LogicalAND.NAME]: 48,
    [C.Expr_MathMultiply.NAME]: 23,
  };
  const removedByType = {};
  for (const group of patch.groups) {
    removedByType[group.type] = (removedByType[group.type] || 0) + group.duplicateKeys.length;
  }
  assert.deepEqual(removedByType, expectedByType, 'exact duplicate operation budget');

  const beforeByKey = new Map(before.bricks.map(brick => [brick.key, brick]));
  const afterByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const duplicateKeys = new Set(patch.removedBricks.map(brick => brick.key));
  assert.equal(duplicateKeys.size, 216);
  assert.deepEqual([...patch.replacement.keys()].sort(), [...duplicateKeys].sort(),
    'every removed brick has one replacement');

  // Independently verify eligibility and exact semantic inputs/data for every
  // commoned group. Serialized fallback fields on wired ports are correctly
  // ignored because the exact wire source shadows them at runtime.
  for (const group of patch.groups) {
    assert.equal(group.canonicalKey, [...group.memberKeys].sort()[0],
      'deterministic lexicographic canonical key');
    assert.deepEqual(group.duplicateKeys, group.memberKeys.slice(1));
    const members = new Set(group.memberKeys);
    const canonical = semanticDescriptor(beforeByKey.get(group.canonicalKey), before.edges);
    assert.deepEqual(canonical, {
      grid: group.grid,
      asset: group.asset,
      type: group.type,
      effectiveData: group.effectiveData,
      inputs: group.inputs,
    }, `reported signature ${group.canonicalKey}`);
    for (const key of group.memberKeys) {
      const brick = beforeByKey.get(key);
      assert(brick, `retained pre-CSE member ${key}`);
      assert.equal(brick.g, 3, `${key} belongs only to hidden logic`);
      assert.equal(brick.comps.length, 1, `${key} has no interaction/secondary component`);
      assert(exactCse.PURE_EXPRESSION_TYPES.has(brick.comps[0].type),
        `${key} uses explicit pure allowlist`);
      assert.deepEqual(semanticDescriptor(brick, before.edges), canonical,
        `${key} has the exact canonical function and inputs`);
      for (const input of Object.values(canonical.inputs)) {
        if (input.wire) assert(!members.has(input.wire.a), `${key} group has no self source`);
      }
      for (let sample = 0; sample < 12; sample++) {
        assert.deepEqual(evaluateDescriptor(semanticDescriptor(brick, before.edges), sample),
          evaluateDescriptor(canonical, sample), `${key} truth-equivalent sample ${sample}`);
      }
    }
  }

  // Pin the relevant Boolean and numeric operation semantics used above.
  assert.equal(evaluate(C.Expr_LogicalNOT.NAME, {bInput: false}), true);
  assert.equal(evaluate(C.Expr_LogicalAND.NAME, {bInputA: true, bInputB: false}), false);
  assert.equal(evaluate(C.Expr_CompareEqual.NAME, {InputA: 3, InputB: 3}), true);
  assert.equal(evaluate(C.Expr_CompareGreaterOrEqual.NAME, {InputA: -1, InputB: 0}), false);
  assert.equal(evaluate(C.Expr_MathAdd.NAME, {InputA: -2, InputB: 3}), 1);
  assert.equal(evaluate(C.Expr_MathMultiply.NAME, {InputA: -2, InputB: 3}), -6);

  // Every surviving consumer is byte-exact except that a duplicate source is
  // replaced by its equivalent canonical source. No target or port changes.
  const expectedEdges = before.edges.filter(edge => !duplicateKeys.has(edge.z)).map(edge =>
    duplicateKeys.has(edge.a) ? {...edge, a: patch.replacement.get(edge.a)} : edge);
  assert.deepEqual(scene.edges.map(edgeId).sort(), expectedEdges.map(edgeId).sort(),
    'CSE performs only exact source substitution and dead-input removal');
  assert.deepEqual(patch.removedEdges.map(edgeId).sort(),
    before.edges.filter(edge => duplicateKeys.has(edge.z)).map(edgeId).sort(),
  'reported removed wires are every duplicate input');
  for (const rewrite of patch.rewrittenEdges) {
    assert(duplicateKeys.has(rewrite.before.a));
    assert.equal(rewrite.after.a, patch.replacement.get(rewrite.before.a));
    assert.deepEqual({...rewrite.after, a: rewrite.before.a}, rewrite.before,
      'rewritten edge changes only source brick');
  }

  for (const brick of before.bricks) {
    if (duplicateKeys.has(brick.key)) assert(!afterByKey.has(brick.key),
      `duplicate removed ${brick.key}`);
    else assert.deepEqual(afterByKey.get(brick.key), brick, `retained brick exact ${brick.key}`);
  }
  assert.deepEqual(outputScene.bricks.filter(brick => brick.g === 1),
    before.outputScene.bricks.filter(brick => brick.g === 1), 'visible UI remains byte-exact');
  assert.deepEqual(outputScene.r.externalAssets(), before.outputScene.r.externalAssets(),
    'external assets remain exact');

  assert.deepEqual({bricks: outputScene.bricks.length, edges: outputScene.edges.length,
    components: components(outputScene)}, {bricks: 7622, edges: 12862, components: 7630},
  'exact optimized graph budget');
  assert.equal(outputScene.bricks.filter(brick => component(brick,
    C.AudioEmitter.NAME)).length, 72, 'all audio emitters retained');
  assert.equal(outputScene.bricks.filter(brick => component(brick,
    C.Dampen.NAME)).length, 73, 'all envelope and recovery state retained');
  assert.equal(outputScene.bricks.filter(brick => component(brick,
    C.FunctionCall.NAME)).length, 24, 'all voice calls retained');
  assert.equal(outputScene.bricks.filter(brick => component(brick,
    C.OneShotAudioEmitter.NAME)).length, 0, 'no one-shot source introduced');

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

  console.log('SQM1 exact-expression CSE checks passed: exact V10 baseline, explicit stateless '
    + 'hidden-grid allowlist, acyclic graph, 146 exact function groups, 216 duplicate gates and '
    + '334 duplicate-input wires removed, 219 consumers equivalently rewritten, exact UI/audio/'
    + 'state retention, sampled truth equivalence, strict placement and deterministic valid wiring.');
  return {placement, patch};
}

module.exports = test;
module.exports.fixture = fixture;

if (require.main === module) {
  const first = fixture(true);
  test(first);
  const second = fixture(false);
  test(second);
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'exact-expression CSE composition rebuilds byte-for-byte');
}
