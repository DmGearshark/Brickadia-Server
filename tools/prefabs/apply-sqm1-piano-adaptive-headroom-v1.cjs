'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const MAX_HEADROOM = 0.35;
const RMS_CEILING = 0.70;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const ENERGY_FLOOR = 1e-9;
const RECOVERY_SMOOTH_SECONDS = 0.12;

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

function apply(scene, v9HeadroomPatch, singleSourcePatch) {
  const voices = singleSourcePatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied single-source Piano graph');
  assert.equal(v9HeadroomPatch?.voices?.length, voices.length,
    'matching V9 headroom voice count');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano voices');

  const headroom = v9HeadroomPatch.headroom;
  assert(component(headroom, C.Expr_MathMultiply.NAME), 'V9 headroom Multiply');
  assert.equal(scene.edges.filter(edge => edge.z === headroom.key
    && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputB').length, 0,
  'V9 headroom factor was constant');
  assert.equal(component(headroom, C.Expr_MathMultiply.NAME).data.InputB.value,
    MAX_HEADROOM, 'V9 fixed headroom baseline');

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
    if (field.type !== 'WireValue' || (value && typeof value === 'object' && '$variant' in value)) {
      return value;
    }
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
      key: `sqm1p10gain:${label}`,
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
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === port), `unwired ${target.key}.${port}`);
    scene.edges.push({...input, z: target.key, zt: targetType, q: port});
  }

  // body.active is the velocity-shaped, pitch-aware Piano amplitude before
  // master volume, Dampen and key-off masking. Its squared sum is an energy
  // estimate which does not feed the adaptive gain back into its detector.
  const squares = voices.map(voice => {
    const square = add('Expr_MathMultiply', {}, `voice${voice.voice}:energy`);
    connect(source(voice.body.active, 'Output'), square, 'InputA');
    connect(source(voice.body.active, 'Output'), square, 'InputB');
    return square;
  });

  let level = squares;
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
  const safeEnergy = add('Expr_MathMax', {InputB: ENERGY_FLOOR}, 'safe-energy');
  connect(source(energy, 'Output'), safeEnergy, 'InputA');
  const rootEnergy = add('Expr_MathPow', {Exponent: 0.5}, 'root-energy');
  connect(source(safeEnergy, 'Output'), rootEnergy, 'Input');
  const denominator = add('Expr_MathMultiply', {}, 'volume-energy');
  connect(v9HeadroomPatch.effectiveVolume, denominator, 'InputA');
  connect(source(rootEnergy, 'Output'), denominator, 'InputB');
  const ceilingScale = add('Expr_MathDivide', {InputA: RMS_NUMERATOR}, 'ceiling-scale');
  connect(source(denominator, 'Output'), ceilingScale, 'InputB');
  const adaptiveScale = add('Expr_MathMin', {InputB: MAX_HEADROOM}, 'adaptive-scale');
  connect(source(ceilingScale, 'Output'), adaptiveScale, 'InputA');
  // A lower ceiling must attenuate a new chord immediately. A rising ceiling
  // recovers over 120 ms so pedal lifts cannot pump every surviving note.
  // Seed both saved endpoints at the normal V9 ceiling. Otherwise a freshly
  // placed player can spend its first 120 ms recovering from the placement
  // template's zero Value even though the live Target is already 0.35.
  const recovery = add('Dampen', {Target: MAX_HEADROOM, Value: MAX_HEADROOM,
    SmoothTime: RECOVERY_SMOOTH_SECONDS}, 'recovery');
  connect(source(adaptiveScale, 'Output'), recovery, 'Target');
  const finalScale = add('Expr_MathMin', {}, 'final-scale');
  connect(source(adaptiveScale, 'Output'), finalScale, 'InputA');
  connect(source(recovery, 'Value'), finalScale, 'InputB');
  connect(source(finalScale, 'Output'), headroom, 'InputB');

  assert.equal(slot, voices.length + (voices.length - 1) + 7,
    'one square per voice, balanced sum and seven ceiling/recovery gates');
  return {
    voices,
    squares,
    adders,
    energy,
    safeEnergy,
    rootEnergy,
    denominator,
    ceilingScale,
    adaptiveScale,
    recovery,
    finalScale,
    headroom,
    addedBricks: slot,
    sumDepth,
    firstY,
    logicGrid: v9HeadroomPatch.logicGrid,
    constants: {
      MAX_HEADROOM,
      RMS_CEILING,
      RMS_NUMERATOR,
      ENERGY_FLOOR,
      RECOVERY_SMOOTH_SECONDS,
      VOICES: voices.length,
    },
  };
}

module.exports = {apply, constants: {
  MAX_HEADROOM, RMS_CEILING, RMS_NUMERATOR, ENERGY_FLOOR, RECOVERY_SMOOTH_SECONDS,
}};
