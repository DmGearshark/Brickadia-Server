'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const PREFIX = 'MWSP5:';
const VOICES = 18;
const BASS_PITCH_THRESHOLD = 0.75;
const BASS_SCALE = 2;
const SLOW_GAIN_BASE = 0.25;
const SLOW_GAIN_RANGE = 0.05;
const SLOW_RATE_BASE = -0.5;
const SLOW_RATE_RANGE = 0.15;
const ATTACK_GAIN = 0.30;

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

function prepare(scene, pianoPreparation) {
  assert.equal(pianoPreparation?.voices?.length, VOICES, 'prepared V4 piano voices');
  const markers = new Map();
  for (const brick of scene.bricks) {
    const message = component(brick, C.Interact.NAME)?.data.Message;
    if (!message?.startsWith(PREFIX)) continue;
    const label = message.slice(PREFIX.length);
    assert(!markers.has(label), `duplicate ${PREFIX}${label}`);
    markers.set(label, brick);
  }
  assert(markers.size >= 500, 'marked pre-optimization player graph');
  const marked = label => {
    const brick = markers.get(label);
    assert(brick, `missing ${PREFIX}${label}`);
    return brick;
  };
  const voices = Array.from({length: VOICES}, (_, voice) => {
    const pitchHold = marked(`voice${voice}.note.pitch`);
    assert(component(pitchHold, C.Var.NAME), `voice ${voice} raw pitch-ratio Var`);
    return {voice, pitchHoldKey: pitchHold.key};
  });
  assert.equal(new Set(voices.map(voice => voice.pitchHoldKey)).size, VOICES,
    'distinct raw pitch-ratio Vars');
  return {logicGrid: pianoPreparation.logicGrid, voices};
}

function apply(scene, preparation, pianoPatch, releasePatch, decayPatch) {
  assert.equal(preparation?.voices?.length, VOICES, 'prepared V7 raw pitch ratios');
  assert.equal(pianoPatch?.voices?.length, VOICES, 'applied V4 piano graph');
  assert.equal(releasePatch?.voices?.length, VOICES, 'applied V5 release graph');
  assert.equal(decayPatch?.voices?.length, VOICES, 'applied V6 decay graph');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const source = (brick, port, type = primaryType(brick)) => ({a: brick.key, at: type, p: port});
  const edgeSource = edge => ({a: edge.a, at: edge.at, p: edge.p});

  const gridBricks = scene.bricks.filter(brick => brick.g === preparation.logicGrid);
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
      key: `sqm1p7:${label}`,
      g: preparation.logicGrid,
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

  function connectConstant(brick, type, port, expected, input, label) {
    assert.equal(incoming(brick, type, port).length, 0, `${label} was constant`);
    assert.equal(scalar(component(brick, type).data[port]), expected, `${label} legacy value`);
    connect(input, brick, port);
  }

  function setConstant(brick, type, port, expected, value, label) {
    assert.equal(incoming(brick, type, port).length, 0, `${label} was constant`);
    assert.equal(scalar(component(brick, type).data[port]), expected, `${label} legacy value`);
    component(brick, type).data[port] = coerce(type, port, value);
  }

  const removedEdges = [];
  const voices = [];
  for (const prepared of preparation.voices) {
    const voice = decayPatch.voices[prepared.voice];
    const releaseVoice = releasePatch.voices[prepared.voice];
    assert.equal(voice.voice, prepared.voice, `voice ${prepared.voice} V6 context`);
    assert.equal(releaseVoice.voice, prepared.voice, `voice ${prepared.voice} V5 context`);
    const label = `voice${prepared.voice}`;
    const pitchHold = byKey.get(prepared.pitchHoldKey);
    assert(component(pitchHold, C.Var.NAME), `${label} retained raw pitch-ratio Var`);

    const bassDifference = math('Subtract', BASS_PITCH_THRESHOLD,
      source(pitchHold, 'Value'), `${label}:bass-difference`);
    const bassScaled = math('Multiply', source(bassDifference, 'Output'), BASS_SCALE,
      `${label}:bass-scaled`);
    const bass = add('Expr_MathClamp', {Min: 0, Max: 1}, `${label}:bass`);
    setInput(bass, 'Input', source(bassScaled, 'Output'));
    const slowGainScale = math('Multiply', source(bass, 'Output'), SLOW_GAIN_RANGE,
      `${label}:slow-gain-scale`);
    const slowGain = math('Add', SLOW_GAIN_BASE, source(slowGainScale, 'Output'),
      `${label}:slow-gain`);
    const fastGain = math('Subtract', 1, source(slowGain, 'Output'),
      `${label}:fast-gain`);
    const slowRateScale = math('Multiply', source(bass, 'Output'), SLOW_RATE_RANGE,
      `${label}:slow-rate-scale`);
    const slowRate = math('Add', SLOW_RATE_BASE, source(slowRateScale, 'Output'),
      `${label}:slow-rate`);

    connectConstant(voice.body.scaled, C.Expr_MathMultiply.NAME, 'InputB', 0.75,
      source(fastGain, 'Output'), `${label} fast gain`);
    connectConstant(voice.body.slowScaled, C.Expr_MathMultiply.NAME, 'InputB', 0.25,
      source(slowGain, 'Output'), `${label} slow gain`);
    connectConstant(voice.body.slowExponent, C.Expr_MathMultiply.NAME, 'InputB', -0.5,
      source(slowRate, 'Output'), `${label} slow rate`);

    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2), `${label} H2`);
    setConstant(h2.decayGain, C.Expr_MathMultiply.NAME, 'InputB', 0.23, ATTACK_GAIN,
      `${label} folded attack gain`);
    const legacyBodyEdge = one(incoming(voice.body.active, C.Expr_Select.NAME, 'InputB'),
      `${label} V6 body amplitude`);
    assert.equal(legacyBodyEdge.a, voice.body.withVelocity.key,
      `${label} V6 body amplitude source`);
    scene.edges = scene.edges.filter(edge => edge !== legacyBodyEdge);
    removedEdges.push(legacyBodyEdge);
    const bodySum = math('Add', source(voice.body.withVelocity, 'Output'),
      source(h2.withVelocity, 'Output'), `${label}:body-with-attack`);
    connect(source(bodySum, 'Output'), voice.body.active, 'InputB');

    const bodyEnableEdge = one(incoming(voice.body.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `${label} body enable`);
    assert.equal(bodyEnableEdge.a, releaseVoice.enableSelect.key,
      `${label} body uses V5 profile enable`);
    const harmonicEnableEdges = voice.harmonics.map(harmonic => {
      const edge = one(incoming(harmonic.emitter, C.AudioEmitter.NAME, 'bEnabled'),
        `${label} H${harmonic.ratio} enable`);
      assert.deepEqual(edgeSource(edge), edgeSource(bodyEnableEdge),
        `${label} V6 shared emitter enable`);
      return edge;
    });
    // H2's old Piano-only activity Select is downstream of the attack value
    // tapped above. Reuse it as the profile-aware partial enable instead of
    // adding another continuously evaluated gate. Its old master is made a
    // constant zero; non-Piano audio already bypasses that Piano-only path.
    const partialEnable = h2.active;
    const legacyPartialCondition = one(incoming(partialEnable, C.Expr_Select.NAME,
      'bSelectB'), `${label} H2 activity condition`);
    const legacyPartialValue = one(incoming(partialEnable, C.Expr_Select.NAME, 'InputB'),
      `${label} H2 activity value`);
    const legacyPartialOutput = one(outgoing(partialEnable, C.Expr_Select.NAME, 'Output'),
      `${label} H2 activity output`);
    assert.equal(legacyPartialCondition.a, voice.pianoActive.key,
      `${label} H2 used Piano activity`);
    assert.equal(legacyPartialValue.a, h2.withVelocity.key,
      `${label} H2 used its shaped amplitude`);
    assert.equal(legacyPartialOutput.z, h2.master.key, `${label} H2 fed its master`);
    assert.equal(legacyPartialOutput.q, 'InputA', `${label} H2 master amplitude input`);
    assert.equal(incoming(partialEnable, C.Expr_Select.NAME, 'InputA').length, 0,
      `${label} H2 zero branch was constant`);
    assert.equal(scalar(component(partialEnable, C.Expr_Select.NAME).data.InputA), 0,
      `${label} H2 zero branch value`);
    const legacyPartialEdges = [legacyPartialCondition, legacyPartialValue,
      legacyPartialOutput, ...harmonicEnableEdges];
    scene.edges = scene.edges.filter(edge => !legacyPartialEdges.includes(edge));
    removedEdges.push(...legacyPartialEdges);
    component(partialEnable, C.Expr_Select.NAME).data.InputB = B(false);
    component(h2.master, C.Expr_MathMultiply.NAME).data.InputA = N(0);
    connect(source(voice.isPiano, 'bOutput'), partialEnable, 'bSelectB');
    connect(source(releaseVoice.enableSelect, 'Output'), partialEnable, 'InputA');
    for (const harmonic of voice.harmonics) {
      connect(source(partialEnable, 'Output'), harmonic.emitter, 'bEnabled');
    }

    voices.push({
      voice: prepared.voice,
      pitchHold,
      bassDifference,
      bassScaled,
      bass,
      slowGainScale,
      slowGain,
      fastGain,
      slowRateScale,
      slowRate,
      bodySum,
      partialEnable,
      body: voice.body,
      harmonics: voice.harmonics,
      legacyBodySource: edgeSource(legacyBodyEdge),
      legacyPartialEnableSources: harmonicEnableEdges.map(edgeSource),
      legacyPartialConditionSource: edgeSource(legacyPartialCondition),
      legacyPartialValueSource: edgeSource(legacyPartialValue),
      legacyPartialOutput: structuredClone(legacyPartialOutput),
    });
  }

  assert.equal(slot, VOICES * 9, 'nine V7 expression gates per voice');
  assert.equal(removedEdges.length, VOICES * 6, 'six rerouted wires per voice');
  return {
    voices,
    addedBricks: slot,
    removedBricks: 0,
    removedEdges,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: preparation.logicGrid,
    constants: {
      VOICES,
      BASS_PITCH_THRESHOLD,
      BASS_SCALE,
      SLOW_GAIN_BASE,
      SLOW_GAIN_RANGE,
      SLOW_RATE_BASE,
      SLOW_RATE_RANGE,
      ATTACK_GAIN,
    },
  };
}

module.exports = {prepare, apply};
