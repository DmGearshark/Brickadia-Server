'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const VOICES = 18;
const BODY_FAST_RATE = -4;
const BODY_FAST_GAIN = 0.75;
const BODY_SLOW_RATE = -0.5;
const BODY_SLOW_GAIN = 0.25;
const HARMONICS = Object.freeze({
  2: Object.freeze({rate: -6, gain: 0.23, legacyGain: 0.18, legacyFloor: 0.05}),
  3: Object.freeze({rate: -8, gain: 0.065, legacyGain: 0.05, legacyFloor: 0.015}),
});

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

function apply(scene, pianoPatch, releasePatch) {
  assert.equal(pianoPatch?.voices?.length, VOICES, 'applied V4 piano graph');
  assert.equal(releasePatch?.voices?.length, VOICES, 'applied V5 release graph');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const source = (brick, port, type = primaryType(brick)) => ({a: brick.key, at: type, p: port});

  const gridBricks = scene.bricks.filter(brick => brick.g === pianoPatch.logicGrid);
  const expressionTemplate = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  assert(expressionTemplate, 'expression placement template');
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
    if (typeof value === 'boolean') return B(value);
    if (typeof value === 'string') return S(value);
    return value;
  }

  function add(kind, data, label) {
    const definition = C[kind];
    assert(definition, `known component ${kind}`);
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p6:${label}`,
      g: pianoPatch.logicGrid,
      data: {
        ...structuredClone(expressionTemplate.data),
        asset: definition.BRICK,
        size: [10, 5, 2],
        position,
      },
      comps: [{type: definition.NAME, data: componentData}],
    };
    assert(!byKey.has(brick.key), `unique ${brick.key}`);
    scene.bricks.push(brick);
    byKey.set(brick.key, brick);
    return brick;
  }

  function connect(input, target, port) {
    assert(input?.a && input.at && input.p, `source for ${target.key}.${port}`);
    const targetType = primaryType(target);
    assert(!scene.edges.some(edge => edge.z === target.key && edge.zt === targetType
      && edge.q === port), `unwired ${target.key}.${port}`);
    scene.edges.push({...input, z: target.key, zt: targetType, q: port});
  }

  function setInput(brick, port, value) {
    if (value && typeof value === 'object' && value.a) connect(value, brick, port);
    else component(brick, primaryType(brick)).data[port] = coerce(primaryType(brick), port, value);
  }

  function math(kind, inputA, inputB, label) {
    const brick = add(`Expr_Math${kind}`, {}, label);
    setInput(brick, 'InputA', inputA);
    setInput(brick, 'InputB', inputB);
    return brick;
  }

  function unary(kind, input, label) {
    const brick = add(`Expr_Math${kind}`, {}, label);
    setInput(brick, 'Input', input);
    return brick;
  }

  function setConstant(brick, type, port, expected, value, label) {
    assert.equal(incoming(brick, type, port).length, 0, `${label} was constant`);
    assert.equal(scalar(component(brick, type).data[port]), expected, `${label} legacy value`);
    component(brick, type).data[port] = coerce(type, port, value);
  }

  const removedCurveKeys = new Set();
  const voices = [];
  for (const voice of pianoPatch.voices) {
    const label = `voice${voice.voice}`;
    assert.equal(releasePatch.voices[voice.voice].voice, voice.voice,
      `${label} V5 release context`);

    setConstant(voice.body.exponent, C.Expr_MathMultiply.NAME, 'InputB', -1.6,
      BODY_FAST_RATE, `${label} body fast rate`);
    setConstant(voice.body.scaled, C.Expr_MathMultiply.NAME, 'InputB', 0.65,
      BODY_FAST_GAIN, `${label} body fast gain`);
    setConstant(voice.body.curve, C.Expr_MathAdd.NAME, 'InputB', 0.35,
      0, `${label} body legacy floor`);

    const slowExponent = math('Multiply', source(voice.age, 'Output'), BODY_SLOW_RATE,
      `${label}:body-slow-exponent`);
    const slowDecay = unary('Exp', source(slowExponent, 'Output'),
      `${label}:body-slow-decay`);
    const slowScaled = math('Multiply', source(slowDecay, 'Output'), BODY_SLOW_GAIN,
      `${label}:body-slow-scaled`);
    connect(source(slowScaled, 'Output'), voice.body.curve, 'InputB');

    const harmonics = voice.harmonics.map(harmonic => {
      const specification = HARMONICS[harmonic.ratio];
      assert(specification, `${label} known H${harmonic.ratio}`);
      setConstant(harmonic.exponent, C.Expr_MathMultiply.NAME, 'InputB', specification.rate,
        specification.rate, `${label} H${harmonic.ratio} rate`);
      setConstant(harmonic.decayGain, C.Expr_MathMultiply.NAME, 'InputB',
        specification.legacyGain, specification.gain, `${label} H${harmonic.ratio} gain`);
      assert.equal(scalar(component(harmonic.curve, C.Expr_MathAdd.NAME).data.InputB),
        specification.legacyFloor, `${label} H${harmonic.ratio} legacy floor`);
      assert.equal(incoming(harmonic.curve, C.Expr_MathAdd.NAME, 'InputB').length, 0,
        `${label} H${harmonic.ratio} floor was constant`);
      const curveInput = one(incoming(harmonic.curve, C.Expr_MathAdd.NAME, 'InputA'),
        `${label} H${harmonic.ratio} curve decay`);
      assert.equal(curveInput.a, harmonic.decayGain.key,
        `${label} H${harmonic.ratio} decay source`);
      const velocityEdge = one(outgoing(harmonic.curve, C.Expr_MathAdd.NAME, 'Output')
        .filter(edge => edge.z === harmonic.withVelocity.key
          && edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputA'),
      `${label} H${harmonic.ratio} curve output`);
      removedCurveKeys.add(harmonic.curve.key);
      scene.edges = scene.edges.filter(edge => edge !== curveInput && edge !== velocityEdge);
      connect(source(harmonic.decayGain, 'Output'), harmonic.withVelocity, 'InputA');
      return {...harmonic, legacyCurve: harmonic.curve, curve: harmonic.decayGain,
        gain: specification.gain, floor: 0};
    });

    voices.push({...voice, body: {...voice.body, slowExponent, slowDecay, slowScaled}, harmonics});
  }

  assert.equal(removedCurveKeys.size, VOICES * 2, 'two harmonic floor Adds per voice');
  for (const key of removedCurveKeys) {
    assert(!scene.edges.some(edge => edge.a === key || edge.z === key),
      `removed harmonic curve ${key} is disconnected`);
    byKey.delete(key);
  }
  scene.bricks = scene.bricks.filter(brick => !removedCurveKeys.has(brick.key));

  return {
    voices,
    addedBricks: slot,
    removedBricks: removedCurveKeys.size,
    netBricks: slot - removedCurveKeys.size,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: pianoPatch.logicGrid,
    constants: {
      VOICES,
      BODY_FAST_RATE,
      BODY_FAST_GAIN,
      BODY_SLOW_RATE,
      BODY_SLOW_GAIN,
      HARMONICS,
    },
  };
}

module.exports = {apply};
