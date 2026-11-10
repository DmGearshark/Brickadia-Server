'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const PREFIX = 'MWSP5:';
const LEGACY_LAYER_LIMIT = 18;

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function primaryType(brick) {
  const candidates = brick.comps.filter(item => item.type !== C.Interact.NAME);
  assert.equal(candidates.length, 1, `one wire component on ${brick.key}`);
  return candidates[0].type;
}

function prepare(scene, voiceCount) {
  assert(Number.isInteger(voiceCount) && voiceCount >= 1 && voiceCount <= 32,
    'V8 voice count is within the format-1 header');
  const matches = scene.bricks.filter(brick =>
    component(brick, C.Interact.NAME)?.data.Message === `${PREFIX}active.header.q0`);
  const activeGlobal = one(matches, 'one marked active global score header');
  assert(component(activeGlobal, C.Var.NAME), 'active global score header is a Var');
  return {voiceCount, logicGrid: activeGlobal.g, activeGlobalKey: activeGlobal.key};
}

function apply(scene, preparation, singleSourcePatch) {
  assert(preparation?.voiceCount >= 1 && preparation.voiceCount <= 32,
    'prepared V8 voice count');
  assert.equal(singleSourcePatch?.voices?.length, preparation.voiceCount,
    'V7 single-source lane count');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const activeGlobal = byKey.get(preparation.activeGlobalKey);
  assert(component(activeGlobal, C.Var.NAME), 'retained active global score header');
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const source = (brick, port, type = primaryType(brick)) => ({a: brick.key, at: type, p: port});

  const splitEdge = one(outgoing(activeGlobal, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_SplitQuaternion.NAME && edge.q === 'Input'),
  'active global header SplitQuaternion');
  const activeGlobalSplit = byKey.get(splitEdge.z);
  assert(component(activeGlobalSplit, C.Expr_SplitQuaternion.NAME),
    'active global header split retained');

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
      key: `sqm1p8:${label}`,
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

  const legacyLayerSong = add('Expr_CompareLessOrEqual', {
    InputB: LEGACY_LAYER_LIMIT,
  }, 'shared:legacy-three-layer-song');
  connect(source(activeGlobalSplit, 'Z'), legacyLayerSong, 'InputA');

  const removedEdges = [];
  const voices = [];
  for (const voice of singleSourcePatch.voices) {
    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2),
      `voice ${voice.voice} H2`);
    const h3 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 3),
      `voice ${voice.voice} H3`);
    const h2Enable = one(incoming(h2.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `voice ${voice.voice} H2 enable`);
    const h3Enable = one(incoming(h3.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `voice ${voice.voice} H3 enable`);
    assert.equal(h2Enable.a, voice.partialEnable.key,
      `voice ${voice.voice} H2 retains V7 profile enable`);
    assert.deepEqual({a: h3Enable.a, at: h3Enable.at, p: h3Enable.p},
      {a: h2Enable.a, at: h2Enable.at, p: h2Enable.p},
    `voice ${voice.voice} V7 partials shared one enable`);
    scene.edges = scene.edges.filter(edge => edge !== h3Enable);
    removedEdges.push(h3Enable);

    const h3DensePolicy = add('Expr_LogicalAND', {}, `voice${voice.voice}:h3-song-budget`);
    connect(source(voice.partialEnable, 'Output'), h3DensePolicy, 'bInputA');
    connect(source(legacyLayerSong, 'bOutput'), h3DensePolicy, 'bInputB');
    connect(source(h3DensePolicy, 'bOutput'), h3.emitter, 'bEnabled');
    voices.push({voice: voice.voice, partialEnable: voice.partialEnable,
      h2, h3, h2Enable: structuredClone(h2Enable),
      legacyH3Enable: structuredClone(h3Enable), h3DensePolicy});
  }

  assert.equal(slot, preparation.voiceCount + 1,
    'one shared score check and one H3 budget gate per lane');
  assert.equal(removedEdges.length, preparation.voiceCount,
    'one V7 H3 enable rerouted per lane');
  return {
    voices,
    activeGlobal,
    activeGlobalSplit,
    legacyLayerSong,
    removedEdges,
    addedBricks: slot,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: preparation.logicGrid,
    constants: {LEGACY_LAYER_LIMIT, VOICES: preparation.voiceCount},
  };
}

module.exports = {prepare, apply};
