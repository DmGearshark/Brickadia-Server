'use strict';

const assert = require('assert/strict');
const {brdb} = require('brs-js');
const {C, N, S, B} = require('./loadboard-lib.cjs');

const schema = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');
const PREFIX = 'MWSP5:';
const MINIMUM_RELEASE_TAIL = 0.001;

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

function prepare(scene, pianoPreparation) {
  const voiceCount = pianoPreparation?.voices?.length;
  assert(Number.isInteger(voiceCount) && voiceCount > 0 && voiceCount <= 32,
    'prepared V4 piano voices');
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
  return {
    logicGrid: pianoPreparation.logicGrid,
    runningKey: marked('running').key,
    voices: Array.from({length: voiceCount}, (_, voice) => ({
      voice,
      startHoldKey: marked(`voice${voice}.note.start`).key,
      endHoldKey: marked(`voice${voice}.note.end`).key,
      noteLoadedKey: marked(`voice${voice}.note.loaded`).key,
    })),
  };
}

function apply(scene, preparation, pianoPatch) {
  const voiceCount = preparation?.voices?.length;
  assert(Number.isInteger(voiceCount) && voiceCount > 0 && voiceCount <= 32,
    'prepared release voices');
  assert.equal(pianoPatch?.voices?.length, voiceCount, 'applied V4 piano graph');
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
    const position = [(slot % 16) * 48, firstY + Math.floor(slot / 16) * 48, 2];
    slot++;
    const componentData = {};
    for (const [port, value] of Object.entries(data)) {
      componentData[port] = coerce(definition.NAME, port, value);
    }
    const brick = {
      key: `sqm1p5:${label}`,
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

  function select(condition, inputA, inputB, label) {
    const brick = add('Expr_Select', {}, label);
    setInput(brick, 'bSelectB', condition);
    setInput(brick, 'InputA', inputA);
    setInput(brick, 'InputB', inputB);
    return brick;
  }

  const firstVoice = pianoPatch.voices[0];
  const musicalTime = firstVoice.musicalTime;
  assert(component(musicalTime, C.Expr_MathMultiply.NAME), 'shared musical time multiply');
  const effectiveSpeedEdge = one(incoming(musicalTime, C.Expr_MathMultiply.NAME, 'InputB'),
    'effective speed source');
  const effectiveSpeed = edgeSource(effectiveSpeedEdge);

  const firstEndHold = byKey.get(preparation.voices[0].endHoldKey);
  assert(component(firstEndHold, C.Var.NAME), 'first end-hold Var');
  const releaseEndFor = (endHold, label) => one(outgoing(endHold, C.Var.NAME, 'Value')
    .filter(edge => edge.zt === C.Expr_MathAdd.NAME && edge.q === 'InputA')
    .map(edge => byKey.get(edge.z))
    .filter(brick => outgoing(brick, C.Expr_MathAdd.NAME, 'Output')
      .some(edge => edge.zt === C.Expr_CompareLessOrEqual.NAME && edge.q === 'InputB')),
  `${label} release-end add`);
  const firstReleaseEnd = releaseEndFor(firstEndHold, 'first');
  const audibleReleaseTailEdge = one(incoming(firstReleaseEnd, C.Expr_MathAdd.NAME, 'InputB'),
    'audible release-tail source');
  const audibleReleaseTail = edgeSource(audibleReleaseTailEdge);

  const tailPositive = add('Expr_CompareGreater', {InputB: 0}, 'shared:tail-positive');
  setInput(tailPositive, 'InputA', audibleReleaseTail);
  // Positive tails use their exact value, including values below one
  // millisecond, so their fade still reaches zero at releaseEnd.  The 1 ms
  // fallback only prevents division by zero on the separately selected
  // nonpositive-tail path.
  const safeReleaseTail = select(source(tailPositive, 'bOutput'), MINIMUM_RELEASE_TAIL,
    audibleReleaseTail, 'shared:safe-release-tail');
  const bodyReleaseSmooth = math('Divide', 0.07, effectiveSpeed,
    'shared:body-release-smooth');
  const harmonicReleaseSmooth = math('Divide', 0.05, effectiveSpeed,
    'shared:harmonic-release-smooth');
  const guardMusical = math('Multiply', effectiveSpeed, 0.05,
    'shared:silent-post-roll');
  const running = byKey.get(preparation.runningKey);
  assert(component(running, C.Var.NAME), 'retained running Var');

  const releaseVoices = [];
  for (const prepared of preparation.voices) {
    const voice = pianoPatch.voices[prepared.voice];
    assert.equal(voice.voice, prepared.voice, `voice ${prepared.voice} V4 context`);
    const label = `voice${prepared.voice}`;
    const startHold = byKey.get(prepared.startHoldKey);
    const endHold = byKey.get(prepared.endHoldKey);
    const noteLoaded = byKey.get(prepared.noteLoadedKey);
    assert(component(startHold, C.Var.NAME) && component(endHold, C.Var.NAME)
      && component(noteLoaded, C.Var.NAME), `${label} retained note Vars`);

    const bodyEmitter = voice.body.emitter;
    const audibleWindowEdge = one(incoming(bodyEmitter, C.AudioEmitter.NAME, 'bEnabled'),
      `${label} audible-window source`);
    const harmonicEnableEdges = voice.harmonics.map(harmonic => {
      const enableEdge = one(incoming(harmonic.emitter, C.AudioEmitter.NAME, 'bEnabled'),
        `${label} H${harmonic.ratio} audible-window source`);
      assert.deepEqual(edgeSource(enableEdge), edgeSource(audibleWindowEdge),
        `${label} shared audible window`);
      return enableEdge;
    });
    const audibleWindow = edgeSource(audibleWindowEdge);
    const releaseEnd = releaseEndFor(endHold, label);
    assert.deepEqual(edgeSource(one(incoming(releaseEnd, C.Expr_MathAdd.NAME, 'InputB'),
      `${label} audible release-tail`)), audibleReleaseTail, `${label} shared release tail`);

    // Piano remains enabled at zero volume for 50 ms of real time after the
    // musical release boundary. This gives ordinary logic updates a silent
    // enabled sample even when the clock steps over releaseEnd. Loading the
    // next note moves startHold into the future and closes this window before
    // its onset.
    const postEnd = math('Add', source(releaseEnd, 'Output'), source(guardMusical, 'Output'),
      `${label}:post-end`);
    const afterStart = add('Expr_CompareGreaterOrEqual', {}, `${label}:post-after-start`);
    setInput(afterStart, 'InputA', source(voice.musicalTime, 'Output'));
    setInput(afterStart, 'InputB', source(startHold, 'Value'));
    const beforePostEnd = add('Expr_CompareLessOrEqual', {}, `${label}:post-before-end`);
    setInput(beforePostEnd, 'InputA', source(voice.musicalTime, 'Output'));
    setInput(beforePostEnd, 'InputB', source(postEnd, 'Output'));
    const pianoTimeWindow = add('Expr_LogicalAND', {}, `${label}:piano-post-time`);
    setInput(pianoTimeWindow, 'bInputA', source(afterStart, 'bOutput'));
    setInput(pianoTimeWindow, 'bInputB', source(beforePostEnd, 'bOutput'));
    const pianoWindow = add('Expr_LogicalAND', {}, `${label}:piano-post-running`);
    setInput(pianoWindow, 'bInputA', source(pianoTimeWindow, 'bOutput'));
    setInput(pianoWindow, 'bInputB', source(running, 'Value'));
    const pianoReleaseActive = add('Expr_LogicalAND', {}, `${label}:release-active`);
    setInput(pianoReleaseActive, 'bInputA', source(voice.isPiano, 'bOutput'));
    setInput(pianoReleaseActive, 'bInputB', source(pianoWindow, 'bOutput'));
    const releaseClock = select(source(pianoReleaseActive, 'bOutput'), source(endHold, 'Value'),
      source(voice.musicalTime, 'Output'), `${label}:release-clock`);
    const releaseElapsed = math('Subtract', source(releaseClock, 'Output'),
      source(endHold, 'Value'), `${label}:release-elapsed`);
    const rawProgress = math('Divide', source(releaseElapsed, 'Output'),
      source(safeReleaseTail, 'Output'), `${label}:release-progress-raw`);
    const progress = add('Expr_MathClamp', {Min: 0, Max: 1}, `${label}:release-progress`);
    setInput(progress, 'Input', source(rawProgress, 'Output'));
    const positiveReleaseGain = math('Subtract', 1, source(progress, 'Output'),
      `${label}:positive-release-gain`);
    const zeroTailGain = select(source(voice.noteActive, 'Value'), 0, 1,
      `${label}:zero-tail-gain`);
    const releaseGain = select(source(tailPositive, 'bOutput'), source(zeroTailGain, 'Output'),
      source(positiveReleaseGain, 'Output'), `${label}:release-gain`);

    // Non-Piano profiles retain the exact original audible window. Piano uses
    // the guarded window, which closes before a future note's onset.
    const enableSelect = select(source(voice.isPiano, 'bOutput'), audibleWindow,
      source(pianoWindow, 'bOutput'), `${label}:enable-profile`);
    const legacyEnableEdges = [audibleWindowEdge, ...harmonicEnableEdges];
    scene.edges = scene.edges.filter(edge => !legacyEnableEdges.includes(edge));
    for (const emitter of [bodyEmitter, ...voice.harmonics.map(harmonic => harmonic.emitter)]) {
      connect(source(enableSelect, 'Output'), emitter, 'bEnabled');
    }

    assert.equal(incoming(voice.body.pianoSmooth, C.Expr_Select.NAME, 'InputA').length, 0,
      `${label} body release smoothing was constant`);
    connect(source(bodyReleaseSmooth, 'Output'), voice.body.pianoSmooth, 'InputA');
    assert.equal(incoming(voice.transientSmooth, C.Expr_Select.NAME, 'InputA').length, 0,
      `${label} harmonic release smoothing was constant`);
    connect(source(harmonicReleaseSmooth, 'Output'), voice.transientSmooth, 'InputA');

    const bodyVolumeEdge = one(incoming(bodyEmitter, C.AudioEmitter.NAME, 'VolumeMultiplier'),
      `${label} body volume`);
    assert.equal(bodyVolumeEdge.a, voice.body.envelope.key, `${label} V4 body envelope source`);
    scene.edges = scene.edges.filter(edge => edge !== bodyVolumeEdge);
    const pianoBodyVolume = math('Multiply', source(voice.body.envelope, 'Value'),
      source(releaseGain, 'Output'), `${label}:body-release-volume`);
    const bodyVolumeSelect = select(source(voice.isPiano, 'bOutput'),
      source(voice.body.envelope, 'Value'), source(pianoBodyVolume, 'Output'),
      `${label}:body-profile-volume`);
    connect(source(bodyVolumeSelect, 'Output'), bodyEmitter, 'VolumeMultiplier');

    const harmonics = voice.harmonics.map(harmonic => {
      const pianoVolumeEdge = one(incoming(harmonic.volumeSelect, C.Expr_Select.NAME, 'InputB'),
        `${label} H${harmonic.ratio} piano volume`);
      assert.equal(pianoVolumeEdge.a, harmonic.envelope.key,
        `${label} H${harmonic.ratio} V4 envelope source`);
      scene.edges = scene.edges.filter(edge => edge !== pianoVolumeEdge);
      const pianoVolume = math('Multiply', source(harmonic.envelope, 'Value'),
        source(releaseGain, 'Output'), `${label}:h${harmonic.ratio}-release-volume`);
      connect(source(pianoVolume, 'Output'), harmonic.volumeSelect, 'InputB');
      return {...harmonic, legacyPianoVolumeSource: edgeSource(pianoVolumeEdge),
        releaseVolume: pianoVolume};
    });

    releaseVoices.push({
      voice: prepared.voice,
      startHold,
      endHold,
      noteLoaded,
      releaseEnd,
      audibleWindow,
      postEnd,
      afterStart,
      beforePostEnd,
      pianoTimeWindow,
      pianoWindow,
      pianoReleaseActive,
      releaseClock,
      releaseElapsed,
      rawProgress,
      progress,
      positiveReleaseGain,
      zeroTailGain,
      releaseGain,
      enableSelect,
      legacyEnableSources: legacyEnableEdges.map(edgeSource),
      body: {
        legacyEmitterVolumeSource: edgeSource(bodyVolumeEdge),
        releaseVolume: pianoBodyVolume,
        volumeSelect: bodyVolumeSelect,
        emitter: bodyEmitter,
      },
      harmonics,
    });
  }

  return {
    voices: releaseVoices,
    addedBricks: slot,
    firstY,
    rows: Math.ceil(slot / 16),
    logicGrid: preparation.logicGrid,
    musicalTime,
    effectiveSpeed,
    audibleReleaseTail,
    safeReleaseTail,
    tailPositive,
    bodyReleaseSmooth,
    harmonicReleaseSmooth,
    guardMusical,
    running,
    constants: {MINIMUM_RELEASE_TAIL},
  };
}

module.exports = {prepare, apply};
