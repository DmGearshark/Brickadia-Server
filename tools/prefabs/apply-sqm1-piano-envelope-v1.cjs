'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const PREFIX = 'MWSP5:';
const VOICES = 18;

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

function prepare(scene) {
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
  const running = marked('running');
  const voices = Array.from({length: VOICES}, (_, voice) => ({
    voice,
    noteActiveKey: marked(`voice${voice}.note.active`).key,
    velocityHoldKey: marked(`voice${voice}.note.velocity`).key,
    startHoldKey: marked(`voice${voice}.note.start`).key,
  }));
  assert(voices.every(item => new Set([
    item.noteActiveKey, item.velocityHoldKey, item.startHoldKey,
  ]).size === 3), 'distinct state Vars per voice');
  return {logicGrid: running.g, voices};
}

function apply(scene, preparation) {
  assert(preparation?.voices?.length === VOICES, 'prepared eighteen-voice graph');
  const byKey = new Map(scene.bricks.map(brick => [brick.key, brick]));
  const incoming = (brick, type, port) => scene.edges.filter(edge => edge.z === brick.key
    && (!type || edge.zt === type) && (!port || edge.q === port));
  const outgoing = (brick, type, port) => scene.edges.filter(edge => edge.a === brick.key
    && (!type || edge.at === type) && (!port || edge.p === port));
  const sourceBrick = edge => {
    const brick = byKey.get(edge.a);
    assert(brick, `source brick ${edge.a}`);
    return brick;
  };
  const source = (brick, port, type = primaryType(brick)) => ({a: brick.key, at: type, p: port});
  const edgeSource = edge => ({a: edge.a, at: edge.at, p: edge.p});

  const gridBricks = scene.bricks.filter(brick => brick.g === preparation.logicGrid);
  assert(gridBricks.length > 4000, 'optimized player logic grid');
  const expressionTemplate = gridBricks.find(brick => brick.comps.length === 1
    && brick.data.asset?.startsWith('B_1x1_Gate_Expr_'));
  const dampenTemplate = gridBricks.find(brick => component(brick, C.Dampen.NAME));
  assert(expressionTemplate && dampenTemplate, 'gate placement templates');
  const firstY = Math.ceil((Math.max(...gridBricks.map(brick => brick.data.position[1])) + 48) / 48) * 48;
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
    const template = kind === 'Dampen' ? dampenTemplate : expressionTemplate;
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = kind === 'Dampen'
      ? structuredClone(component(dampenTemplate, C.Dampen.NAME).data) : {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p4:${label}`,
      g: preparation.logicGrid,
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
    else component(brick, primaryType(brick)).data[port] = coerce(primaryType(brick), port, value);
  }

  function math(kind, inputA, inputB, label) {
    const brick = add(`Expr_Math${kind}`, {}, label);
    if (kind === 'Pow') {
      setInput(brick, 'Input', inputA);
      setInput(brick, 'Exponent', inputB);
    } else {
      setInput(brick, 'InputA', inputA);
      setInput(brick, 'InputB', inputB);
    }
    return brick;
  }

  function unary(kind, input, label) {
    const brick = add(`Expr_Math${kind}`, {}, label);
    setInput(brick, 'Input', input);
    return brick;
  }

  function select(condition, inputA, inputB, label) {
    const brick = add('Expr_Select', {}, label);
    setInput(brick, 'bSelectB', condition);
    setInput(brick, 'InputA', inputA);
    setInput(brick, 'InputB', inputB);
    return brick;
  }

  function bottomProfileSelect(finalSelect) {
    let current = finalSelect;
    while (true) {
      const driver = incoming(current, C.Expr_Select.NAME, 'InputA');
      if (driver.length === 0) return current;
      const previous = sourceBrick(one(driver, `${current.key}.InputA profile driver`));
      if (!component(previous, C.Expr_Select.NAME)) return current;
      current = previous;
    }
  }

  const patchVoices = [];
  let sharedMusicalTime = null;
  let sharedEffectiveVolume = null;
  for (const prepared of preparation.voices) {
    const voice = prepared.voice;
    const prefix = `voice${voice}`;
    const noteActive = byKey.get(prepared.noteActiveKey);
    const velocityHold = byKey.get(prepared.velocityHoldKey);
    const startHold = byKey.get(prepared.startHoldKey);
    assert(component(noteActive, C.Var.NAME) && component(velocityHold, C.Var.NAME)
      && component(startHold, C.Var.NAME), `${prefix} retained state Vars`);

    const activeVolume = one(outgoing(noteActive, C.Var.NAME, 'Value')
      .filter(edge => edge.zt === C.Expr_Select.NAME && edge.q === 'bSelectB')
      .map(edge => byKey.get(edge.z))
      .filter(brick => incoming(brick, C.Expr_Select.NAME, 'InputB')
        .some(edge => edge.a === velocityHold.key)), `${prefix} active-volume Select`);
    const legacyMaster = one(outgoing(activeVolume, C.Expr_Select.NAME, 'Output')
      .filter(edge => edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputA')
      .map(edge => byKey.get(edge.z)), `${prefix} legacy master multiply`);
    const envelope = one(outgoing(legacyMaster, C.Expr_MathMultiply.NAME, 'Output')
      .filter(edge => edge.zt === C.Dampen.NAME && edge.q === 'Target')
      .map(edge => byKey.get(edge.z)), `${prefix} body Dampen`);
    const legacyTargetEdge = one(incoming(envelope, C.Dampen.NAME, 'Target'),
      `${prefix} legacy target`);
    const legacySmoothEdge = one(incoming(envelope, C.Dampen.NAME, 'SmoothTime'),
      `${prefix} legacy smoothing`);
    const effectiveVolumeEdge = one(incoming(legacyMaster, C.Expr_MathMultiply.NAME, 'InputB'),
      `${prefix} effective volume`);
    if (sharedEffectiveVolume) assert.deepEqual(edgeSource(effectiveVolumeEdge), sharedEffectiveVolume,
      `${prefix} shared effective volume`);
    else sharedEffectiveVolume = edgeSource(effectiveVolumeEdge);

    const begin = one(outgoing(startHold, C.Var.NAME, 'Value')
      .filter(edge => edge.zt === C.Expr_CompareGreaterOrEqual.NAME && edge.q === 'InputB')
      .map(edge => byKey.get(edge.z)), `${prefix} begin comparison`);
    const musicalTimeEdge = one(incoming(begin, C.Expr_CompareGreaterOrEqual.NAME, 'InputA'),
      `${prefix} musical time`);
    if (sharedMusicalTime) assert.deepEqual(edgeSource(musicalTimeEdge), sharedMusicalTime,
      `${prefix} shared musical time`);
    else sharedMusicalTime = edgeSource(musicalTimeEdge);

    const fundamentalEdge = one(outgoing(envelope, C.Dampen.NAME, 'Value')
      .filter(edge => edge.zt === C.AudioEmitter.NAME && edge.q === 'VolumeMultiplier'),
    `${prefix} fundamental emitter volume`);
    const fundamentalEmitter = byKey.get(fundamentalEdge.z);
    const legacyLayerVolumes = outgoing(envelope, C.Dampen.NAME, 'Value')
      .filter(edge => edge.zt === C.Expr_MathMultiply.NAME && edge.q === 'InputA')
      .map(edge => byKey.get(edge.z));
    assert.equal(legacyLayerVolumes.length, 2, `${prefix} two legacy harmonic volumes`);
    const layers = legacyLayerVolumes.map(legacyVolume => {
      const gainFinalEdge = one(incoming(legacyVolume, C.Expr_MathMultiply.NAME, 'InputB'),
        `${prefix} harmonic gain`);
      const gainFinal = sourceBrick(gainFinalEdge);
      assert(component(gainFinal, C.Expr_Select.NAME), `${prefix} gain profile Select`);
      const pianoSelect = bottomProfileSelect(gainFinal);
      const pianoGain = scalar(component(pianoSelect, C.Expr_Select.NAME).data.InputB);
      const emitterEdge = one(outgoing(legacyVolume, C.Expr_MathMultiply.NAME, 'Output')
        .filter(edge => edge.zt === C.AudioEmitter.NAME && edge.q === 'VolumeMultiplier'),
      `${prefix} harmonic emitter`);
      return {legacyVolume, pianoSelect, pianoGain, emitterEdge,
        emitter: byKey.get(emitterEdge.z)};
    }).sort((a, z) => z.pianoGain - a.pianoGain);
    assert.deepEqual(layers.map(layer => layer.pianoGain), [0.18, 0.06],
      `${prefix} piano H2/H3 legacy gains`);
    const pianoCheckEdge = one(incoming(layers[0].pianoSelect, C.Expr_Select.NAME, 'bSelectB'),
      `${prefix} piano profile check`);
    const isPiano = sourceBrick(pianoCheckEdge);
    assert(component(isPiano, C.Expr_CompareEqual.NAME), `${prefix} isPiano comparison`);
    assert.equal(scalar(component(isPiano, C.Expr_CompareEqual.NAME).data.InputB), 1,
      `${prefix} resolved profile 1`);
    assert.equal(one(incoming(layers[1].pianoSelect, C.Expr_Select.NAME, 'bSelectB'),
      `${prefix} shared piano check`).a, isPiano.key, `${prefix} common resolved profile check`);

    const pianoActive = add('Expr_LogicalAND', {}, `${prefix}:piano-active`);
    setInput(pianoActive, 'bInputA', source(isPiano, 'bOutput'));
    setInput(pianoActive, 'bInputB', source(noteActive, 'Value'));
    const ageClock = select(source(pianoActive, 'bOutput'), source(startHold, 'Value'),
      sharedMusicalTime, `${prefix}:age-clock`);
    const ageSubtract = math('Subtract', source(ageClock, 'Output'), source(startHold, 'Value'),
      `${prefix}:age-subtract`);
    const age = math('Max', source(ageSubtract, 'Output'), 0, `${prefix}:age`);
    const velocityRoot = math('Pow', source(velocityHold, 'Value'), 0.5,
      `${prefix}:velocity-root`);
    const velocitySum = math('Add', source(velocityHold, 'Value'), source(velocityRoot, 'Output'),
      `${prefix}:velocity-sum`);
    const shapedVelocity = math('Multiply', source(velocitySum, 'Output'), 0.5,
      `${prefix}:shaped-velocity`);
    const brightnessScale = math('Multiply', source(shapedVelocity, 'Output'), 0.65,
      `${prefix}:brightness-scale`);
    const brightness = math('Add', source(brightnessScale, 'Output'), 0.35,
      `${prefix}:brightness`);
    const velocityBrightness = math('Multiply', source(shapedVelocity, 'Output'),
      source(brightness, 'Output'), `${prefix}:velocity-brightness`);

    const bodyExponent = math('Multiply', source(age, 'Output'), -1.6,
      `${prefix}:body-exponent`);
    const bodyDecay = unary('Exp', source(bodyExponent, 'Output'), `${prefix}:body-decay`);
    const bodyScaled = math('Multiply', source(bodyDecay, 'Output'), 0.65,
      `${prefix}:body-scaled`);
    const bodyCurve = math('Add', source(bodyScaled, 'Output'), 0.35,
      `${prefix}:body-curve`);
    const bodyWithVelocity = math('Multiply', source(bodyCurve, 'Output'),
      source(shapedVelocity, 'Output'), `${prefix}:body-velocity`);
    const bodyActive = select(source(pianoActive, 'bOutput'), 0, source(bodyWithVelocity, 'Output'),
      `${prefix}:body-active`);
    const bodyMaster = math('Multiply', source(bodyActive, 'Output'), sharedEffectiveVolume,
      `${prefix}:body-master`);
    const pianoSmooth = select(source(pianoActive, 'bOutput'), 0.07, 0.006,
      `${prefix}:body-smooth`);
    const profileTarget = select(source(isPiano, 'bOutput'), edgeSource(legacyTargetEdge),
      source(bodyMaster, 'Output'), `${prefix}:profile-target`);
    const profileSmooth = select(source(isPiano, 'bOutput'), edgeSource(legacySmoothEdge),
      source(pianoSmooth, 'Output'), `${prefix}:profile-smooth`);
    scene.edges = scene.edges.filter(edge => edge !== legacyTargetEdge && edge !== legacySmoothEdge);
    connect(source(profileTarget, 'Output'), envelope, 'Target');
    connect(source(profileSmooth, 'Output'), envelope, 'SmoothTime');

    const transientSmooth = select(source(pianoActive, 'bOutput'), 0.05, 0.006,
      `${prefix}:transient-smooth`);
    const specifications = [
      {ratio: 2, floor: 0.05, gain: 0.18, rate: -6},
      {ratio: 3, floor: 0.015, gain: 0.05, rate: -8},
    ];
    const harmonics = layers.map((layer, index) => {
      const specification = specifications[index];
      const label = `${prefix}:h${specification.ratio}`;
      const exponent = math('Multiply', source(age, 'Output'), specification.rate,
        `${label}-exponent`);
      const decay = unary('Exp', source(exponent, 'Output'), `${label}-decay`);
      const decayGain = math('Multiply', source(decay, 'Output'), specification.gain,
        `${label}-decay-gain`);
      const curve = math('Add', source(decayGain, 'Output'), specification.floor,
        `${label}-curve`);
      const withVelocity = math('Multiply', source(curve, 'Output'),
        source(velocityBrightness, 'Output'), `${label}-velocity`);
      const active = select(source(pianoActive, 'bOutput'), 0, source(withVelocity, 'Output'),
        `${label}-active`);
      const master = math('Multiply', source(active, 'Output'), sharedEffectiveVolume,
        `${label}-master`);
      const harmonicEnvelope = add('Dampen', {Target: 0, SmoothTime: 0.05},
        `${label}-envelope`);
      connect(source(master, 'Output'), harmonicEnvelope, 'Target');
      connect(source(transientSmooth, 'Output'), harmonicEnvelope, 'SmoothTime');
      const volumeSelect = select(source(isPiano, 'bOutput'), source(layer.legacyVolume, 'Output'),
        source(harmonicEnvelope, 'Value'), `${label}-volume`);
      scene.edges = scene.edges.filter(edge => edge !== layer.emitterEdge);
      connect(source(volumeSelect, 'Output'), layer.emitter, 'VolumeMultiplier');
      return {...specification, exponent, decay, decayGain, curve, withVelocity, active, master,
        envelope: harmonicEnvelope, volumeSelect, emitter: layer.emitter,
        legacyVolumeSource: source(layer.legacyVolume, 'Output')};
    });

    patchVoices.push({
      voice, isPiano, pianoActive, ageClock,
      musicalTime: byKey.get(sharedMusicalTime.a), startHold, noteActive,
      velocityHold, effectiveVolume: byKey.get(sharedEffectiveVolume.a), activeVolume,
      legacyMaster, ageSubtract, age, velocityRoot, velocitySum, shapedVelocity,
      brightnessScale, brightness, velocityBrightness,
      body: {
        exponent: bodyExponent, decay: bodyDecay, scaled: bodyScaled, curve: bodyCurve,
        withVelocity: bodyWithVelocity, active: bodyActive, master: bodyMaster,
        pianoSmooth, profileTarget, profileSmooth, envelope, emitter: fundamentalEmitter,
        legacy: {targetSource: edgeSource(legacyTargetEdge),
          smoothSource: edgeSource(legacySmoothEdge)},
      },
      transientSmooth,
      harmonics,
    });
  }

  assert.equal(new Set(patchVoices.map(voice => voice.isPiano.key)).size, VOICES,
    'one resolved piano profile check per voice');
  assert.equal(scene.bricks.filter(brick => component(brick, C.Dampen.NAME)).length, 54,
    'one body and two harmonic Dampens per voice');
  return {
    voices: patchVoices,
    addedBricks: slot,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: preparation.logicGrid,
    sharedMusicalTime,
    sharedEffectiveVolume,
  };
}

module.exports = {prepare, apply};
