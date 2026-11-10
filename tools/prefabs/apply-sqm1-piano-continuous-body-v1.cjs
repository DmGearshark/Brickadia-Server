'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');

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

function edgeSource(edge) {
  return {a: edge.a, at: edge.at, p: edge.p};
}

function apply(scene, singleSourcePatch, releasePatch) {
  const voices = singleSourcePatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied single-source Piano graph');
  assert.equal(releasePatch?.voices?.length, voices.length,
    'matching release voice graph');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano voices');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const source = (brick, port, type = primaryType(brick)) =>
    ({a: brick.key, at: type, p: port});

  const gridBricks = scene.bricks.filter(brick => brick.g === singleSourcePatch.logicGrid);
  const template = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  assert(template, 'expression placement template');
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
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p10:${label}`,
      g: singleSourcePatch.logicGrid,
      data: {
        ...structuredClone(template.data),
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
    else component(brick, primaryType(brick)).data[port] =
      coerce(primaryType(brick), port, value);
  }

  function select(condition, inputA, inputB, label) {
    const brick = add('Expr_Select', {}, label);
    setInput(brick, 'bSelectB', condition);
    setInput(brick, 'InputA', inputA);
    setInput(brick, 'InputB', inputB);
    return brick;
  }

  function and(inputA, inputB, label) {
    const brick = add('Expr_LogicalAND', {}, label);
    setInput(brick, 'bInputA', inputA);
    setInput(brick, 'bInputB', inputB);
    return brick;
  }

  const running = releasePatch.running;
  assert(component(running, C.Var.NAME), 'retained running Var');
  const startingCandidates = scene.bricks.filter(brick => {
    if (!component(brick, C.Var.NAME)) return false;
    const outgoing = scene.edges.filter(edge => edge.a === brick.key
      && edge.at === C.Var.NAME);
    const setters = outgoing.filter(edge => edge.p === 'VarRef'
      && edge.zt === C.Exec_Var_Set.NAME && edge.q === 'VarRef');
    if (setters.length !== 2) return false;
    const values = setters.map(edge => component(byKey.get(edge.z), C.Exec_Var_Set.NAME)?.data.Value)
      .map(value => value?.value).sort();
    const readers = outgoing.filter(edge => edge.p === 'Value');
    return values.length === 2 && values[0] === false && values[1] === true
      && readers.length === 1 && readers[0].zt === C.Expr_LogicalNOT.NAME
      && readers[0].q === 'bInput';
  });
  const starting = one(startingCandidates, 'one playback-starting state Var');
  const notStarting = add('Expr_LogicalNOT', {}, 'shared:not-starting');
  setInput(notStarting, 'bInput', source(starting, 'Value'));
  const stablePlayback = and(source(running, 'Value'), source(notStarting, 'bOutput'),
    'shared:stable-playback');
  const removedEdges = [];
  const patchedVoices = [];

  for (const voice of voices) {
    const releaseVoice = releasePatch.voices[voice.voice];
    assert.equal(releaseVoice.voice, voice.voice, `voice ${voice.voice} release context`);
    const label = `voice${voice.voice}`;
    const bodyEmitter = voice.body.emitter;
    assert.equal(bodyEmitter.key, releaseVoice.body.emitter.key,
      `${label} shared body emitter`);

    const legacyEnable = one(incoming(bodyEmitter, C.AudioEmitter.NAME, 'bEnabled'),
      `${label} body enable`);
    assert.equal(legacyEnable.a, releaseVoice.enableSelect.key,
      `${label} V5 profile-aware enable`);
    const pianoVolume = one(incoming(releaseVoice.body.volumeSelect,
      C.Expr_Select.NAME, 'InputB'), `${label} Piano body volume`);
    assert.equal(pianoVolume.a, releaseVoice.body.releaseVolume.key,
      `${label} exact-zero release volume`);
    const profileCondition = one(incoming(releaseVoice.body.volumeSelect,
      C.Expr_Select.NAME, 'bSelectB'), `${label} Piano profile condition`);
    scene.edges = scene.edges.filter(edge => edge !== legacyEnable && edge !== pianoVolume);
    removedEdges.push(structuredClone(legacyEnable), structuredClone(pianoVolume));

    // The original audible window already combines begin, release end,
    // noteLoaded and running. It therefore reaches exact false before the
    // scheduler changes pitch and stays false throughout replay-start reset.
    const maskedVolume = select(releaseVoice.audibleWindow, 0,
      edgeSource(pianoVolume), `${label}:exact-silent-body`);
    connect(source(maskedVolume, 'Output'), releaseVoice.body.volumeSelect, 'InputB');

    // Keep the one Piano body oscillator alive for the complete running session.
    // Non-Piano profiles retain the exact V5 per-note enable path. Partials keep
    // their existing V7/V8 profile and source-budget gates.
    const continuousEnable = select(edgeSource(profileCondition),
      edgeSource(legacyEnable), source(stablePlayback, 'bOutput'),
      `${label}:continuous-body-enable`);
    connect(source(continuousEnable, 'Output'), bodyEmitter, 'bEnabled');

    patchedVoices.push({voice: voice.voice, bodyEmitter, releaseVoice,
      maskedVolume, continuousEnable,
      legacyEnable: structuredClone(legacyEnable),
      pianoVolume: structuredClone(pianoVolume),
      profileCondition: structuredClone(profileCondition)});
  }

  assert.equal(slot, voices.length * 2 + 2,
    'two shared and two lifecycle gates per Piano lane');
  assert.equal(removedEdges.length, voices.length * 2,
    'body enable and Piano-volume route replaced per lane');
  return {
    voices: patchedVoices,
    running,
    starting,
    notStarting,
    stablePlayback,
    removedEdges,
    addedBricks: slot,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: singleSourcePatch.logicGrid,
    constants: {VOICES: voices.length, SHARED_GATES: 2, GATES_PER_VOICE: 2},
  };
}

module.exports = {apply};
