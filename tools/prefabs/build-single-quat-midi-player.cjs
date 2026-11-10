'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const {World, WorldReader, brdb: b} = require('brs-js');
const validatePlacement = require('./validate-placement.cjs');

const C = b.COMPONENTS;
const MAGIC = 7701001;
const FORMAT_VERSION = 1;
const MAXIMUM_VOICES = 32;
const HEADER_QUATS = 2 + MAXIMUM_VOICES;
const PITCH_MIN = 0.1;
const PITCH_MAX = 10;
const EPSILON = 1e-7;

const N = value => ({$variant: 'f64', value});
const B = value => ({$variant: 'Bool', value});

function finite(value, label) {
  assert.equal(typeof value, 'number', `${label} must be a number`);
  assert(Number.isFinite(value), `${label} must be finite`);
  return value;
}

function integer(value, label) {
  finite(value, label);
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  return value;
}

function quat(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a quaternion object`);
  return {
    X: finite(value.X, `${label}.X`),
    Y: finite(value.Y, `${label}.Y`),
    Z: finite(value.Z, `${label}.Z`),
    W: finite(value.W, `${label}.W`),
  };
}

function scoreTitle(raw, file) {
  if (raw.title || raw.name) return String(raw.title || raw.name).slice(0, 80);
  const source = raw.source && raw.source.filename
    ? path.basename(String(raw.source.filename), path.extname(String(raw.source.filename)))
    : path.basename(file, path.extname(file));
  if (/viva[-_ ]la[-_ ]vida.*piano[-_ ]violin[-_ ]duet/i.test(source)) {
    return 'Viva La Vida - Piano Violin Duet';
  }
  return source.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 80);
}

function parseScore(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.schema, 'brickadia-midi-single-quat-array', 'Unsupported score schema');
  assert.equal(integer(raw.version, 'version'), FORMAT_VERSION, 'Unsupported score version');
  assert.equal(integer(raw.maximumVoices, 'maximumVoices'), MAXIMUM_VOICES,
    `maximumVoices must be ${MAXIMUM_VOICES}`);
  assert(raw.array && typeof raw.array === 'object', 'array object is required');
  assert.equal(raw.array.elementType, 'Quat', 'array.elementType must be Quat');
  assert(Array.isArray(raw.array.values), 'array.values must be an array');
  assert(raw.array.values.length >= HEADER_QUATS, `array.values needs ${HEADER_QUATS} header quaternions`);

  const values = raw.array.values.map((value, index) => quat(value, `array.values[${index}]`));
  const global = values[0];
  assert.equal(integer(global.X, 'global magic'), MAGIC, 'Score magic mismatch');
  assert.equal(integer(global.Y, 'global version'), FORMAT_VERSION, 'Header version mismatch');
  const activeVoices = integer(global.Z, 'active voice count');
  assert(activeVoices >= 1 && activeVoices <= MAXIMUM_VOICES,
    `active voice count must be within 1..${MAXIMUM_VOICES}`);
  if (raw.activeVoices !== undefined) {
    assert.equal(integer(raw.activeVoices, 'activeVoices'), activeVoices, 'activeVoices disagrees with header');
  }
  const duration = finite(global.W, 'durationSeconds');
  assert(duration > 0, 'durationSeconds must be positive');
  if (raw.durationSeconds !== undefined) {
    assert(Math.abs(finite(raw.durationSeconds, 'durationSeconds') - duration) <= EPSILON,
      'durationSeconds disagrees with header');
  }

  const format = values[1];
  assert.equal(integer(format.X, 'headerLength'), HEADER_QUATS, `headerLength must be ${HEADER_QUATS}`);
  const releaseTail = finite(format.Y, 'header releaseTailSeconds');
  assert(releaseTail >= 0 && releaseTail <= 5, 'releaseTailSeconds must be within 0..5 seconds');
  assert(Math.abs(finite(raw.releaseTailSeconds, 'releaseTailSeconds') - releaseTail) <= EPSILON,
    'releaseTailSeconds disagrees with header');
  const declaredMinMidi = integer(format.Z, 'header minMidi');
  const declaredMaxMidi = integer(format.W, 'header maxMidi');
  assert(declaredMinMidi >= 0 && declaredMinMidi <= 127, 'header minMidi is outside 0..127');
  assert(declaredMaxMidi >= declaredMinMidi && declaredMaxMidi <= 127,
    'header maxMidi is outside minMidi..127');
  if (raw.flags && raw.flags.releaseTailReserved !== undefined) {
    assert.equal(raw.flags.releaseTailReserved, releaseTail > 0,
      'flags.releaseTailReserved disagrees with releaseTailSeconds');
  }

  const voices = [];
  let expectedOffset = HEADER_QUATS;
  let totalNotes = 0;
  let maximumEnd = 0;
  let actualMinMidi = Infinity;
  let actualMaxMidi = -Infinity;
  for (let voiceIndex = 0; voiceIndex < MAXIMUM_VOICES; voiceIndex++) {
    const header = values[2 + voiceIndex];
    const offset = integer(header.X, `voice ${voiceIndex} offset`);
    const count = integer(header.Y, `voice ${voiceIndex} count`);
    const instrumentCode = integer(header.Z, `voice ${voiceIndex} instrumentCode`);
    const channelTrackCode = integer(header.W, `voice ${voiceIndex} channelTrackCode`);

    if (voiceIndex >= activeVoices) {
      assert.equal(count, 0, `unused voice ${voiceIndex} must have count 0`);
      assert.equal(instrumentCode, -1, `unused voice ${voiceIndex} must have instrumentCode -1`);
      assert.equal(channelTrackCode, -1, `unused voice ${voiceIndex} must have channelTrackCode -1`);
      assert(offset >= HEADER_QUATS && offset <= values.length,
        `unused voice ${voiceIndex} cursor is outside the array`);
      continue;
    }

    assert(count > 0, `active voice ${voiceIndex} has no notes`);
    assert.equal(offset, expectedOffset, `voice ${voiceIndex} is not contiguous with the prior segment`);
    assert(offset + count <= values.length, `voice ${voiceIndex} segment exceeds the shared array`);
    assert(instrumentCode >= 0 && instrumentCode <= 255,
      `voice ${voiceIndex} instrumentCode must be within 0..255`);
    assert(channelTrackCode >= 0, `voice ${voiceIndex} channelTrackCode must be nonnegative`);

    const channel = channelTrackCode % 16;
    const track = Math.floor(channelTrackCode / 16);
    assert(channel >= 0 && channel <= 15, `voice ${voiceIndex} channel is outside 0..15`);
    assert.equal(instrumentCode >= 128, channel === 9,
      `voice ${voiceIndex} percussion marker disagrees with channel`);

    const notes = [];
    let priorEndWithTail = -Infinity;
    for (let noteIndex = 0; noteIndex < count; noteIndex++) {
      const note = values[offset + noteIndex];
      const start = note.X;
      const end = note.Y;
      const midiNote = integer(note.Z, `voice ${voiceIndex} note ${noteIndex} MIDI note`);
      const velocity = integer(note.W, `voice ${voiceIndex} note ${noteIndex} velocity`);
      assert(start >= 0, `voice ${voiceIndex} note ${noteIndex} starts before zero`);
      assert(end > start, `voice ${voiceIndex} note ${noteIndex} must have positive duration`);
      assert(end <= duration + EPSILON, `voice ${voiceIndex} note ${noteIndex} ends after score duration`);
      assert(midiNote >= 0 && midiNote <= 127, `voice ${voiceIndex} note ${noteIndex} MIDI note is outside 0..127`);
      assert(velocity >= 1 && velocity <= 127, `voice ${voiceIndex} note ${noteIndex} velocity is outside 1..127`);
      assert(start + EPSILON >= priorEndWithTail,
        `voice ${voiceIndex} note ${noteIndex} overlaps the prior note's reserved release tail`);
      const pitch = 2 ** ((midiNote - 69) / 12);
      assert(pitch >= PITCH_MIN && pitch <= PITCH_MAX,
        `voice ${voiceIndex} note ${noteIndex} pitch ${pitch} is outside ${PITCH_MIN}..${PITCH_MAX}`);
      notes.push({start, end, midiNote, velocity, pitch});
      actualMinMidi = Math.min(actualMinMidi, midiNote);
      actualMaxMidi = Math.max(actualMaxMidi, midiNote);
      priorEndWithTail = end + releaseTail;
      maximumEnd = Math.max(maximumEnd, end);
    }

    voices.push({voiceIndex, offset, count, instrumentCode, channelTrackCode, channel, track, notes});
    expectedOffset += count;
    totalNotes += count;
  }
  assert.equal(expectedOffset, values.length, 'Shared array has unreferenced or duplicate note quaternions');
  assert(maximumEnd <= duration + EPSILON, 'Score duration is shorter than its notes');
  assert.equal(actualMinMidi, declaredMinMidi, 'header minMidi disagrees with note data');
  assert.equal(actualMaxMidi, declaredMaxMidi, 'header maxMidi disagrees with note data');

  return {
    raw,
    values,
    voices,
    activeVoices,
    totalNotes,
    duration,
    releaseTail,
    title: scoreTitle(raw, file),
  };
}

function waveForProgram(instrumentCode) {
  integer(instrumentCode, 'instrumentCode');
  return 'Sine';
}

const ASSET_FOR_WAVE = {
  Sine: 'BA_Synth_Basic_Sine',
  Square: 'BA_Synth_Basic_Square',
  Triangle: 'BA_Synth_Basic_Triangle',
  Sawtooth: 'BA_Synth_Basic_Sawtooth',
};

function layersForVoice(voice) {
  const program = voice.instrumentCode & 127;
  const wave = waveForProgram(voice.instrumentCode);
  if (voice.instrumentCode < 128 && program === 0) {
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    for (const note of voice.notes) {
      minPitch = Math.min(minPitch, note.pitch);
      maxPitch = Math.max(maxPitch, note.pitch);
    }
    const detuned = minPitch * 2 ** (-0.7 / 1200) >= PITCH_MIN
      && maxPitch * 2 ** (0.9 / 1200) <= PITCH_MAX;
    const harmonic = minPitch * 2.0015 >= PITCH_MIN && maxPitch * 2.0015 <= PITCH_MAX;
    const layers = detuned
      ? [
          {wave, pitchScale: 2 ** (-0.7 / 1200), gain: 0.55, envelope: 'body'},
          {wave, pitchScale: 2 ** (0.9 / 1200), gain: 0.55, envelope: 'body'},
        ]
      : [{wave, pitchScale: 1, gain: 1, envelope: 'body'}];
    if (harmonic) layers.push({wave, pitchScale: 2.0015, gain: 1, envelope: 'harmonic'});
    return layers;
  }
  return [{wave, pitchScale: 1, gain: 0.85, envelope: 'sustain'}];
}

function build(score) {
  const voiceLayers = score.voices.map(voice => layersForVoice(voice));
  const waveNames = [...new Set(voiceLayers.flat().map(layer => layer.wave))];
  assert.deepEqual(waveNames, ['Sine'], 'This player intentionally supports only the sine synth');
  const externalAssets = waveNames.map(wave => ({type: 'BrickAudioDescriptor', name: ASSET_FOR_WAVE[wave]}));
  const assetIndex = new Map(waveNames.map((wave, index) => [wave, index]));
  const emitterTotal = voiceLayers.reduce((sum, layers) => sum + layers.length, 0);

  const w = new World();
  const chip = w.addMicrochip({position: [0, 0, 2], color: [65, 110, 150]});
  const nodes = [];
  const links = [];
  const inputs = new Set();
  let gateIndex = 0;
  let emitterIndex = 0;

  function nextGatePosition() {
    const columns = 24;
    const index = gateIndex++;
    return [5 + (index % columns) * 12, 5 + Math.floor(index / columns) * 12, 2];
  }

  function speakerPosition(index) {
    const columns = 8;
    return [-42 + (index % columns) * 12, 20 + Math.floor(index / columns) * 12, 2];
  }

  function node(kind, data = {}, main = false, position) {
    const component = C[kind];
    assert(component, `Unknown component ${kind}`);
    const isEmitter = kind === 'AudioEmitter';
    const brick = w.addBrick({
      asset: component.BRICK || 'PB_DefaultMicroBrick',
      ...(!component.BRICK ? {size: [1, 1, 1]} : {}),
      position: position || (isEmitter ? speakerPosition(emitterIndex++) : nextGatePosition()),
      color: isEmitter ? [85, 105, 150] : [65, 100, 145],
      components: [{type: component.NAME, data}],
    }, main ? undefined : chip.grid);
    const result = {brick, kind, id: nodes.length, data};
    nodes.push(result);
    return result;
  }

  function wire(source, output, target, input) {
    const key = `${target.id}:${input}`;
    assert(!inputs.has(key), `Multiple sources for ${target.kind}.${input}`);
    inputs.add(key);
    const sourcePorts = b.COMPONENT_WIRE_PORTS.get(C[source.kind].NAME);
    const targetPorts = b.COMPONENT_WIRE_PORTS.get(C[target.kind].NAME);
    assert(sourcePorts.outputs.includes(output), `${source.kind}.${output} is not an output`);
    assert(targetPorts.inputs.includes(input), `${target.kind}.${input} is not an input`);
    w.addWire(
      {brick: source.brick, component_type: C[source.kind].NAME, port: output},
      {brick: target.brick, component_type: C[target.kind].NAME, port: input},
    );
    links.push({source: source.id, output, target: target.id, input});
  }

  function unary(kind, source, output, input) {
    const result = node(kind);
    wire(source, output, result, input);
    return result;
  }

  function binary(kind, a, aOutput, z, zOutput, aInput = 'bInputA', zInput = 'bInputB') {
    const result = node(kind);
    wire(a, aOutput, result, aInput);
    wire(z, zOutput, result, zInput);
    return result;
  }

  function setter(reference, value) {
    const result = node('Exec_Var_Set', {Value: value});
    wire(reference, 'VarRef', result, 'VarRef');
    return result;
  }

  function button(label, x, color) {
    const brick = w.addBrick({
      asset: 'PB_DefaultMicroBrick',
      size: [12, 8, 2],
      position: [x, -18, 2],
      color,
      components: [
        {type: C.Button.NAME, data: {PromptCustomLabel: label}},
        {type: C.TextDisplay.NAME, data: {Text: label, Face: 4, LineHeight: 6}},
      ],
    });
    const result = {brick, kind: 'Button', id: nodes.length};
    nodes.push(result);
    return result;
  }

  function label(text, x, y, width = 20) {
    w.addBrick({
      asset: 'PB_DefaultMicroBrick',
      size: [width, 5, 1],
      position: [x, y, 1],
      color: [25, 30, 40],
      components: [{type: C.TextDisplay.NAME, data: {Text: text, Face: 4, LineHeight: 3}}],
    });
  }

  const play = button('PLAY', -17, [30, 150, 70]);
  const stop = button('STOP', 17, [180, 45, 40]);
  const tune = node('Var', {Value: N(1)}, true, [-24, -38, 2]);
  const volume = node('Var', {Value: N(0.06)}, true, [0, -38, 2]);
  const speed = node('Var', {Value: N(1)}, true, [24, -38, 2]);
  label('PITCH x1', -34, -50, 15);
  label('VOLUME x0.06', 0, -50, 17);
  label('SPEED x1', 34, -50, 15);
  label(`${score.title} / ${score.activeVoices} VOICES`, 0, -64, 45);
  label('ONE SHARED QUAT SCORE ARRAY', 0, -76, 40);

  const sharedArray = node('ArrayVar', {
    Value: {$elementType: 'Quat', $array: score.values.map(value => ({...value}))},
  });
  const running = node('Var', {Value: B(false)});
  const start = node('Var', {Value: N(0)});
  const clock = node('Stopwatch', {Time: 0, Limit: 1e9, bRunning: true});
  const elapsed = node('Expr_MathSubtract');
  wire(clock, 'Time', elapsed, 'InputA');
  wire(start, 'Value', elapsed, 'InputB');
  const musicalTime = node('Expr_MathMultiply');
  wire(elapsed, 'Output', musicalTime, 'InputA');
  wire(speed, 'Value', musicalTime, 'InputB');

  const idle = unary('Expr_LogicalNOT', running, 'Value', 'bInput');
  const allowed = binary('Expr_LogicalAND', play, 'bHeld', idle, 'bOutput');
  const playEdge = unary('Expr_EdgeDetectorExec', allowed, 'bOutput', 'Input');
  const capture = node('Exec_Var_Set');
  wire(start, 'VarRef', capture, 'VarRef');
  wire(clock, 'Time', capture, 'Value');
  wire(playEdge, 'OnRisingEdge', capture, 'Exec');
  const go = setter(running, B(true));
  wire(capture, 'ExecOut', go, 'Exec');

  const finish = node('Expr_CompareGreaterOrEqual', {InputB: N(score.duration + Math.max(0.25, score.releaseTail))});
  wire(musicalTime, 'Output', finish, 'InputA');
  const finishPlaying = binary('Expr_LogicalAND', finish, 'bOutput', running, 'Value');
  const stopSignal = binary('Expr_LogicalOR', stop, 'bHeld', finishPlaying, 'bOutput');
  const stopEdge = unary('Expr_EdgeDetectorExec', stopSignal, 'bOutput', 'Input');
  const halt = setter(running, B(false));
  wire(stopEdge, 'OnRisingEdge', halt, 'Exec');

  const voiceBuilds = [];
  for (let voiceIndex = 0; voiceIndex < score.voices.length; voiceIndex++) {
    const voice = score.voices[voiceIndex];
    const layers = voiceLayers[voiceIndex];
    const index = node('Var', {Value: N(voice.offset)});
    const active = node('Var', {Value: B(false)});
    const loaded = node('Var', {Value: B(false)});
    const pitchHold = node('Var', {Value: N(voice.notes[0].pitch)});
    const velocityHold = node('Var', {Value: N((voice.notes[0].velocity / 127) ** 1.4)});
    const startHold = node('Var', {Value: N(voice.notes[0].start)});

    const reset = setter(index, N(voice.offset));
    wire(go, 'ExecOut', reset, 'Exec');
    const advance = node('Exec_Var_Increment', {Value: N(1)});
    wire(index, 'VarRef', advance, 'VarRef');
    const load = node('Exec_Union');
    wire(reset, 'ExecOut', load, 'ExecA');
    wire(advance, 'ExecOut', load, 'ExecB');
    const unload = setter(loaded, B(false));
    wire(load, 'ExecOut', unload, 'Exec');
    const get = node('Exec_ArrayVar_Get');
    wire(sharedArray, 'ArrayVarRef', get, 'ArrayVarRef');
    wire(index, 'Value', get, 'Index');
    wire(unload, 'ExecOut', get, 'Exec');
    const split = node('Expr_SplitQuaternion');
    wire(get, 'Value', split, 'Input');

    const begin = node('Expr_CompareGreaterOrEqual');
    wire(musicalTime, 'Output', begin, 'InputA');
    wire(split, 'X', begin, 'InputB');
    const end = node('Expr_CompareGreaterOrEqual');
    wire(musicalTime, 'Output', end, 'InputA');
    wire(split, 'Y', end, 'InputB');
    const inactive = unary('Expr_LogicalNOT', active, 'Value', 'bInput');
    const canPlay = binary('Expr_LogicalAND', running, 'Value', loaded, 'Value');
    // Edge note-on only while the loaded record is inside [start, end). Using
    // only `begin && !active` re-arms an expired record immediately after its
    // key-off setter runs, so release/advance never sees an inactive voice.
    const beforeEnd = node('Expr_CompareLess');
    wire(musicalTime, 'Output', beforeEnd, 'InputA');
    wire(split, 'Y', beforeEnd, 'InputB');
    const due = binary('Expr_LogicalAND', begin, 'bOutput', beforeEnd, 'bOutput');
    const fire = binary('Expr_LogicalAND', due, 'bOutput', canPlay, 'bOutput');
    const on = unary('Expr_EdgeDetectorExec', fire, 'bOutput', 'Input');

    const semitone = node('Expr_MathSubtract', {InputB: N(69)});
    wire(split, 'Z', semitone, 'InputA');
    const octave = node('Expr_MathDivide', {InputB: N(12)});
    wire(semitone, 'Output', octave, 'InputA');
    // MathPow is exceptional among numeric expression gates: its saved Input
    // and Exponent fields are bare f64 values, not WireValue variants.
    const pitchRatio = node('Expr_MathPow', {Input: 2});
    wire(octave, 'Output', pitchRatio, 'Exponent');
    const velocityUnit = node('Expr_MathDivide', {InputB: N(127)});
    wire(split, 'W', velocityUnit, 'InputA');
    const velocityCurve = node('Expr_MathPow', {Exponent: 1.4});
    wire(velocityUnit, 'Output', velocityCurve, 'Input');

    const setPitch = setter(pitchHold, N(voice.notes[0].pitch));
    wire(pitchRatio, 'Output', setPitch, 'Value');
    wire(get, 'ExecOut', setPitch, 'Exec');
    const setVelocity = setter(velocityHold, N((voice.notes[0].velocity / 127) ** 1.4));
    wire(velocityCurve, 'Output', setVelocity, 'Value');
    wire(setPitch, 'ExecOut', setVelocity, 'Exec');
    const setStart = setter(startHold, N(voice.notes[0].start));
    wire(split, 'X', setStart, 'Value');
    wire(setVelocity, 'ExecOut', setStart, 'Exec');
    const ready = setter(loaded, B(true));
    wire(setStart, 'ExecOut', ready, 'Exec');
    const setOn = setter(active, B(true));
    wire(on, 'OnRisingEdge', setOn, 'Exec');

    const endOrStop = binary('Expr_LogicalOR', end, 'bOutput', idle, 'bOutput');
    const ending = binary('Expr_LogicalAND', endOrStop, 'bOutput', active, 'Value');
    const off = unary('Expr_EdgeDetectorExec', ending, 'bOutput', 'Input');
    const setOff = setter(active, B(false));
    wire(off, 'OnRisingEdge', setOff, 'Exec');

    const releaseEnd = node('Expr_MathAdd', {InputB: N(score.releaseTail)});
    wire(split, 'Y', releaseEnd, 'InputA');
    const beforeReleaseEnd = node('Expr_CompareLessOrEqual');
    wire(musicalTime, 'Output', beforeReleaseEnd, 'InputA');
    wire(releaseEnd, 'Output', beforeReleaseEnd, 'InputB');
    const insideWindow = binary('Expr_LogicalAND', begin, 'bOutput', beforeReleaseEnd, 'bOutput');
    const readyWindow = binary('Expr_LogicalAND', insideWindow, 'bOutput', canPlay, 'bOutput');
    // At note-on, wait for the exec chain to latch pitch/velocity/start and set
    // active before enabling audio.  At key-off, the end comparison keeps the
    // oscillator enabled while Dampen releases, until releaseEnd closes it.
    const activeOrReleased = binary('Expr_LogicalOR', active, 'Value', end, 'bOutput');
    const enabledWindow = binary('Expr_LogicalAND', readyWindow, 'bOutput', activeOrReleased, 'bOutput');
    const releaseDue = node('Expr_CompareGreaterOrEqual');
    wire(musicalTime, 'Output', releaseDue, 'InputA');
    wire(releaseEnd, 'Output', releaseDue, 'InputB');
    const releaseRunning = binary('Expr_LogicalAND', releaseDue, 'bOutput', canPlay, 'bOutput');
    const advanceSignal = binary('Expr_LogicalAND', releaseRunning, 'bOutput', inactive, 'bOutput');
    const advanceEdge = unary('Expr_EdgeDetectorExec', advanceSignal, 'bOutput', 'Input');
    const invalidate = setter(loaded, B(false));
    wire(advanceEdge, 'OnRisingEdge', invalidate, 'Exec');
    const deferred = node('BufferTicks', {TicksToWait: 1, ZeroTicksToWait: 0});
    wire(invalidate, 'ExecOut', deferred, 'Input');
    const hasNext = node('Expr_CompareLess', {InputB: N(voice.offset + voice.count - 1)});
    wire(index, 'Value', hasNext, 'InputA');
    const branch = node('Exec_Branch');
    wire(deferred, 'Output', branch, 'Exec');
    wire(hasNext, 'bOutput', branch, 'bCond');
    wire(branch, 'ExecOutA', advance, 'Exec');

    const rawAge = node('Expr_MathSubtract');
    wire(musicalTime, 'Output', rawAge, 'InputA');
    wire(startHold, 'Value', rawAge, 'InputB');
    const age = node('Expr_MathMax', {InputB: N(0)});
    wire(rawAge, 'Output', age, 'InputA');

    const bodyExponent = node('Expr_MathMultiply', {InputB: N(-2.5)});
    wire(age, 'Output', bodyExponent, 'InputA');
    const bodyDecay = node('Expr_MathExp');
    wire(bodyExponent, 'Output', bodyDecay, 'Input');
    const bodyScale = node('Expr_MathMultiply', {InputB: N(0.82)});
    wire(bodyDecay, 'Output', bodyScale, 'InputA');
    const bodyFloor = node('Expr_MathAdd', {InputB: N(0.18)});
    wire(bodyScale, 'Output', bodyFloor, 'InputA');
    const pianoBody = node('Expr_MathMultiply');
    wire(bodyFloor, 'Output', pianoBody, 'InputA');
    wire(velocityHold, 'Value', pianoBody, 'InputB');

    const activeBody = node('Expr_Select', {InputA: N(0)});
    wire(active, 'Value', activeBody, 'bSelectB');
    const isPiano = voice.instrumentCode < 128 && (voice.instrumentCode & 127) === 0;
    const bodySource = isPiano ? pianoBody : velocityHold;
    wire(bodySource, isPiano ? 'Output' : 'Value', activeBody, 'InputB');
    const bodyMaster = node('Expr_MathMultiply');
    wire(activeBody, 'Output', bodyMaster, 'InputA');
    wire(volume, 'Value', bodyMaster, 'InputB');
    const smoothTime = node('Expr_Select', {InputA: N(0.06), InputB: N(0.015)});
    wire(active, 'Value', smoothTime, 'bSelectB');
    const bodyDampen = node('Dampen');
    wire(bodyMaster, 'Output', bodyDampen, 'Target');
    wire(smoothTime, 'Output', bodyDampen, 'SmoothTime');

    const harmonicExponent = node('Expr_MathMultiply', {InputB: N(-7)});
    wire(age, 'Output', harmonicExponent, 'InputA');
    const harmonicDecay = node('Expr_MathExp');
    wire(harmonicExponent, 'Output', harmonicDecay, 'Input');
    const harmonicVelocity = node('Expr_MathMultiply', {InputB: N(0.15)});
    wire(harmonicDecay, 'Output', harmonicVelocity, 'InputA');
    const harmonicAmp = node('Expr_MathMultiply');
    wire(harmonicVelocity, 'Output', harmonicAmp, 'InputA');
    wire(velocityHold, 'Value', harmonicAmp, 'InputB');
    const activeHarmonic = node('Expr_Select', {InputA: N(0)});
    wire(active, 'Value', activeHarmonic, 'bSelectB');
    wire(harmonicAmp, 'Output', activeHarmonic, 'InputB');
    const harmonicMaster = node('Expr_MathMultiply');
    wire(activeHarmonic, 'Output', harmonicMaster, 'InputA');
    wire(volume, 'Value', harmonicMaster, 'InputB');
    const harmonicDampen = node('Dampen');
    wire(harmonicMaster, 'Output', harmonicDampen, 'Target');
    wire(smoothTime, 'Output', harmonicDampen, 'SmoothTime');

    const masterPitch = node('Expr_MathMultiply');
    wire(pitchHold, 'Value', masterPitch, 'InputA');
    wire(tune, 'Value', masterPitch, 'InputB');
    const emitters = [];
    for (const layer of layers) {
      const emitter = node('AudioEmitter', {
        bEnabled: false,
        AudioDescriptor: assetIndex.get(layer.wave),
        VolumeMultiplier: 0,
        PitchMultiplier: voice.notes[0].pitch * layer.pitchScale,
        InnerRadius: 400,
        MaxDistance: 4000,
        bSpatialization: false,
        FocusAzimuth: 360,
        NonFocusAzimuth: 360,
        NonFocusVolumeAttenuation: 1,
      }, true);
      const layerPitch = node('Expr_MathMultiply', {InputB: N(layer.pitchScale)});
      wire(masterPitch, 'Output', layerPitch, 'InputA');
      wire(layerPitch, 'Output', emitter, 'PitchMultiplier');
      wire(enabledWindow, 'bOutput', emitter, 'bEnabled');
      const layerVolume = node('Expr_MathMultiply', {InputB: N(layer.gain)});
      const envelope = layer.envelope === 'harmonic' ? harmonicDampen : bodyDampen;
      wire(envelope, 'Value', layerVolume, 'InputA');
      wire(layerVolume, 'Output', emitter, 'VolumeMultiplier');
      emitters.push(emitter);
    }

    voiceBuilds.push({
      voice, layers, index, active, loaded, get, split, setPitch, setVelocity,
      setStart, ready, beforeEnd, due, fire, canPlay, on, setOn, age, deferred,
      branch, enabledWindow, emitters,
    });
  }

  assert.equal(emitterIndex, emitterTotal, 'Emitter layout count mismatch');
  w.makePrefab({snap: 10});
  const bytes = w.toBrz({
    bundle: {
      name: score.title,
      description: `${score.totalNotes} MIDI notes in one shared quaternion ArrayVar; ${score.activeVoices} independent voices, continuous built-in synth oscillators, velocity curve, piano decay and release smoothing.`,
    },
    externalAssets,
  });

  return {bytes, nodes, links, inputs, sharedArray, voiceBuilds, emitterTotal, externalAssets};
}

function verify(score, built) {
  const reader = WorldReader.from(built.bytes);
  let components = 0;
  let bricks = 0;
  let arrays = 0;
  let emitters = 0;
  let oneShotEmitters = 0;
  let getters = 0;
  let splits = 0;
  let buffers = 0;
  let ageClamps = 0;
  let pitchPowers = 0;
  let velocityPowers = 0;
  let wires = 0;
  let savedEnabledWires = 0;
  let savedSharedArrayWires = 0;
  let decodedArray;
  const decodedInputs = new Set();

  for (const grid of reader.gridIds()) {
    bricks += [...reader.bricks(grid)].length;
    for (const chunk of reader.brickChunkIndex(grid)) {
      if (chunk.numComponents) {
        for (const component of reader.componentChunk(grid, chunk.index).components) {
          components++;
          if (component.typeName === C.ArrayVar.NAME) {
            arrays++;
            decodedArray = component.data.Value;
          }
          if (component.typeName === C.AudioEmitter.NAME) {
            emitters++;
            assert.equal(component.data.bEnabled, false,
              'Continuous emitters must default off until their note-window wire enables them');
            assert.equal(component.data.MaxDistance, 4000,
              'Continuous emitters need an audition-safe maximum distance');
            const descriptor = reader.externalAssets()[component.data.AudioDescriptor];
            assert.deepEqual(descriptor,
              {type: 'BrickAudioDescriptor', name: 'BA_Synth_Basic_Sine'},
              'Every continuous emitter must resolve to BA_Synth_Basic_Sine');
          }
          if (component.typeName === C.OneShotAudioEmitter.NAME) oneShotEmitters++;
          if (component.typeName === C.Exec_ArrayVar_Get.NAME) getters++;
          if (component.typeName === C.Expr_SplitQuaternion.NAME) splits++;
          if (component.typeName === C.BufferTicks.NAME) buffers++;
          if (component.typeName === C.Expr_MathMax.NAME) ageClamps++;
          if (component.typeName === C.Expr_MathPow.NAME) {
            assert(Number.isFinite(component.data.Input), 'MathPow Input must serialize as a finite raw f64');
            assert(Number.isFinite(component.data.Exponent),
              'MathPow Exponent must serialize as a finite raw f64');
            if (component.data.Input === 2) pitchPowers++;
            if (component.data.Exponent === 1.4) velocityPowers++;
          }
        }
      }
      if (chunk.numWires) {
        const wireChunk = reader.wireChunk(grid, chunk.index);
        for (const edge of [...wireChunk.local, ...wireChunk.remote]) {
          const key = JSON.stringify([grid, chunk.index, edge.target]);
          assert(!decodedInputs.has(key), `Duplicate saved input ${key}`);
          decodedInputs.add(key);
          if (edge.target.componentType === C.AudioEmitter.NAME && edge.target.port === 'bEnabled') {
            savedEnabledWires++;
          }
          if (edge.target.componentType === C.Exec_ArrayVar_Get.NAME
              && edge.target.port === 'ArrayVarRef') {
            assert.equal(edge.source.componentType, C.ArrayVar.NAME,
              'A voice getter ArrayVarRef is not driven by the shared ArrayVar');
            savedSharedArrayWires++;
          }
          wires++;
        }
      }
    }
  }

  assert.equal(arrays, 1, 'Prefab must contain exactly one ArrayVar');
  assert(decodedArray, 'Shared ArrayVar was not decoded');
  assert.equal(decodedArray.$elementType, 'Quat', 'Shared ArrayVar must be Quat');
  assert.deepEqual(decodedArray.$array, score.values, 'Saved quaternion score differs from input');
  assert.equal(emitters, built.emitterTotal, 'AudioEmitter count mismatch');
  assert.equal(oneShotEmitters, 0, 'OneShotAudioEmitter is forbidden in the continuous sine player');
  assert.equal(getters, score.activeVoices, 'Each voice needs exactly one ArrayVar Get');
  assert.equal(splits, score.activeVoices, 'Each voice needs exactly one quaternion splitter');
  assert.equal(buffers, score.activeVoices, 'Each voice needs exactly one safe advancement buffer');
  assert.equal(ageClamps, score.activeVoices, 'Each voice needs one nonnegative note-age clamp');
  assert.equal(pitchPowers, score.activeVoices,
    'Each voice needs one correctly serialized base-2 pitch power');
  assert.equal(velocityPowers, score.activeVoices,
    'Each voice needs one correctly serialized velocity-curve power');
  assert.equal(savedEnabledWires, emitters,
    'Every serialized AudioEmitter needs one explicit bEnabled note-window wire');
  assert.equal(savedSharedArrayWires, score.activeVoices,
    'Every serialized voice getter must read the shared ArrayVar');
  assert.equal(wires, built.links.length, 'Saved wire count mismatch');
  assert.equal(decodedInputs.size, wires, 'Saved inputs are not unique');

  const sharedSources = built.links.filter(link => link.source === built.sharedArray.id && link.output === 'ArrayVarRef');
  assert.equal(sharedSources.length, score.activeVoices, 'Every voice must read the shared ArrayVar');
  assert.equal(new Set(sharedSources.map(link => link.target)).size, score.activeVoices,
    'Shared ArrayVar must feed distinct voice getters');
  for (const voiceBuild of built.voiceBuilds) {
    assert(built.links.some(link => link.source === voiceBuild.deferred.id
      && link.target === voiceBuild.branch.id && link.input === 'Exec'), 'Voice advancement is not buffered');
    const execChain = [
      [voiceBuild.get, voiceBuild.setPitch],
      [voiceBuild.setPitch, voiceBuild.setVelocity],
      [voiceBuild.setVelocity, voiceBuild.setStart],
      [voiceBuild.setStart, voiceBuild.ready],
    ];
    for (const [source, target] of execChain) {
      assert(built.links.some(link => link.source === source.id && link.output === 'ExecOut'
        && link.target === target.id && link.input === 'Exec'),
      'Voice data is not fully latched before loaded becomes true');
    }
    assert(built.links.some(link => link.source === voiceBuild.on.id && link.output === 'OnRisingEdge'
      && link.target === voiceBuild.setOn.id && link.input === 'Exec'),
    'Note-on does not arm the already-latched voice');
    assert(built.links.some(link => link.source === voiceBuild.beforeEnd.id && link.output === 'bOutput'
      && link.target === voiceBuild.due.id && link.input === 'bInputB'),
    'Note-on is not bounded by the current record end');
    assert(built.links.some(link => link.source === voiceBuild.due.id && link.output === 'bOutput'
      && link.target === voiceBuild.fire.id && link.input === 'bInputA'),
    'The bounded note window does not drive note-on');
    assert(built.links.some(link => link.source === voiceBuild.canPlay.id && link.output === 'bOutput'
      && link.target === voiceBuild.fire.id && link.input === 'bInputB'),
    'Note-on is not gated by running and loaded');
    for (const emitter of voiceBuild.emitters) {
      assert(built.links.some(link => link.source === voiceBuild.enabledWindow.id
        && link.target === emitter.id && link.input === 'bEnabled'),
      'AudioEmitter is not driven by its release-safe note window');
    }
    for (let noteIndex = 0; noteIndex < voiceBuild.voice.count; noteIndex++) {
      const expected = voiceBuild.voice.notes[noteIndex];
      const actual = score.values[voiceBuild.voice.offset + noteIndex];
      assert.equal(actual.X, expected.start);
      assert.equal(actual.Y, expected.end);
      assert.equal(actual.Z, expected.midiNote);
      assert.equal(actual.W, expected.velocity);
      for (const layer of voiceBuild.layers) {
        const pitch = expected.pitch * layer.pitchScale;
        assert(pitch >= PITCH_MIN && pitch <= PITCH_MAX,
          `Voice ${voiceBuild.voice.voiceIndex} layer pitch ${pitch} is outside ${PITCH_MIN}..${PITCH_MAX}`);
      }
    }
  }

  const enabledDrivers = built.links.filter(link => link.input === 'bEnabled'
    && C[built.nodes[link.target].kind].NAME === C.AudioEmitter.NAME);
  assert.equal(enabledDrivers.length, emitters, 'Every AudioEmitter needs one explicit bEnabled note-window driver');

  assert.deepEqual(reader.externalAssets(), built.externalAssets, 'Synth descriptor assets changed during save');
  const placement = validatePlacement(built.bytes);
  assert(placement.strictOk, `Strict placement validation failed: ${JSON.stringify({
    invalidBricks: placement.invalidBricks,
    confirmedPairs: placement.confirmedPairs,
    uncertainPairs: placement.uncertainPairs,
    warnings: placement.warnings,
  })}`);

  return {components, bricks, arrays, emitters, getters, splits, buffers, wires, placement};
}

function main() {
  const [scoreFile, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node build-single-quat-midi-player.cjs score.json output.brz');
  const score = parseScore(scoreFile);
  const built = build(score);
  const verified = verify(score, built);
  fs.writeFileSync(output, built.bytes);
  console.log(JSON.stringify({
    output,
    schema: score.raw.schema,
    notes: score.totalNotes,
    voices: score.activeVoices,
    maximumVoices: MAXIMUM_VOICES,
    releaseTailSeconds: score.releaseTail,
    durationSeconds: score.duration,
    sharedArrays: verified.arrays,
    arrayElementType: 'Quat',
    emitters: verified.emitters,
    components: verified.components,
    bricks: verified.bricks,
    wires: verified.wires,
    bytes: built.bytes.length,
    synthAssets: built.externalAssets.map(asset => asset.name),
    singleSourceInputs: true,
    strictPlacement: verified.placement.strictOk,
  }, null, 2));
}

module.exports = {parseScore, waveForProgram, layersForVoice, build, verify};
if (require.main === module) main();
