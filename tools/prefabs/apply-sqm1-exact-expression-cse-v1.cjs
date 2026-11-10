'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');

// Explicitly list stateless expression components. EdgeDetectorExec and every
// stateful/exec/audio/UI component are deliberately ineligible.
const PURE_EXPRESSION_TYPES = new Set([
  'BrickComponentType_Expr_CompareEqual',
  'BrickComponentType_Expr_CompareGreater',
  'BrickComponentType_Expr_CompareGreaterOrEqual',
  'BrickComponentType_Expr_CompareLess',
  'BrickComponentType_Expr_CompareLessOrEqual',
  'BrickComponentType_Expr_LogicalAND',
  'BrickComponentType_Expr_LogicalNOT',
  'BrickComponentType_Expr_LogicalOR',
  'BrickComponentType_Expr_MathAdd',
  'BrickComponentType_Expr_MathBlend',
  'BrickComponentType_Expr_MathClamp',
  'BrickComponentType_Expr_MathDivide',
  'BrickComponentType_Expr_MathExp',
  'BrickComponentType_Expr_MathMax',
  'BrickComponentType_Expr_MathMin',
  'BrickComponentType_Expr_MathMultiply',
  'BrickComponentType_Expr_MathPow',
  'BrickComponentType_Expr_MathSubtract',
  'BrickComponentType_Expr_Select',
  'BrickComponentType_Expr_SplitQuaternion',
  'BrickComponentType_Expr_String_FormatText',
]);

function stable(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, stable(item)]));
}

function keyCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function oneComponent(brick) {
  return brick.comps.length === 1 ? brick.comps[0] : null;
}

function apply(scene, options = {}) {
  assert(scene?.bricks && scene?.edges, 'loaded prefab scene');
  const hiddenLogicGrids = options.hiddenLogicGrids;
  assert(Array.isArray(hiddenLogicGrids) && hiddenLogicGrids.length > 0,
    'explicit nonempty hiddenLogicGrids');
  const allowedGrids = new Set(hiddenLogicGrids);
  assert.equal(allowedGrids.size, hiddenLogicGrids.length, 'unique hidden logic grids');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  assert.equal(byKey.size, scene.bricks.length, 'unique brick keys');
  const incoming = new Map();
  for (const edge of scene.edges) {
    const target = `${edge.z}\0${edge.zt}\0${edge.q}`;
    assert(!incoming.has(target), `unique wire target ${target}`);
    incoming.set(target, edge);
  }

  const eligible = scene.bricks.filter(brick => {
    const component = oneComponent(brick);
    return allowedGrids.has(brick.g)
      && component && PURE_EXPRESSION_TYPES.has(component.type)
      && brick.data.asset?.startsWith('B_1x1_Gate_Expr_');
  });
  const eligibleKeys = new Set(eligible.map(brick => brick.key));

  // Pure expression dependencies must be a DAG. Failing closed here prevents
  // commoning a feedback loop or creating a self-reference during rewiring.
  const adjacency = new Map(eligible.map(brick => [brick.key, []]));
  const indegree = new Map(eligible.map(brick => [brick.key, 0]));
  for (const edge of scene.edges) {
    if (!eligibleKeys.has(edge.a) || !eligibleKeys.has(edge.z)) continue;
    assert.notEqual(edge.a, edge.z, `no self-referential pure expression ${edge.a}`);
    adjacency.get(edge.a).push(edge.z);
    indegree.set(edge.z, indegree.get(edge.z) + 1);
  }
  const queue = [...eligibleKeys].filter(key => indegree.get(key) === 0).sort(keyCompare);
  let topologicalCount = 0;
  while (queue.length) {
    const key = queue.shift();
    topologicalCount++;
    for (const target of adjacency.get(key)) {
      const next = indegree.get(target) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort(keyCompare);
      }
    }
  }
  assert.equal(topologicalCount, eligible.length, 'acyclic pure-expression graph');

  const signatureGroups = new Map();
  const descriptions = new Map();
  for (const brick of eligible) {
    const component = oneComponent(brick);
    const ports = brdb.COMPONENT_WIRE_PORTS.get(component.type);
    assert(ports, `wire ports for ${component.type}`);
    const inputs = {};
    const wiredPorts = new Set();
    for (const port of [...ports.inputs].sort(keyCompare)) {
      const edge = incoming.get(`${brick.key}\0${component.type}\0${port}`);
      if (edge) {
        wiredPorts.add(port);
        inputs[port] = {wire: {a: edge.a, at: edge.at, p: edge.p}};
      } else {
        inputs[port] = Object.hasOwn(component.data, port)
          ? {constant: stable(component.data[port])}
          : {missing: true};
      }
    }
    // A wire shadows the serialized fallback on its input. Compare every
    // remaining component field byte-semantically, while comparing each wired
    // input by its exact source triple above.
    const effectiveData = structuredClone(component.data);
    for (const port of wiredPorts) delete effectiveData[port];
    const description = {
      grid: brick.g,
      asset: brick.data.asset,
      type: component.type,
      effectiveData: stable(effectiveData),
      inputs,
    };
    const signature = JSON.stringify(description);
    if (!signatureGroups.has(signature)) signatureGroups.set(signature, []);
    signatureGroups.get(signature).push(brick.key);
    descriptions.set(signature, description);
  }

  const groups = [];
  const replacement = new Map();
  for (const [signature, unsortedKeys] of signatureGroups) {
    if (unsortedKeys.length < 2) continue;
    const memberKeys = [...unsortedKeys].sort(keyCompare);
    const members = new Set(memberKeys);
    const inputSources = Object.values(descriptions.get(signature).inputs)
      .filter(input => input.wire).map(input => input.wire.a);
    if (inputSources.some(source => members.has(source))) continue;
    const canonicalKey = memberKeys[0];
    const duplicateKeys = memberKeys.slice(1);
    for (const duplicateKey of duplicateKeys) {
      assert(!replacement.has(duplicateKey), `one CSE replacement for ${duplicateKey}`);
      replacement.set(duplicateKey, canonicalKey);
    }
    groups.push({
      canonicalKey,
      duplicateKeys,
      memberKeys,
      ...structuredClone(descriptions.get(signature)),
    });
  }
  groups.sort((a, b) => keyCompare(a.canonicalKey, b.canonicalKey));

  const duplicateKeys = new Set(replacement.keys());
  const removedBricks = scene.bricks.filter(brick => duplicateKeys.has(brick.key))
    .map(brick => structuredClone(brick));
  const removedEdges = scene.edges.filter(edge => duplicateKeys.has(edge.z))
    .map(edge => structuredClone(edge));
  const rewrittenEdges = [];
  const nextEdges = [];
  for (const edge of scene.edges) {
    if (duplicateKeys.has(edge.z)) continue;
    if (duplicateKeys.has(edge.a)) {
      const rewritten = {...edge, a: replacement.get(edge.a)};
      assert.notEqual(rewritten.a, rewritten.z, `CSE must not create self wire ${rewritten.a}`);
      rewrittenEdges.push({before: structuredClone(edge), after: structuredClone(rewritten)});
      nextEdges.push(rewritten);
    } else nextEdges.push(edge);
  }
  scene.edges = nextEdges;
  scene.bricks = scene.bricks.filter(brick => !duplicateKeys.has(brick.key));

  const afterByKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const targets = new Set();
  for (const edge of scene.edges) {
    assert(afterByKey.get(edge.a)?.comps.some(component => component.type === edge.at),
      `valid CSE source ${edge.a}:${edge.at}`);
    assert(afterByKey.get(edge.z)?.comps.some(component => component.type === edge.zt),
      `valid CSE target ${edge.z}:${edge.zt}`);
    const target = `${edge.z}\0${edge.zt}\0${edge.q}`;
    assert(!targets.has(target), `unique CSE wire target ${target}`);
    targets.add(target);
  }

  return {
    hiddenLogicGrids: [...allowedGrids].sort((a, b) => a - b),
    eligibleBricks: eligible.length,
    topologicalCount,
    groups,
    replacement,
    removedBricks,
    removedEdges,
    rewrittenEdges,
    before: {
      bricks: scene.bricks.length + removedBricks.length,
      edges: scene.edges.length + removedEdges.length,
    },
    after: {bricks: scene.bricks.length, edges: scene.edges.length},
    constants: {
      GROUPS: groups.length,
      REMOVED_BRICKS: removedBricks.length,
      REMOVED_EDGES: removedEdges.length,
      REWRITTEN_EDGES: rewrittenEdges.length,
    },
  };
}

module.exports = {apply, PURE_EXPRESSION_TYPES};
