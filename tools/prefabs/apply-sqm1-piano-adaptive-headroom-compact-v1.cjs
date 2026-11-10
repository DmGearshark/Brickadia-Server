'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.70;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const DENOMINATOR_FLOOR = RMS_NUMERATOR / MAX_HEADROOM;
const RECOVERY_SMOOTH_SECONDS = 0.12;
const GROUP_SIZE = 3;

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

function apply(scene, adaptiveHeadroomPatch, v9HeadroomPatch, singleSourcePatch) {
  const voices = singleSourcePatch?.voices;
  assert(Array.isArray(voices) && voices.length === 24,
    '24-lane single-source Piano graph');
  assert.equal(adaptiveHeadroomPatch?.voices?.length, voices.length,
    'matching V10 adaptive-headroom voice count');
  assert.equal(v9HeadroomPatch?.headroom?.key, adaptiveHeadroomPatch?.headroom?.key,
    'matching V9 headroom target');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano voices');

  const headroom = v9HeadroomPatch.headroom;
  assert(component(headroom, C.Expr_MathMultiply.NAME), 'V9 headroom Multiply');
  const oldBricks = [
    ...adaptiveHeadroomPatch.squares,
    ...adaptiveHeadroomPatch.adders,
    adaptiveHeadroomPatch.safeEnergy,
    adaptiveHeadroomPatch.rootEnergy,
    adaptiveHeadroomPatch.denominator,
    adaptiveHeadroomPatch.ceilingScale,
    adaptiveHeadroomPatch.adaptiveScale,
    adaptiveHeadroomPatch.recovery,
    adaptiveHeadroomPatch.finalScale,
  ];
  const oldKeys = new Set(oldBricks.map(brick => brick?.key));
  assert.equal(oldKeys.size, 54, 'complete 54-component V10 limiter');
  assert(oldBricks.every(brick => scene.bricks.includes(brick)),
    'all old limiter bricks belong to scene');
  const oldEdges = scene.edges.filter(edge => oldKeys.has(edge.a) || oldKeys.has(edge.z));
  assert.equal(oldEdges.length, 104, 'complete V10 limiter wiring');
  assert.equal(scene.edges.filter(edge => edge.z === headroom.key
    && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB').length, 1,
  'one old adaptive headroom route');

  scene.edges = scene.edges.filter(edge => !oldKeys.has(edge.a) && !oldKeys.has(edge.z));
  scene.bricks = scene.bricks.filter(brick => !oldKeys.has(brick.key));
  assert.equal(scene.edges.filter(edge => edge.z === headroom.key
    && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB').length, 0,
  'headroom input freed for compact limiter');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const gridBricks = scene.bricks.filter(brick => brick.g === v9HeadroomPatch.logicGrid);
  const template = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  const dampenTemplate = gridBricks.find(brick => component(brick, C.Dampen.NAME));
  assert(template && dampenTemplate, 'expression and Dampen placement templates');
  const firstY = Math.ceil((Math.max(...gridBricks.map(brick => brick.data.position[1])) + 48)
    / 48) * 48;
  let slot = 0;

  function coerce(type, port, value) {
    const field = schema.structs.get(brdb.COMPONENT_TYPE_STRUCTS.get(type))?.get(port);
    assert(field, `${type}.${port} field`);
    if (field.type !== 'WireValue'
      || (value && typeof value === 'object' && '$variant' in value)) return value;
    if (typeof value === 'number') return N(value);
    return value;
  }

  function add(kind, data, label) {
    const definition = C[kind];
    assert(definition, `known component ${kind}`);
    const placementTemplate = kind === 'Dampen' ? dampenTemplate : template;
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p101gain:${label}`,
      g: v9HeadroomPatch.logicGrid,
      data: {
        ...structuredClone(placementTemplate.data),
        asset: definition.BRICK,
        size: [10, 5, 2],
        position,
      },
      comps: [{type: definition.NAME, data: kind === 'Dampen'
        ? {...structuredClone(component(dampenTemplate, C.Dampen.NAME).data), ...componentData}
        : componentData}],
    };
    assert(!byKey.has(brick.key), `unique ${brick.key}`);
    scene.bricks.push(brick);
    byKey.set(brick.key, brick);
    return brick;
  }

  function source(brick, port, type = primaryType(brick)) {
    return {a: brick.key, at: type, p: port};
  }

  function connect(input, target, port) {
    assert(input?.a && input.at && input.p, `source for ${target.key}.${port}`);
    const targetType = primaryType(target);
    assert(brdb.COMPONENT_WIRE_PORTS.get(input.at)?.outputs.includes(input.p),
      `valid output ${input.at}.${input.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(targetType)?.inputs.includes(port),
      `valid input ${targetType}.${port}`);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === port), `unwired ${target.key}.${port}`);
    scene.edges.push({...input, z: target.key, zt: targetType, q: port});
  }

  // A vector magnitude-squared gate computes x*x + y*y + z*z in one native
  // component and gives each changing amplitude one outgoing detector wire.
  const magnitudeGroups = [];
  for (let index = 0; index < voices.length; index += GROUP_SIZE) {
    const members = voices.slice(index, index + GROUP_SIZE);
    assert.equal(members.length, GROUP_SIZE, `full energy group ${index / GROUP_SIZE}`);
    const magnitude = add('Expr_VecMagnitudeSquared', {}, `group${index / GROUP_SIZE}:energy`);
    for (let member = 0; member < members.length; member++) {
      connect(source(members[member].body.active, 'Output'), magnitude,
        ['Input.X', 'Input.Y', 'Input.Z'][member]);
    }
    magnitudeGroups.push({magnitude, voices: members.map(voice => voice.voice)});
  }

  let level = magnitudeGroups.map(group => group.magnitude);
  let sumDepth = 0;
  const adders = [];
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      if (index + 1 === level.length) {
        next.push(level[index]);
        continue;
      }
      const sum = add('Expr_MathAdd', {}, `sum${sumDepth}:${index / 2}`);
      connect(source(level[index], 'Output'), sum, 'InputA');
      connect(source(level[index + 1], 'Output'), sum, 'InputB');
      adders.push(sum);
      next.push(sum);
    }
    level = next;
    sumDepth++;
  }
  const energy = level[0];
  const rootEnergy = add('Expr_MathSqrt', {}, 'root-energy');
  connect(source(energy, 'Output'), rootEnergy, 'Input');
  const denominator = add('Expr_MathMultiply', {}, 'volume-energy');
  connect(v9HeadroomPatch.effectiveVolume, denominator, 'InputA');
  connect(source(rootEnergy, 'Output'), denominator, 'InputB');

  // For positive supported volume, min(H, K / d) is exactly K / max(K/H, d).
  // The fixed denominator floor also handles silence without an energy epsilon.
  const safeDenominator = add('Expr_MathMax', {InputB: DENOMINATOR_FLOOR},
    'safe-denominator');
  connect(source(denominator, 'Output'), safeDenominator, 'InputA');
  const adaptiveScale = add('Expr_MathDivide', {InputA: RMS_NUMERATOR}, 'adaptive-scale');
  connect(source(safeDenominator, 'Output'), adaptiveScale, 'InputB');
  const recovery = add('Dampen', {Target: MAX_HEADROOM, Value: MAX_HEADROOM,
    SmoothTime: RECOVERY_SMOOTH_SECONDS}, 'recovery');
  connect(source(adaptiveScale, 'Output'), recovery, 'Target');
  const finalScale = add('Expr_MathMin', {}, 'final-scale');
  connect(source(adaptiveScale, 'Output'), finalScale, 'InputA');
  connect(source(recovery, 'Value'), finalScale, 'InputB');
  connect(source(finalScale, 'Output'), headroom, 'InputB');

  assert.equal(slot, 21,
    'eight vector energies, seven adds and six ceiling/recovery gates');
  return {
    voices,
    magnitudeGroups,
    adders,
    energy,
    rootEnergy,
    denominator,
    safeDenominator,
    adaptiveScale,
    recovery,
    finalScale,
    headroom,
    removedBricks: oldBricks,
    removedEdges: oldEdges,
    addedBricks: slot,
    sumDepth,
    firstY,
    logicGrid: v9HeadroomPatch.logicGrid,
    constants: {
      MAX_HEADROOM,
      RMS_CEILING,
      RMS_NUMERATOR,
      DENOMINATOR_FLOOR,
      RECOVERY_SMOOTH_SECONDS,
      VOICES: voices.length,
      GROUP_SIZE,
    },
  };
}

module.exports = {apply, constants: {
  MAX_HEADROOM, RMS_CEILING, RMS_NUMERATOR, DENOMINATOR_FLOOR,
  RECOVERY_SMOOTH_SECONDS, GROUP_SIZE,
}};
