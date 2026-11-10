'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C} = require('./loadboard-lib.cjs');
const validatePlacement = require('./validate-placement.cjs');

const component = (brick, type) => brick?.comps.find(candidate => candidate.type === type);
const scalar = value => value && typeof value === 'object' && 'value' in value
  ? value.value : value;

function one(items, label) {
  assert.equal(items.length, 1, label);
  return items[0];
}

function sourceId(edge) {
  return JSON.stringify({a: edge.a, at: edge.at, p: edge.p});
}

function test(context) {
  const {scene, bytes, adaptiveHeadroomPatch: patch, headroomPatch, singleSourcePatch} = context;
  assert(scene && bytes && patch && headroomPatch && singleSourcePatch,
    'adaptive-headroom test context');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && edge.zt === type && edge.q === port);
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && edge.at === type && edge.p === port);

  assert.equal(patch.voices.length, 24);
  assert.equal(patch.squares.length, 24);
  assert.equal(patch.adders.length, 23);
  assert.equal(patch.addedBricks, 54);
  assert.equal(patch.sumDepth, 5);
  assert.deepEqual(patch.constants, {
    MAX_HEADROOM: 0.35,
    RMS_CEILING: 0.70,
    RMS_NUMERATOR: 0.70 * Math.sqrt(2),
    ENERGY_FLOOR: 1e-9,
    RECOVERY_SMOOTH_SECONDS: 0.12,
    VOICES: 24,
  });
  assert.equal(scene.bricks.filter(brick => brick.key.startsWith('sqm1p10gain:')).length, 54);

  for (let voice = 0; voice < 24; voice++) {
    const square = patch.squares[voice];
    assert(component(square, C.Expr_MathMultiply.NAME), `voice ${voice} energy square`);
    const active = singleSourcePatch.voices[voice].body.active;
    const expected = JSON.stringify({a: active.key, at: C.Expr_Select.NAME, p: 'Output'});
    assert.equal(sourceId(one(incoming(square, C.Expr_MathMultiply.NAME, 'InputA'),
      `voice ${voice} energy A`)), expected);
    assert.equal(sourceId(one(incoming(square, C.Expr_MathMultiply.NAME, 'InputB'),
      `voice ${voice} energy B`)), expected);
  }
  assert.equal(incoming(patch.safeEnergy, C.Expr_MathMax.NAME, 'InputA').length, 1);
  assert.equal(incoming(patch.safeEnergy, C.Expr_MathMax.NAME, 'InputB').length, 0);
  assert.equal(scalar(component(patch.safeEnergy, C.Expr_MathMax.NAME).data.InputB), 1e-9);
  assert.equal(scalar(component(patch.rootEnergy, C.Expr_MathPow.NAME).data.Exponent), 0.5);
  assert.equal(sourceId(one(incoming(patch.denominator,
    C.Expr_MathMultiply.NAME, 'InputA'), 'effective volume')),
  JSON.stringify(headroomPatch.effectiveVolume));
  assert.equal(sourceId(one(incoming(patch.denominator,
    C.Expr_MathMultiply.NAME, 'InputB'), 'root energy')),
  JSON.stringify({a: patch.rootEnergy.key, at: C.Expr_MathPow.NAME, p: 'Output'}));
  assert.equal(scalar(component(patch.ceilingScale,
    C.Expr_MathDivide.NAME).data.InputA), 0.70 * Math.sqrt(2));
  assert.equal(scalar(component(patch.adaptiveScale,
    C.Expr_MathMin.NAME).data.InputB), 0.35);
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.SmoothTime), 0.12);
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.Target), 0.35,
    'recovery target starts at the V9 ceiling');
  assert.equal(scalar(component(patch.recovery, C.Dampen.NAME).data.Value), 0.35,
    'recovery value starts at the V9 ceiling without first-note fade-in');
  assert.equal(sourceId(one(incoming(patch.recovery,
    C.Dampen.NAME, 'Target'), 'recovery target')),
  JSON.stringify({a: patch.adaptiveScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(patch.finalScale,
    C.Expr_MathMin.NAME, 'InputA'), 'immediate attenuation')),
  JSON.stringify({a: patch.adaptiveScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));
  assert.equal(sourceId(one(incoming(patch.finalScale,
    C.Expr_MathMin.NAME, 'InputB'), 'slow recovery')),
  JSON.stringify({a: patch.recovery.key, at: C.Dampen.NAME, p: 'Value'}));
  assert.equal(sourceId(one(incoming(headroomPatch.headroom,
    C.Expr_MathMultiply.NAME, 'InputB'), 'adaptive V9 headroom factor')),
  JSON.stringify({a: patch.finalScale.key, at: C.Expr_MathMin.NAME, p: 'Output'}));
  assert.equal(outgoing(patch.adaptiveScale, C.Expr_MathMin.NAME, 'Output').length, 2);
  assert.equal(outgoing(patch.finalScale, C.Expr_MathMin.NAME, 'Output').length, 1);

  const scale = (volume, amplitudes) => Math.min(0.35,
    0.70 * Math.sqrt(2) / (volume
      * Math.sqrt(Math.max(1e-9, amplitudes.reduce((sum, value) => sum + value ** 2, 0)))));
  assert.equal(scale(1, []), 0.35, 'silence keeps V9 headroom');
  assert.equal(scale(2, [1.3]), 0.35, 'one full strike keeps V9 headroom at volume 2');
  const loudChord = Array(24).fill(1.3);
  const chordScale = scale(2, loudChord);
  assert(chordScale < 0.08, 'dense full-level chord is attenuated');
  const resultingRms = 2 * chordScale
    * Math.sqrt(loudChord.reduce((sum, value) => sum + value ** 2, 0) / 2);
  assert(Math.abs(resultingRms - 0.70) < 1e-12, 'dense energy is limited to the 0.70 target');
  for (const volume of [1, 1.5, 2]) for (const amplitudes of [
    [0.2], [1.3], Array(4).fill(0.7), Array(24).fill(1.3),
  ]) assert(scale(volume, amplitudes) <= 0.35,
  'adaptive gain never boosts above V9');

  const placement = validatePlacement(bytes);
  assert(placement.strictOk, JSON.stringify(placement));
  const targets = new Set();
  for (const edge of scene.edges) {
    assert(byKey.get(edge.a)?.comps.some(item => item.type === edge.at),
      `valid source ${edge.a}`);
    assert(byKey.get(edge.z)?.comps.some(item => item.type === edge.zt),
      `valid target ${edge.z}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.at)?.outputs.includes(edge.p),
      `valid output ${edge.at}.${edge.p}`);
    assert(brdb.COMPONENT_WIRE_PORTS.get(edge.zt)?.inputs.includes(edge.q),
      `valid input ${edge.zt}.${edge.q}`);
    const target = `${edge.z}:${edge.zt}:${edge.q}`;
    assert(!targets.has(target), `unique target ${target}`);
    targets.add(target);
  }
  console.log('SQM1 adaptive Piano headroom checks passed: 24 pre-master energy taps, '
    + 'balanced squared-energy sum, non-boosting 0.35 ceiling, 0.70 dense RMS target, '
    + 'immediate attenuation, 120 ms recovery, strict placement and valid unique wiring.');
  return {placement, chordScale};
}

module.exports = test;

if (require.main === module) {
  const buildV9 = require('./build-sqm1-piano-player-v9.cjs');
  const adaptive = require('./apply-sqm1-piano-adaptive-headroom-v1.cjs');
  const {read, write} = require('./reskin-loadboard.cjs');
  const build = () => {
    const context = buildV9();
    const adaptiveHeadroomPatch = adaptive.apply(context.scene,
      context.headroomPatch, context.singleSourcePatch);
    const result = write(context.scene, {name: 'Adaptive headroom test',
      description: 'Adaptive headroom test'});
    return {...context, bytes: result.bytes, outputScene: read(result.bytes),
      adaptiveHeadroomPatch};
  };
  const first = build();
  test(first);
  const second = build();
  assert.deepEqual(Buffer.from(second.bytes), Buffer.from(first.bytes),
    'adaptive-headroom build is deterministic');
}
