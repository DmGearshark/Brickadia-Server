'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');

const HIT_MIN = 0.1;
const HIT_MAX = 1;
const HARDNESS_SCALE = 1 / (HIT_MAX - HIT_MIN);
const BODY_STRIKE_GAIN = 0.50;
const H2_STRIKE_GAIN = 0.40;
const H2_FROM_BODY_STRIKE = H2_STRIKE_GAIN / BODY_STRIKE_GAIN;
const STRIKE_RATE = -18;
const H2_ENABLE_THRESHOLD = 0.001;
const H2_RESIDUAL_THRESHOLD = 0.0001;
const H2_RATIO = 2;
const ATTACK_SMOOTH_SECONDS = 0.006;
const LEGACY_STRIKE_GAIN = 0.38;
const LEGACY_STRIKE_RATE = -10;
const MAX_HEADROOM = 0.35;
const LEGACY_RMS_CEILING = 0.70;
const RMS_CEILING = 0.65;
const RMS_NUMERATOR = RMS_CEILING * Math.sqrt(2);
const DENOMINATOR_FLOOR = RMS_NUMERATOR / MAX_HEADROOM;

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

function apply(scene, context) {
  const pianoPatch = context?.pianoPatch;
  const singleSourcePatch = context?.singleSourcePatch;
  const inactivePartialPatch = context?.inactivePartialPatch;
  const releasePatch = context?.releasePatch;
  const headroomPatch = context?.headroomPatch;
  const compactHeadroomPatch = context?.compactHeadroomPatch;
  const voices = pianoPatch?.voices;
  assert(Array.isArray(voices) && voices.length >= 1 && voices.length <= 32,
    'applied Piano envelope graph');
  for (const patch of [singleSourcePatch, inactivePartialPatch, releasePatch]) {
    assert.equal(patch?.voices?.length, voices.length, 'matching Piano voice count');
  }
  assert.deepEqual(voices.map(voice => voice.voice),
    Array.from({length: voices.length}, (_, voice) => voice),
  'contiguous Piano voices');
  assert(headroomPatch?.headroom && compactHeadroomPatch?.energy
    && compactHeadroomPatch?.rootEnergy, 'compact adaptive headroom graph');

  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const source = (brick, port, type = primaryType(brick)) =>
    ({a: brick.key, at: type, p: port});
  const edgeSource = edge => ({a: edge.a, at: edge.at, p: edge.p});

  const logicGrid = compactHeadroomPatch.logicGrid;
  const gridBricks = scene.bricks.filter(brick => brick.g === logicGrid);
  const expressionTemplate = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  const dampenTemplate = gridBricks.find(brick => component(brick, C.Dampen.NAME));
  assert(expressionTemplate && dampenTemplate, 'expression and Dampen placement templates');
  const firstY = Math.ceil((Math.max(...gridBricks.map(brick => brick.data.position[1])) + 48)
    / 48) * 48;
  let slot = 0;
  const addedEdges = [];
  const removedEdges = [];
  const changedGates = [];

  function coerce(type, port, value) {
    const field = schema.structs.get(brdb.COMPONENT_TYPE_STRUCTS.get(type))?.get(port);
    assert(field, `${type}.${port} field`);
    if (field.type !== 'WireValue'
      || (value && typeof value === 'object' && '$variant' in value)) return value;
    if (typeof value === 'number') return N(value);
    if (typeof value === 'boolean') return B(value);
    return value;
  }

  function add(kind, data, label) {
    const definition = C[kind];
    assert(definition, `known component ${kind}`);
    const template = kind === 'Dampen' ? dampenTemplate : expressionTemplate;
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = kind === 'Dampen'
      ? structuredClone(component(dampenTemplate, C.Dampen.NAME).data) : {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p103:${label}`,
      g: logicGrid,
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
    assert.equal(incoming(target, targetType, port).length, 0,
      `unwired ${target.key}.${port}`);
    const edge = {...input, z: target.key, zt: targetType, q: port};
    scene.edges.push(edge);
    addedEdges.push(structuredClone(edge));
    return edge;
  }

  function disconnect(edge, label) {
    const index = scene.edges.indexOf(edge);
    assert(index >= 0, `${label} live edge`);
    scene.edges.splice(index, 1);
    removedEdges.push(structuredClone(edge));
  }

  function setInput(brick, port, value) {
    if (value && typeof value === 'object' && value.a) connect(value, brick, port);
    else component(brick, primaryType(brick)).data[port] =
      coerce(primaryType(brick), port, value);
  }

  function changeGate(brick, oldKind, newKind, data, label) {
    const oldDefinition = C[oldKind];
    const newDefinition = C[newKind];
    const item = component(brick, oldDefinition.NAME);
    assert(item, `${label} ${oldKind}`);
    assert(!component(brick, newDefinition.NAME), `${label} not already ${newKind}`);
    item.type = newDefinition.NAME;
    item.data = {};
    for (const [port, value] of Object.entries(data)) {
      item.data[port] = coerce(newDefinition.NAME, port, value);
    }
    brick.data.asset = newDefinition.BRICK;
    for (const edge of scene.edges) {
      if (edge.a === brick.key && edge.at === oldDefinition.NAME) edge.at = newDefinition.NAME;
      if (edge.z === brick.key && edge.zt === oldDefinition.NAME) edge.zt = newDefinition.NAME;
    }
    changedGates.push({brick, oldType: oldDefinition.NAME, newType: newDefinition.NAME});
  }

  function setConstant(brick, type, port, expected, value, label) {
    assert(component(brick, type), `${label} component`);
    assert.equal(incoming(brick, type, port).length, 0, `${label} constant input`);
    assert.equal(scalar(component(brick, type).data[port]), expected, `${label} old value`);
    component(brick, type).data[port] = coerce(type, port, value);
  }

  const patchedVoices = [];
  for (const pianoVoice of voices) {
    const voice = pianoVoice.voice;
    const label = `voice${voice}`;
    const singleVoice = singleSourcePatch.voices[voice];
    const inactiveVoice = inactivePartialPatch.voices[voice];
    const releaseVoice = releasePatch.voices[voice];
    assert.equal(singleVoice.voice, voice, `${label} single-source context`);
    assert.equal(inactiveVoice.voice, voice, `${label} inactive-partial context`);
    assert.equal(releaseVoice.voice, voice, `${label} release context`);
    const h2 = one(singleVoice.harmonics.filter(harmonic => harmonic.ratio === H2_RATIO),
      `${label} H2`);

    // Replace the old square-root compression with an explicit hit-strength
    // range and reuse its existing pure gates for normalized hardness²:
    // hit=clamp(v,.1,1), hardness=(hit-.1)/.9, impact=hardness²,
    // transientWeight=hit*impact.
    const velocityInput = one(incoming(pianoVoice.velocityRoot,
      C.Expr_MathPow.NAME, 'Input'), `${label} decoded velocity`);
    assert.equal(scalar(component(pianoVoice.velocityRoot,
      C.Expr_MathPow.NAME).data.Exponent), 0.5, `${label} legacy square root`);
    changeGate(pianoVoice.velocityRoot, 'Expr_MathPow', 'Expr_MathClamp', {
      Input: 0, Min: HIT_MIN, Max: HIT_MAX,
    }, `${label} hit strength`);
    assert.equal(incoming(pianoVoice.velocityRoot,
      C.Expr_MathClamp.NAME, 'Input').length, 1, `${label} retained decoded velocity`);
    assert.deepEqual(edgeSource(incoming(pianoVoice.velocityRoot,
      C.Expr_MathClamp.NAME, 'Input')[0]), edgeSource(velocityInput),
    `${label} exact decoded velocity source`);

    const velocitySumInputs = [...incoming(pianoVoice.velocitySum,
      C.Expr_MathAdd.NAME)];
    assert.equal(velocitySumInputs.length, 2, `${label} legacy velocity sum inputs`);
    changeGate(pianoVoice.velocitySum, 'Expr_MathAdd', 'Expr_MathSubtract', {
      InputA: 0, InputB: HIT_MIN,
    }, `${label} hardness offset`);
    for (const edge of velocitySumInputs) disconnect(edge, `${label} velocity-sum input`);
    connect(source(pianoVoice.velocityRoot, 'Output'), pianoVoice.velocitySum, 'InputA');

    setConstant(pianoVoice.shapedVelocity, C.Expr_MathMultiply.NAME, 'InputB', 0.5,
      HARDNESS_SCALE, `${label} normalized hardness`);
    setConstant(pianoVoice.brightnessScale, C.Expr_MathMultiply.NAME, 'InputB', 0.65,
      0, `${label} impact second input`);
    connect(source(pianoVoice.shapedVelocity, 'Output'), pianoVoice.brightnessScale, 'InputB');
    setConstant(pianoVoice.brightness, C.Expr_MathAdd.NAME, 'InputB', 0.35, 0,
      `${label} impact passthrough`);

    const transientWeightInput = one(incoming(pianoVoice.velocityBrightness,
      C.Expr_MathMultiply.NAME, 'InputA'), `${label} legacy transient weight`);
    assert.equal(transientWeightInput.a, pianoVoice.shapedVelocity.key,
      `${label} legacy transient used shaped velocity`);
    disconnect(transientWeightInput, `${label} transient weight input`);
    connect(source(pianoVoice.velocityRoot, 'Output'), pianoVoice.velocityBrightness, 'InputA');

    const bodyHitInput = one(incoming(pianoVoice.body.withVelocity,
      C.Expr_MathMultiply.NAME, 'InputB'), `${label} legacy body velocity`);
    assert.equal(bodyHitInput.a, pianoVoice.shapedVelocity.key,
      `${label} legacy body used shaped velocity`);
    disconnect(bodyHitInput, `${label} body hit input`);
    connect(source(pianoVoice.velocityRoot, 'Output'), pianoVoice.body.withVelocity, 'InputB');

    setConstant(h2.exponent, C.Expr_MathMultiply.NAME, 'InputB', LEGACY_STRIKE_RATE,
      STRIKE_RATE, `${label} strike rate`);
    setConstant(h2.decayGain, C.Expr_MathMultiply.NAME, 'InputB', LEGACY_STRIKE_GAIN,
      BODY_STRIKE_GAIN, `${label} body strike gain`);

    // Reuse the existing physical H2 emitter for a short velocity-dependent
    // Piano color. Non-Piano volume, pitch and enable branches remain exact.
    const h2Scale = add('Expr_MathMultiply', {InputB: H2_FROM_BODY_STRIKE},
      `${label}:h2-scale`);
    connect(source(h2.withVelocity, 'Output'), h2Scale, 'InputA');
    const h2Audible = add('Expr_CompareGreater', {InputB: H2_ENABLE_THRESHOLD},
      `${label}:h2-audible`);
    connect(source(h2Scale, 'Output'), h2Audible, 'InputA');
    const pianoH2On = add('Expr_LogicalAND', {}, `${label}:h2-on`);
    connect(source(pianoVoice.pianoActive, 'bOutput'), pianoH2On, 'bInputA');
    connect(source(h2Audible, 'bOutput'), pianoH2On, 'bInputB');
    const h2Active = add('Expr_Select', {InputA: 0}, `${label}:h2-active`);
    connect(source(pianoH2On, 'bOutput'), h2Active, 'bSelectB');
    connect(source(h2Scale, 'Output'), h2Active, 'InputB');
    const h2Master = add('Expr_MathMultiply', {}, `${label}:h2-master`);
    connect(source(h2Active, 'Output'), h2Master, 'InputA');
    connect(source(headroomPatch.headroom, 'Output'), h2Master, 'InputB');
    const h2Envelope = add('Dampen', {Target: 0, Value: 0,
      SmoothTime: ATTACK_SMOOTH_SECONDS}, `${label}:h2-envelope`);
    connect(source(h2Master, 'Output'), h2Envelope, 'Target');
    const h2Residual = add('Expr_CompareGreater', {InputB: H2_RESIDUAL_THRESHOLD},
      `${label}:h2-residual`);
    connect(source(h2Envelope, 'Value'), h2Residual, 'InputA');
    const h2SoundOn = add('Expr_LogicalOR', {}, `${label}:h2-sound-on`);
    connect(source(pianoH2On, 'bOutput'), h2SoundOn, 'bInputA');
    connect(source(h2Residual, 'bOutput'), h2SoundOn, 'bInputB');

    const volumeSelect = h2.volumeSelect;
    assert.equal(incoming(volumeSelect, C.Expr_Select.NAME, 'InputB').length, 0,
      `${label} H2 Piano volume was constant`);
    assert.equal(scalar(component(volumeSelect, C.Expr_Select.NAME).data.InputB), 0,
      `${label} H2 Piano volume was zero`);
    connect(source(h2Envelope, 'Value'), volumeSelect, 'InputB');

    const h2Enable = add('Expr_Select', {InputA: false, InputB: false},
      `${label}:h2-enable`);
    connect(source(pianoVoice.isPiano, 'bOutput'), h2Enable, 'bSelectB');
    connect(source(singleVoice.partialEnable, 'Output'), h2Enable, 'InputA');
    connect(source(h2SoundOn, 'bOutput'), h2Enable, 'InputB');
    const oldEnable = one(incoming(h2.emitter, C.AudioEmitter.NAME, 'bEnabled'),
      `${label} H2 legacy enable`);
    assert.equal(oldEnable.a, singleVoice.partialEnable.key,
      `${label} H2 shared disabled-partial enable`);
    disconnect(oldEnable, `${label} H2 legacy enable`);
    connect(source(h2Enable, 'Output'), h2.emitter, 'bEnabled');

    const ratioBranch = one(inactivePartialPatch.ratioBranches.filter(branch =>
      branch.voice === voice && branch.kind === 'h2-ratio'), `${label} H2 ratio branch`);
    setConstant(ratioBranch.select, C.Expr_Select.NAME, 'InputB', 0, H2_RATIO,
      `${label} H2 Piano ratio`);

    patchedVoices.push({voice, hit: pianoVoice.velocityRoot,
      hardnessOffset: pianoVoice.velocitySum, hardness: pianoVoice.shapedVelocity,
      impact: pianoVoice.brightnessScale, impactPass: pianoVoice.brightness,
      transientWeight: pianoVoice.velocityBrightness, h2, h2Scale, h2Audible,
      pianoH2On, h2Active, h2Master, h2Envelope, h2Residual, h2SoundOn,
      h2Enable, ratioBranch,
      oldEnable: structuredClone(oldEnable)});
  }

  // Add the second-harmonic energy to the same limiter detector. The detector
  // sees targets before headroom, while its existing slow recovery prevents a
  // six-millisecond release from briefly raising gain ahead of the Dampen.
  const h2MagnitudeGroups = [];
  for (let index = 0; index < patchedVoices.length; index += 3) {
    const members = patchedVoices.slice(index, index + 3);
    assert.equal(members.length, 3, `full H2 energy group ${index / 3}`);
    const magnitude = add('Expr_VecMagnitudeSquared', {},
      `limiter:h2-group${index / 3}`);
    for (let member = 0; member < members.length; member++) {
      connect(source(members[member].h2Active, 'Output'), magnitude,
        ['Input.X', 'Input.Y', 'Input.Z'][member]);
    }
    h2MagnitudeGroups.push({magnitude, voices: members.map(voice => voice.voice)});
  }
  let level = h2MagnitudeGroups.map(group => group.magnitude);
  const h2EnergyAdders = [];
  let depth = 0;
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      if (index + 1 === level.length) {
        next.push(level[index]);
        continue;
      }
      const sum = add('Expr_MathAdd', {}, `limiter:h2-sum${depth}:${index / 2}`);
      connect(source(level[index], 'Output'), sum, 'InputA');
      connect(source(level[index + 1], 'Output'), sum, 'InputB');
      h2EnergyAdders.push(sum);
      next.push(sum);
    }
    level = next;
    depth++;
  }
  const h2Energy = level[0];
  const totalEnergy = add('Expr_MathAdd', {}, 'limiter:body-plus-h2-energy');
  connect(source(compactHeadroomPatch.energy, 'Output'), totalEnergy, 'InputA');
  connect(source(h2Energy, 'Output'), totalEnergy, 'InputB');
  const oldRootEnergy = one(incoming(compactHeadroomPatch.rootEnergy,
    C.Expr_MathSqrt.NAME, 'Input'), 'legacy body-only limiter energy');
  assert.equal(oldRootEnergy.a, compactHeadroomPatch.energy.key,
    'limiter previously measured body energy');
  disconnect(oldRootEnergy, 'legacy limiter energy');
  connect(source(totalEnergy, 'Output'), compactHeadroomPatch.rootEnergy, 'Input');
  setConstant(compactHeadroomPatch.adaptiveScale, C.Expr_MathDivide.NAME, 'InputA',
    LEGACY_RMS_CEILING * Math.sqrt(2), RMS_NUMERATOR, 'two-frequency RMS numerator');
  setConstant(compactHeadroomPatch.safeDenominator, C.Expr_MathMax.NAME, 'InputB',
    LEGACY_RMS_CEILING * Math.sqrt(2) / MAX_HEADROOM, DENOMINATOR_FLOOR,
    'two-frequency denominator floor');

  const expectedAdded = voices.length * 9 + (voices.length / 3) * 2;
  assert.equal(slot, expectedAdded,
    'nine H2 gates per voice plus exact second-frequency energy tree');
  return {
    voices: patchedVoices,
    h2MagnitudeGroups,
    h2EnergyAdders,
    h2Energy,
    totalEnergy,
    oldRootEnergy: structuredClone(oldRootEnergy),
    changedGates,
    addedBricks: slot,
    addedEdges,
    removedEdges,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid,
    constants: {
      VOICES: voices.length,
      HIT_MIN,
      HIT_MAX,
      HARDNESS_SCALE,
      BODY_STRIKE_GAIN,
      H2_STRIKE_GAIN,
      H2_FROM_BODY_STRIKE,
      STRIKE_RATE,
      H2_ENABLE_THRESHOLD,
      H2_RESIDUAL_THRESHOLD,
      H2_RATIO,
      ATTACK_SMOOTH_SECONDS,
      MAX_HEADROOM,
      RMS_CEILING,
      RMS_NUMERATOR,
      DENOMINATOR_FLOOR,
      MAX_PIANO_SOURCES: voices.length * 2,
      ADDED_GATES_PER_VOICE: 9,
      ADDED_LIMITER_GATES: (voices.length / 3) * 2,
    },
  };
}

module.exports = {apply, constants: {
  HIT_MIN,
  HIT_MAX,
  HARDNESS_SCALE,
  BODY_STRIKE_GAIN,
  H2_STRIKE_GAIN,
  H2_FROM_BODY_STRIKE,
  STRIKE_RATE,
  H2_ENABLE_THRESHOLD,
  H2_RESIDUAL_THRESHOLD,
  H2_RATIO,
  ATTACK_SMOOTH_SECONDS,
  MAX_HEADROOM,
  RMS_CEILING,
  RMS_NUMERATOR,
  DENOMINATOR_FLOOR,
}};
