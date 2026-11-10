'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');

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

function edgeSource(edge) {
  return {a: edge.a, at: edge.at, p: edge.p};
}

function apply(scene, pianoPatch, releasePatch) {
  const voices = pianoPatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied Piano envelope graph');
  assert.equal(releasePatch?.voices?.length, voices.length,
    'matching Piano release graph');
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, index) => index),
  'contiguous Piano voices');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));

  function setConstant(brick, type, port, value) {
    const field = schema.structs.get(brdb.COMPONENT_TYPE_STRUCTS.get(type))?.get(port);
    assert(field, `${type}.${port} field`);
    component(brick, type).data[port] = field.type === 'WireValue' ? N(value) : value;
  }

  const removedKeys = new Set();
  const volumeBranches = [];
  const ratioBranches = [];
  const bypassedBranches = [];
  const patchedVoices = [];
  const mark = (brick, label) => {
    assert(brick && byKey.has(brick.key), `${label} retained brick`);
    assert(!removedKeys.has(brick.key), `${label} unique removal`);
    removedKeys.add(brick.key);
  };

  for (const voice of voices) {
    const releaseVoice = releasePatch.voices[voice.voice];
    assert.equal(releaseVoice.voice, voice.voice,
      `voice ${voice.voice} release context`);
    const label = `voice${voice.voice}`;
    const h2 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 2),
      `${label} H2`);
    const h3 = one(voice.harmonics.filter(harmonic => harmonic.ratio === 3),
      `${label} H3`);
    const releaseH2 = one(releaseVoice.harmonics.filter(harmonic => harmonic.ratio === 2),
      `${label} release H2`);
    const releaseH3 = one(releaseVoice.harmonics.filter(harmonic => harmonic.ratio === 3),
      `${label} release H3`);

    // V7 deliberately disables both partial emitters for Piano. Their V4/V5
    // Piano-only amplitude/envelope branches remained connected to the
    // unselected side of the profile volume Selects, so they continued to
    // evaluate even though they could never be heard. Preserve H2's folded
    // strike calculation (h2.withVelocity feeds the body), but remove its
    // unused master/envelope/release tail. H3 has no surviving Piano consumer,
    // so its complete Piano synthesis tail is removable.
    for (const [brick, name] of [
      [h2.master, 'H2 master'],
      [h2.envelope, 'H2 envelope'],
      [releaseH2.releaseVolume, 'H2 release volume'],
      [h3.exponent, 'H3 exponent'],
      [h3.decay, 'H3 decay'],
      [h3.decayGain, 'H3 decay gain'],
      [h3.withVelocity, 'H3 velocity'],
      [h3.active, 'H3 active'],
      [h3.master, 'H3 master'],
      [h3.envelope, 'H3 envelope'],
      [releaseH3.releaseVolume, 'H3 release volume'],
      [voice.transientSmooth, 'partial smoothing'],
    ]) mark(brick, `${label} ${name}`);

    // Keep the volume profile Selects as update barriers. Their Piano branch
    // becomes an exact constant zero, so changing body state cannot propagate
    // to disabled AudioEmitter VolumeMultiplier ports. The legacy InputA path,
    // profile condition and emitter output remain byte-structurally exact.
    for (const harmonic of [h2, h3]) {
      const volumeSelect = harmonic.volumeSelect;
      const condition = one(incoming(volumeSelect, C.Expr_Select.NAME, 'bSelectB'),
        `${label} H${harmonic.ratio} volume profile`);
      assert.equal(condition.a, voice.isPiano.key,
        `${label} H${harmonic.ratio} Piano volume condition`);
      const legacy = one(incoming(volumeSelect, C.Expr_Select.NAME, 'InputA'),
        `${label} H${harmonic.ratio} legacy volume`);
      const piano = one(incoming(volumeSelect, C.Expr_Select.NAME, 'InputB'),
        `${label} H${harmonic.ratio} Piano volume`);
      assert.equal(piano.a, releaseVoice.harmonics.find(item =>
        item.ratio === harmonic.ratio).releaseVolume.key,
      `${label} H${harmonic.ratio} release-volume branch`);
      volumeBranches.push({voice: voice.voice, ratio: harmonic.ratio,
        select: volumeSelect, condition: edgeSource(condition),
        legacy: edgeSource(legacy), piano: structuredClone(piano)});
    }

    // Five original profile chains start with the Piano equality test: body
    // smoothing, H2 gain/ratio and H3 gain/ratio. The Piano body smoothing is
    // overridden later by profileSmooth, and the partial gain branches are
    // isolated by the zero volume Selects above. Bypass those three bottom
    // selectors to their exact non-Piano fallback constants. Keep both ratio
    // selectors and make their Piano value zero so the downstream pitch
    // multiply/clamp and disabled emitter pitch ports remain constant while
    // Piano notes retune.
    const bottomEdges = outgoing(voice.isPiano, C.Expr_CompareEqual.NAME, 'bOutput')
      .filter(edge => edge.zt === C.Expr_Select.NAME
        && String(edge.z).startsWith('['));
    assert.equal(bottomEdges.length, 5, `${label} five original Piano profile branches`);
    const bottoms = bottomEdges.map(edge => byKey.get(edge.z));
    const byPianoValue = new Map(bottoms.map(brick => [
      scalar(component(brick, C.Expr_Select.NAME).data.InputB), brick,
    ]));
    assert.equal(byPianoValue.size, 5, `${label} unique Piano profile constants`);
    const expected = new Map([
      [0.028, {kind: 'smooth', fallback: 0.025, remove: true}],
      [0.18, {kind: 'h2-gain', fallback: 0.24, remove: true}],
      [2, {kind: 'h2-ratio', fallback: 1.5, remove: false}],
      [0.06, {kind: 'h3-gain', fallback: 0.16, remove: true}],
      [3, {kind: 'h3-ratio', fallback: 2, remove: false}],
    ]);
    assert.deepEqual([...byPianoValue.keys()].sort((a, b) => a - b),
      [...expected.keys()].sort((a, b) => a - b), `${label} exact profile branches`);

    for (const [pianoValue, specification] of expected) {
      const bottom = byPianoValue.get(pianoValue);
      const data = component(bottom, C.Expr_Select.NAME).data;
      assert.equal(scalar(data.InputA), specification.fallback,
        `${label} ${specification.kind} non-Piano fallback`);
      assert.equal(incoming(bottom, C.Expr_Select.NAME, 'InputA').length, 0,
        `${label} ${specification.kind} constant fallback`);
      assert.equal(incoming(bottom, C.Expr_Select.NAME, 'InputB').length, 0,
        `${label} ${specification.kind} constant Piano value`);
      if (specification.remove) {
        const output = one(outgoing(bottom, C.Expr_Select.NAME, 'Output'),
          `${label} ${specification.kind} consumer`);
        assert.equal(output.q, 'InputA',
          `${label} ${specification.kind} is bottom of profile chain`);
        const target = byKey.get(output.z);
        assert(component(target, C.Expr_Select.NAME),
          `${label} ${specification.kind} next profile selector`);
        assert.equal(incoming(target, C.Expr_Select.NAME, 'InputA').length, 1,
          `${label} ${specification.kind} single fallback driver`);
        setConstant(target, C.Expr_Select.NAME, 'InputA', specification.fallback);
        bypassedBranches.push({voice: voice.voice, kind: specification.kind,
          select: bottom, target, output: structuredClone(output),
          fallback: specification.fallback});
        mark(bottom, `${label} ${specification.kind} bottom Select`);
      } else {
        setConstant(bottom, C.Expr_Select.NAME, 'InputB', 0);
        ratioBranches.push({voice: voice.voice, kind: specification.kind,
          select: bottom, legacyPianoValue: pianoValue,
          fallback: specification.fallback});
      }
    }

    patchedVoices.push({voice: voice.voice, isPiano: voice.isPiano,
      h2, h3, releaseH2, releaseH3});
  }

  mark(releasePatch.harmonicReleaseSmooth, 'shared harmonic release smoothing');

  const removedBricks = scene.bricks.filter(brick => removedKeys.has(brick.key));
  assert.equal(removedBricks.length, voices.length * 15 + 1,
    'fifteen dead partial/profile gates per lane plus one shared gate');
  const typeCounts = removedBricks.reduce((counts, brick) => {
    const type = primaryType(brick);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(typeCounts, {
    [C.Expr_Select.NAME]: voices.length * 5,
    [C.Expr_MathMultiply.NAME]: voices.length * 7,
    [C.Dampen.NAME]: voices.length * 2,
    [C.Expr_MathExp.NAME]: voices.length,
    [C.Expr_MathDivide.NAME]: 1,
  }, 'exact inactive-partial component budget');

  const crossingOutputs = scene.edges.filter(edge => removedKeys.has(edge.a)
    && !removedKeys.has(edge.z));
  assert.equal(crossingOutputs.length, voices.length * 5,
    'two dead volume branches and three bypassed profile branches per lane');
  assert.equal(crossingOutputs.filter(edge => edge.zt === C.Expr_Select.NAME
    && edge.q === 'InputB').length, voices.length * 2,
  'two unselected Piano volume branches per lane leave removal set');
  assert.equal(crossingOutputs.filter(edge => edge.zt === C.Expr_Select.NAME
    && edge.q === 'InputA').length, voices.length * 3,
  'three bypassed bottom-profile branches per lane leave removal set');
  const removedEdges = scene.edges.filter(edge => removedKeys.has(edge.a)
    || removedKeys.has(edge.z)).map(edge => structuredClone(edge));
  scene.edges = scene.edges.filter(edge => !removedKeys.has(edge.a)
    && !removedKeys.has(edge.z));
  scene.bricks = scene.bricks.filter(brick => !removedKeys.has(brick.key));

  for (const branch of volumeBranches) {
    assert.equal(scene.edges.filter(edge => edge.z === branch.select.key
      && edge.zt === C.Expr_Select.NAME && edge.q === 'InputB').length, 0,
    `voice ${branch.voice} H${branch.ratio} Piano volume wire removed`);
    setConstant(branch.select, C.Expr_Select.NAME, 'InputB', 0);
  }

  assert.equal(removedEdges.length, voices.length * 28 + 1,
    'twenty-eight incident wires per lane plus one shared source wire');
  return {
    voices: patchedVoices,
    removedBricks: removedBricks.map(brick => structuredClone(brick)),
    removedEdges,
    volumeBranches,
    ratioBranches,
    bypassedBranches,
    logicGrid: releasePatch.logicGrid,
    constants: {
      VOICES: voices.length,
      REMOVED_PER_VOICE: 15,
      REMOVED_SHARED: 1,
      REMOVED_BRICKS: removedBricks.length,
      REMOVED_EDGES: removedEdges.length,
      ZERO_VOLUME_BRANCHES: volumeBranches.length,
      ZERO_RATIO_BRANCHES: ratioBranches.length,
      BYPASSED_PROFILE_BRANCHES: bypassedBranches.length,
    },
  };
}

module.exports = {apply};
