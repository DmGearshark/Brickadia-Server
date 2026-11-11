'use strict';

const assert = require('assert/strict');
const {C, N} = require('./loadboard-lib.cjs');

const STRIKE_GAIN = 0.38;
const STRIKE_RATE = -10;
const LEGACY_STRIKE_GAIN = 0.30;
const LEGACY_STRIKE_RATE = -6;

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;

function apply(scene, singleSourcePatch) {
  const voices = singleSourcePatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied single-source Piano graph');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano voices');

  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const patchedVoices = [];

  for (const voice of voices) {
    const attack = voice.harmonics.find(harmonic => harmonic.ratio === 2);
    assert(attack, `voice ${voice.voice} folded H2 attack`);
    assert(component(attack.exponent, C.Expr_MathMultiply.NAME),
      `voice ${voice.voice} strike exponent`);
    assert(component(attack.decayGain, C.Expr_MathMultiply.NAME),
      `voice ${voice.voice} strike gain`);
    assert.equal(incoming(attack.exponent, C.Expr_MathMultiply.NAME, 'InputB').length, 0,
      `voice ${voice.voice} strike rate is constant`);
    assert.equal(incoming(attack.decayGain, C.Expr_MathMultiply.NAME, 'InputB').length, 0,
      `voice ${voice.voice} strike gain is constant`);

    const exponent = component(attack.exponent, C.Expr_MathMultiply.NAME);
    const gain = component(attack.decayGain, C.Expr_MathMultiply.NAME);
    assert.equal(scalar(exponent.data.InputB), LEGACY_STRIKE_RATE,
      `voice ${voice.voice} approved V10.1 strike rate`);
    assert.equal(scalar(gain.data.InputB), LEGACY_STRIKE_GAIN,
      `voice ${voice.voice} approved V10.1 strike gain`);
    exponent.data.InputB = N(STRIKE_RATE);
    gain.data.InputB = N(STRIKE_GAIN);

    patchedVoices.push({voice: voice.voice, attack, exponent: attack.exponent,
      decayGain: attack.decayGain});
  }

  return {
    voices: patchedVoices,
    addedBricks: 0,
    removedBricks: 0,
    addedEdges: 0,
    removedEdges: 0,
    constants: {
      VOICES: voices.length,
      STRIKE_GAIN,
      STRIKE_RATE,
      LEGACY_STRIKE_GAIN,
      LEGACY_STRIKE_RATE,
      ATTACK_SMOOTH_SECONDS: 0.006,
    },
  };
}

module.exports = {apply, constants: {
  STRIKE_GAIN,
  STRIKE_RATE,
  LEGACY_STRIKE_GAIN,
  LEGACY_STRIKE_RATE,
  ATTACK_SMOOTH_SECONDS: 0.006,
}};
