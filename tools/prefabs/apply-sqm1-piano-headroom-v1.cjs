'use strict';

const assert = require('assert/strict');
const {C, N} = require('./loadboard-lib.cjs');

const HEADROOM_SCALE = 0.35;

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function edgeSource(edge) {
  return {a: edge.a, at: edge.at, p: edge.p};
}

function apply(scene, pianoPatch) {
  const voices = pianoPatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied Piano voice graph');
  const voiceOrder = voices.map(voice => voice.voice);
  assert.deepEqual(voiceOrder, Array.from({length: voices.length}, (_, index) => index),
    'contiguous Piano voices');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const bodyMasterEdges = voices.map(voice => one(incoming(voice.body.master,
    C.Expr_MathMultiply.NAME, 'InputB'), `voice ${voice.voice} body master input`));
  const effectiveVolume = edgeSource(bodyMasterEdges[0]);
  for (const [index, edge] of bodyMasterEdges.entries()) {
    assert.deepEqual(edgeSource(edge), effectiveVolume,
      `voice ${index} shares the effective volume`);
  }

  const gridBricks = scene.bricks.filter(brick => brick.g === pianoPatch.logicGrid);
  const template = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  assert(template, 'expression placement template');
  const firstY = Math.ceil((Math.max(...gridBricks.map(brick => brick.data.position[1])) + 48)
    / 48) * 48;
  const headroom = {
    key: 'sqm1p9:shared:piano-headroom',
    g: pianoPatch.logicGrid,
    data: {
      ...structuredClone(template.data),
      asset: C.Expr_MathMultiply.BRICK,
      size: [10, 5, 2],
      position: [0, firstY, 2],
    },
    comps: [{type: C.Expr_MathMultiply.NAME, data: {
      InputA: N(1),
      InputB: N(HEADROOM_SCALE),
    }}],
  };
  assert(!byKey.has(headroom.key), 'unique Piano headroom gate');
  scene.bricks.push(headroom);

  scene.edges = scene.edges.filter(edge => !bodyMasterEdges.includes(edge));
  scene.edges.push({...effectiveVolume,
    z: headroom.key, zt: C.Expr_MathMultiply.NAME, q: 'InputA'});
  for (const voice of voices) {
    scene.edges.push({a: headroom.key, at: C.Expr_MathMultiply.NAME, p: 'Output',
      z: voice.body.master.key, zt: C.Expr_MathMultiply.NAME, q: 'InputB'});
  }

  return {
    voices,
    headroom,
    effectiveVolume,
    removedEdges: bodyMasterEdges.map(edge => structuredClone(edge)),
    addedBricks: 1,
    firstY,
    logicGrid: pianoPatch.logicGrid,
    constants: {HEADROOM_SCALE, VOICES: voices.length},
  };
}

module.exports = {apply, constants: {HEADROOM_SCALE}};
