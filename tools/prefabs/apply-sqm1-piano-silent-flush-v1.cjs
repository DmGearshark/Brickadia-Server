'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const SILENT_FLUSH_SECONDS = 0.006;

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

function apply(scene, pianoPatch, releasePatch) {
  const voices = releasePatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied Piano release graph');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano release voices');
  assert.equal(pianoPatch?.voices?.length, voices.length,
    'matching Piano envelope graph');
  assert(component(releasePatch.bodyReleaseSmooth, C.Expr_MathDivide.NAME),
    'shared speed-normalized Piano release smoothing');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const source = (brick, port, type = primaryType(brick)) =>
    ({a: brick.key, at: type, p: port});

  const gridBricks = scene.bricks.filter(brick => brick.g === releasePatch.logicGrid);
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
      key: `sqm1p10f:${label}`,
      g: releasePatch.logicGrid,
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

  const normalReleaseSource = source(releasePatch.bodyReleaseSmooth, 'Output');
  const removedEdges = [];
  const patchedVoices = [];

  for (const voice of voices) {
    const label = `voice${voice.voice}`;
    const pianoVoice = pianoPatch.voices[voice.voice];
    assert.equal(pianoVoice.voice, voice.voice, `${label} Piano envelope context`);
    assert(component(voice.releaseEnd, C.Expr_MathAdd.NAME),
      `${label} release boundary`);
    assert(component(voice.body?.emitter, C.AudioEmitter.NAME),
      `${label} body emitter`);
    const resolvedPianoSmooth = pianoVoice.body?.pianoSmooth;
    assert(resolvedPianoSmooth && component(resolvedPianoSmooth, C.Expr_Select.NAME),
      `${label} body attack/release smoothing Select`);

    const normalEdge = one(incoming(resolvedPianoSmooth, C.Expr_Select.NAME, 'InputA'),
      `${label} normal body release smoothing`);
    assert.deepEqual(edgeSource(normalEdge), normalReleaseSource,
      `${label} exact shared release-smoothing source`);
    scene.edges = scene.edges.filter(edge => edge !== normalEdge);
    removedEdges.push(structuredClone(normalEdge));

    const audibleWindow = voice.audibleWindow;
    assert(audibleWindow?.a && audibleWindow.at && audibleWindow.p,
      `${label} guarded audible-window source`);
    assert(byKey.has(audibleWindow.a), `${label} audible-window brick`);
    // The original audible window remains true through the complete 80 ms
    // release and already includes noteLoaded/running. Keep the existing
    // speed-normalized smoothing while it is audible; as soon as that window
    // closes, flush the hidden Dampen state with the same safe 6 ms constant
    // used for attack. This also clears idle, pre-onset and manual-stop state.
    const flushSmooth = select(audibleWindow, SILENT_FLUSH_SECONDS,
      normalReleaseSource, `${label}:silent-flush-smooth`);
    connect(source(flushSmooth, 'Output'), resolvedPianoSmooth, 'InputA');

    patchedVoices.push({voice: voice.voice, releaseEnd: voice.releaseEnd,
      pianoSmooth: resolvedPianoSmooth, audibleWindow, flushSmooth,
      normalEdge: structuredClone(normalEdge)});
  }

  assert.equal(slot, voices.length, 'one silent-flush Select per lane');
  assert.equal(removedEdges.length, voices.length,
    'one release-smoothing route replaced per lane');
  return {
    voices: patchedVoices,
    bodyReleaseSmooth: releasePatch.bodyReleaseSmooth,
    removedEdges,
    addedBricks: slot,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: releasePatch.logicGrid,
    constants: {VOICES: voices.length, GATES_PER_VOICE: 1, SILENT_FLUSH_SECONDS},
  };
}

module.exports = {apply, constants: {SILENT_FLUSH_SECONDS}};
