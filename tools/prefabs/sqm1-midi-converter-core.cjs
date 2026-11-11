'use strict';

// Byte-oriented Standard MIDI File -> SQM1 format-1 score converter.  This is
// the browser/CLI-safe counterpart of convert-midi-single-array.py: it has no
// filesystem dependency and accepts Uint8Array input directly.

const MAGIC = 7_701_001;
const FORMAT_VERSION = 1;
const HEADER_VOICE_CAPACITY = 32;
const GLOBAL_HEADER_QUATS = 2;
const HEADER_LENGTH = GLOBAL_HEADER_QUATS + HEADER_VOICE_CAPACITY;
const DEFAULT_MAX_VOICES = 24;
const MIN_PLAYABLE_MIDI = 30;
const MAX_PLAYABLE_MIDI = 108;
const ARRAY_CAPACITY = 65_536;
const DEFAULT_MAX_INPUT_BYTES = 32 * 1024 * 1024;
const EPSILON = 1e-12;

class MidiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MidiError';
  }
}

function bytesOf(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new MidiError('MIDI input must be a Uint8Array or ArrayBuffer');
}

function u16(data, offset) {
  return data[offset] * 0x100 + data[offset + 1];
}

function u32(data, offset) {
  return data[offset] * 0x1000000 + data[offset + 1] * 0x10000
    + data[offset + 2] * 0x100 + data[offset + 3];
}

function readVlq(data, position) {
  let value = 0;
  for (let index = 0; index < 4; index++) {
    if (position >= data.length) throw new MidiError('Truncated variable-length quantity');
    const byte = data[position++];
    value = (value * 128) + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, position];
  }
  throw new MidiError('MIDI variable-length quantity exceeds four bytes');
}

function takeData(data, position, count, context) {
  if (position + count > data.length) throw new MidiError(`Truncated ${context}`);
  const values = data.subarray(position, position + count);
  if ([...values].some(value => value & 0x80)) {
    throw new MidiError(`Unexpected status byte inside ${context}`);
  }
  return [values, position + count];
}

function latin1(data) {
  let value = '';
  for (const byte of data) value += String.fromCharCode(byte);
  return value.replace(/[\x00-\x1f\x7f]+$/g, '');
}

function parseTrack(data, track) {
  let position = 0;
  let tick = 0;
  let order = 0;
  let runningStatus = null;
  const channelEvents = [];
  const tempoEvents = [];
  let systemExclusiveEvents = 0;
  let name = '';

  while (position < data.length) {
    let delta;
    [delta, position] = readVlq(data, position);
    tick += delta;
    if (position >= data.length) throw new MidiError(`Track ${track}: missing event after delta time`);
    const first = data[position];
    let status;
    if (first >= 0x80) status = data[position++];
    else {
      if (runningStatus === null) {
        throw new MidiError(`Track ${track}: data byte without running status at tick ${tick}`);
      }
      status = runningStatus;
    }

    if (status === 0xff) {
      runningStatus = null;
      if (position >= data.length) throw new MidiError(`Track ${track}: truncated meta event`);
      const metaType = data[position++];
      let length;
      [length, position] = readVlq(data, position);
      if (position + length > data.length) throw new MidiError(`Track ${track}: truncated meta payload`);
      const payload = data.subarray(position, position + length);
      position += length;
      if (metaType === 0x03 && !name) name = latin1(payload);
      else if (metaType === 0x51) {
        if (length !== 3) throw new MidiError(`Track ${track}: tempo meta event must contain three bytes`);
        const microsecondsPerQuarter = payload[0] * 0x10000 + payload[1] * 0x100 + payload[2];
        if (microsecondsPerQuarter <= 0) throw new MidiError(`Track ${track}: tempo must be positive`);
        tempoEvents.push({tick, track, order, microsecondsPerQuarter});
      }
      order++;
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      runningStatus = null;
      let length;
      [length, position] = readVlq(data, position);
      if (position + length > data.length) throw new MidiError(`Track ${track}: truncated SysEx payload`);
      position += length;
      systemExclusiveEvents++;
      order++;
      continue;
    }

    if (status >= 0xf0) {
      if (status < 0xf8) runningStatus = null;
      const systemLengths = new Map([
        [0xf1, 1], [0xf2, 2], [0xf3, 1], [0xf6, 0], [0xf8, 0],
        [0xf9, 0], [0xfa, 0], [0xfb, 0], [0xfc, 0], [0xfd, 0], [0xfe, 0],
      ]);
      if (!systemLengths.has(status)) {
        throw new MidiError(`Track ${track}: unsupported system status 0x${status.toString(16).toUpperCase().padStart(2, '0')}`);
      }
      [, position] = takeData(data, position, systemLengths.get(status), `system event 0x${status.toString(16).toUpperCase()}`);
      order++;
      continue;
    }

    runningStatus = status;
    const kind = status >> 4;
    const channel = status & 0x0f;
    const dataLength = kind === 0xc || kind === 0xd ? 1 : 2;
    let values;
    [values, position] = takeData(data, position, dataLength, 'channel event');
    if (kind === 0x8) {
      channelEvents.push({tick, track, order, kind: 'note_off', channel,
        data1: values[0], data2: values[1]});
    } else if (kind === 0x9) {
      channelEvents.push({tick, track, order, kind: values[1] ? 'note_on' : 'note_off', channel,
        data1: values[0], data2: values[1]});
    } else if (kind === 0xb) {
      channelEvents.push({tick, track, order, kind: 'control', channel,
        data1: values[0], data2: values[1]});
    } else if (kind === 0xc) {
      channelEvents.push({tick, track, order, kind: 'program', channel,
        data1: values[0], data2: 0});
    } else if (kind === 0xa) {
      channelEvents.push({tick, track, order, kind: 'poly_aftertouch', channel,
        data1: values[0], data2: values[1]});
    } else if (kind === 0xd) {
      channelEvents.push({tick, track, order, kind: 'channel_aftertouch', channel,
        data1: values[0], data2: 0});
    } else if (kind === 0xe) {
      channelEvents.push({tick, track, order, kind: 'pitch_bend', channel,
        data1: values[0], data2: values[1]});
    }
    order++;
  }
  return {channelEvents, tempoEvents, name, endTick: tick, systemExclusiveEvents};
}

function parseMidi(source, options = {}) {
  const data = bytesOf(source);
  const maximumBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (!Number.isInteger(maximumBytes) || maximumBytes < 14) {
    throw new MidiError('Maximum MIDI input size must be an integer of at least 14 bytes');
  }
  if (data.length > maximumBytes) {
    throw new MidiError(`MIDI input is ${data.length} bytes; limit is ${maximumBytes}`);
  }
  if (data.length < 14 || String.fromCharCode(...data.subarray(0, 4)) !== 'MThd') {
    throw new MidiError('Not a Standard MIDI File');
  }
  const headerLength = u32(data, 4);
  if (headerLength < 6 || 8 + headerLength > data.length) throw new MidiError('Invalid MIDI header length');
  const midiFormat = u16(data, 8);
  const trackCount = u16(data, 10);
  const division = u16(data, 12);
  if (![0, 1].includes(midiFormat)) throw new MidiError(`MIDI format ${midiFormat} is not supported; use format 0 or 1`);
  if (midiFormat === 0 && trackCount !== 1) throw new MidiError('MIDI format 0 must contain exactly one track');
  if (!trackCount) throw new MidiError('MIDI file contains no tracks');
  if (!division) throw new MidiError('MIDI timing division cannot be zero');

  let position = 8 + headerLength;
  const channelEvents = [];
  const tempoEvents = [];
  const trackNames = [];
  const trackEndTicks = [];
  let systemExclusiveEvents = 0;
  for (let track = 0; track < trackCount; track++) {
    if (position + 8 > data.length || String.fromCharCode(...data.subarray(position, position + 4)) !== 'MTrk') {
      throw new MidiError(`Missing MTrk chunk for track ${track}`);
    }
    const length = u32(data, position + 4);
    const start = position + 8;
    const end = start + length;
    if (end > data.length) throw new MidiError(`Track ${track} extends beyond the file`);
    const parsed = parseTrack(data.subarray(start, end), track);
    channelEvents.push(...parsed.channelEvents);
    tempoEvents.push(...parsed.tempoEvents);
    trackNames.push(parsed.name);
    trackEndTicks.push(parsed.endTick);
    systemExclusiveEvents += parsed.systemExclusiveEvents;
    position = end;
  }
  for (; position < data.length; position++) {
    if (data[position] !== 0) {
      throw new MidiError('Unexpected non-zero data after the declared tracks');
    }
  }
  return {midiFormat, trackCount, division, trackNames, trackEndTicks,
    channelEvents, tempoEvents, systemExclusiveEvents};
}

const FLOAT_BITS = new DataView(new ArrayBuffer(8));

function roundSeconds(value) {
  if (!Number.isFinite(value) || value === 0) return Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(value);
  if (magnitude * 1e9 > Number.MAX_SAFE_INTEGER) return value;

  // Round the exact binary64 value to integer nanoseconds, ties to even. Going
  // through value * 1e9 first can erase which side of a decimal half-way point
  // the original binary value occupied and disagrees with Python's round().
  FLOAT_BITS.setFloat64(0, magnitude, false);
  const high = FLOAT_BITS.getUint32(0, false);
  const low = FLOAT_BITS.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0x000fffff) << 32n) | BigInt(low);
  const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  let numerator = significand * 1_000_000_000n;
  let nanoseconds;
  if (exponent >= 0) {
    nanoseconds = numerator << BigInt(exponent);
  } else {
    const denominator = 1n << BigInt(-exponent);
    nanoseconds = numerator / denominator;
    const remainderTwice = 2n * (numerator % denominator);
    if (remainderTwice > denominator
        || (remainderTwice === denominator && nanoseconds % 2n !== 0n)) {
      nanoseconds++;
    }
  }
  if (value < 0) nanoseconds = -nanoseconds;
  const rounded = Number(nanoseconds) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

class TimeMap {
  constructor(division, tempoEvents) {
    this.division = division;
    this.smpte = Boolean(division & 0x8000);
    this.tempoPoints = [];
    this.ticks = [];
    this.secondsAt = [];
    this.rates = [];
    if (this.smpte) {
      let signedFrames = (division >> 8) & 0xff;
      if (signedFrames >= 128) signedFrames -= 256;
      const frameCode = -signedFrames;
      const framesPerSecond = frameCode === 29 ? 30_000 / 1_001 : frameCode;
      const ticksPerFrame = division & 0xff;
      if (![24, 25, 29, 30].includes(frameCode) || !ticksPerFrame) {
        throw new MidiError('Invalid SMPTE timing division');
      }
      this.framesPerSecond = framesPerSecond;
      this.ticksPerFrame = ticksPerFrame;
      this.secondsPerTick = 1 / (framesPerSecond * ticksPerFrame);
      return;
    }
    const ordered = [...tempoEvents].sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
    const byTick = new Map([[0, 500_000]]);
    for (const item of ordered) byTick.set(item.tick, item.microsecondsPerQuarter);
    let cumulative = 0;
    let previousTick = 0;
    let previousRate = byTick.get(0);
    for (const [tick, rate] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
      if (tick) cumulative += (tick - previousTick) * previousRate / 1_000_000 / division;
      this.ticks.push(tick);
      this.secondsAt.push(cumulative);
      this.rates.push(rate);
      this.tempoPoints.push({tick, seconds: roundSeconds(cumulative),
        microsecondsPerQuarter: rate, bpm: 60_000_000 / rate});
      previousTick = tick;
      previousRate = rate;
    }
  }

  seconds(tick) {
    if (tick < 0) throw new MidiError('Negative MIDI tick');
    if (this.smpte) return tick * this.secondsPerTick;
    let index = this.ticks.length - 1;
    while (index > 0 && this.ticks[index] > tick) index--;
    return this.secondsAt[index] + (tick - this.ticks[index]) * this.rates[index]
      / 1_000_000 / this.division;
  }
}

function resolveNotes(parsed, options = {}) {
  const timeMap = new TimeMap(parsed.division, parsed.tempoEvents);
  const events = [...parsed.channelEvents].sort((a, b) =>
    a.tick - b.tick || a.track - b.track || a.order - b.order);
  const active = new Map();
  const held = Array.from({length: 16}, () => []);
  const sustain = Array(16).fill(false);
  const programs = Array(16).fill(0);
  const completed = [];
  const warnings = {unmatchedNoteOffs: 0, danglingNotesClosedAtEnd: 0,
    zeroLengthNotesExtendedOneTick: 0};
  const unsupported = {
    total: parsed.systemExclusiveEvents || 0,
    pitchBend: 0,
    polyAftertouch: 0,
    channelAftertouch: 0,
    systemExclusive: parsed.systemExclusiveEvents || 0,
    bankSelect: 0,
    channelVolume: 0,
    expression: 0,
    sostenuto: 0,
    otherControllers: 0,
    controllers: {},
    samples: [],
  };
  const noteUnsupported = (event, category, detail = {}) => {
    unsupported[category]++;
    unsupported.total++;
    if (unsupported.samples.length < 32) unsupported.samples.push({
      tick: event.tick, track: event.track, channel: event.channel,
      kind: event.kind, ...detail,
    });
  };
  const key = (channel, pitch) => `${channel}:${pitch}`;
  const close = (note, requestedTick) => {
    let tick = requestedTick;
    if (tick <= note.startTick) {
      tick = note.startTick + 1;
      warnings.zeroLengthNotesExtendedOneTick++;
    }
    completed.push([note, tick]);
  };
  const releaseHeld = (channel, tick) => {
    for (const note of held[channel]) close(note, tick);
    held[channel] = [];
  };
  const releaseActive = (channel, tick, obeySustain) => {
    for (const [identity, queue] of active) {
      if (Number(identity.split(':')[0]) !== channel) continue;
      while (queue.length) {
        const note = queue.shift();
        if (obeySustain && sustain[channel]) held[channel].push(note);
        else close(note, tick);
      }
    }
  };
  for (const event of events) {
    if (event.kind === 'program') programs[event.channel] = event.data1;
    else if (event.kind === 'note_on') {
      const identity = key(event.channel, event.data1);
      if (!active.has(identity)) active.set(identity, []);
      active.get(identity).push({startTick: event.tick, pitch: event.data1,
        velocity: event.data2, channel: event.channel, track: event.track,
        program: programs[event.channel]});
    } else if (event.kind === 'note_off') {
      const queue = active.get(key(event.channel, event.data1)) || [];
      if (!queue.length) warnings.unmatchedNoteOffs++;
      else {
        const note = queue.shift();
        if (sustain[event.channel]) held[event.channel].push(note);
        else close(note, event.tick);
      }
    } else if (event.kind === 'control') {
      const controller = event.data1;
      if (controller === 64) {
        const enabled = event.data2 >= 64;
        if (sustain[event.channel] && !enabled) releaseHeld(event.channel, event.tick);
        sustain[event.channel] = enabled;
      } else if (controller === 120) {
        releaseActive(event.channel, event.tick, false);
        releaseHeld(event.channel, event.tick);
      } else if (controller === 121) {
        sustain[event.channel] = false;
        releaseHeld(event.channel, event.tick);
      } else if (controller === 123 || (controller >= 124 && controller <= 127)) {
        releaseActive(event.channel, event.tick, true);
      } else {
        const category = controller === 0 || controller === 32 ? 'bankSelect'
          : controller === 7 ? 'channelVolume'
          : controller === 11 ? 'expression'
          : controller === 66 ? 'sostenuto' : 'otherControllers';
        unsupported.controllers[controller] = (unsupported.controllers[controller] || 0) + 1;
        noteUnsupported(event, category, {controller, value: event.data2});
      }
    } else if (event.kind === 'pitch_bend') {
      noteUnsupported(event, 'pitchBend', {value14: event.data1 + 128 * event.data2});
    } else if (event.kind === 'poly_aftertouch') {
      noteUnsupported(event, 'polyAftertouch', {note: event.data1, pressure: event.data2});
    } else if (event.kind === 'channel_aftertouch') {
      noteUnsupported(event, 'channelAftertouch', {pressure: event.data1});
    }
  }
  const finalTick = Math.max(0, ...parsed.trackEndTicks);
  for (const queue of active.values()) while (queue.length) {
    close(queue.shift(), finalTick);
    warnings.danglingNotesClosedAtEnd++;
  }
  for (const queue of held) while (queue.length) {
    close(queue.shift(), finalTick);
    warnings.danglingNotesClosedAtEnd++;
  }
  const notes = completed.map(([note, endTick]) => ({
    ...note, endTick,
    startSeconds: roundSeconds(timeMap.seconds(note.startTick)),
    endSeconds: roundSeconds(timeMap.seconds(endTick)),
  })).sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick
    || a.track - b.track || a.channel - b.channel || a.pitch - b.pitch
    || a.velocity - b.velocity);
  const timing = {mode: timeMap.smpte ? 'smpte' : 'ticksPerQuarter',
    division: parsed.division, tempoMap: timeMap.tempoPoints};
  if (timeMap.smpte) Object.assign(timing, {framesPerSecond: timeMap.framesPerSecond,
    ticksPerFrame: timeMap.ticksPerFrame, secondsPerTick: timeMap.secondsPerTick});
  if (unsupported.total) {
    if (unsupported.systemExclusive && unsupported.samples.length < 32) {
      unsupported.samples.push({kind: 'system_exclusive', count: unsupported.systemExclusive});
    }
    warnings.unsupportedEvents = unsupported;
    if (options.strictUnsupported) {
      throw new MidiError(`MIDI contains ${unsupported.total} unsupported expressive event(s); disable strict mode to ignore them with diagnostics`);
    }
  }
  return {notes, resolution: {warnings, timing}};
}

const instrumentCode = note => note.program + (note.channel === 9 ? 128 : 0);
const channelTrackCode = (channel, track) => channel + 16 * track;
const quat = (X, Y, Z, W) => ({X, Y, Z, W});

function intervalPolyphony(notes, releaseTailSeconds = 0) {
  const events = [];
  for (const note of notes) {
    events.push([note.startSeconds, 1]);
    events.push([note.endSeconds + releaseTailSeconds, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function partitionVoices(notes, maximum, releaseTailSeconds = 0) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > HEADER_VOICE_CAPACITY) {
    throw new MidiError(`Maximum voice count must be between 1 and ${HEADER_VOICE_CAPACITY}`);
  }
  if (!Number.isFinite(releaseTailSeconds) || releaseTailSeconds < 0) {
    throw new MidiError('Release tail must be a finite non-negative number of seconds');
  }
  const groups = new Map();
  for (const note of notes) {
    const identity = `${instrumentCode(note)}:${note.channel}:${note.track}`;
    if (!groups.has(identity)) groups.set(identity, {instrument: instrumentCode(note),
      channel: note.channel, track: note.track, notes: []});
    groups.get(identity).notes.push(note);
  }
  const orderedGroups = [...groups.values()].sort((a, b) =>
    Math.min(...a.notes.map(note => note.startSeconds))
      - Math.min(...b.notes.map(note => note.startSeconds))
    || a.track - b.track || a.channel - b.channel || a.instrument - b.instrument);
  const voices = [];
  for (const group of orderedGroups) {
    const local = [];
    const availableAt = [];
    for (const note of [...group.notes].sort((a, b) => a.startSeconds - b.startSeconds
      || a.endSeconds - b.endSeconds || a.pitch - b.pitch || a.velocity - b.velocity)) {
      let voiceIndex = -1;
      for (let index = 0; index < local.length; index++) {
        if (availableAt[index] <= note.startSeconds + EPSILON) {
          voiceIndex = index;
          break;
        }
      }
      if (voiceIndex < 0) {
        voiceIndex = local.length;
        local.push([]);
        availableAt.push(-Infinity);
      }
      local[voiceIndex].push(note);
      availableAt[voiceIndex] = note.endSeconds + releaseTailSeconds;
    }
    for (const voiceNotes of local) voices.push({instrumentCode: group.instrument,
      channel: group.channel, track: group.track,
      channelTrackCode: channelTrackCode(group.channel, group.track), notes: voiceNotes});
  }
  if (voices.length > maximum) {
    const reserved = intervalPolyphony(notes, releaseTailSeconds);
    throw new MidiError(`Song requires ${voices.length} stable-instrument voices (${reserved} simultaneously reserved); player limit is ${maximum}. Reduce the release tail or use dense Piano quality.`);
  }
  return voices;
}

function droppedNote(note) {
  return {startSeconds: note.startSeconds, endSeconds: note.endSeconds,
    midiNote: note.pitch, velocity: note.velocity, program: note.program,
    channel: note.channel, track: note.track};
}

function filterPlayableNotes(notes, policy) {
  if (!['error', 'drop'].includes(policy)) throw new MidiError("Out-of-range policy must be 'error' or 'drop'");
  const outside = notes.filter(note => note.pitch < MIN_PLAYABLE_MIDI || note.pitch > MAX_PLAYABLE_MIDI);
  if (outside.length && policy === 'error') {
    const pitches = [...new Set(outside.map(note => note.pitch))].sort((a, b) => a - b);
    const preview = pitches.slice(0, 12).join(', ') + (pitches.length > 12 ? ', ...' : '');
    throw new MidiError(`${outside.length} note(s) use MIDI pitch(es) ${preview}, outside the Brickadia synth range ${MIN_PLAYABLE_MIDI}..${MAX_PLAYABLE_MIDI}`);
  }
  return {notes: notes.filter(note => note.pitch >= MIN_PLAYABLE_MIDI
      && note.pitch <= MAX_PLAYABLE_MIDI),
    dropped: outside.map(droppedNote)};
}

// Small dependency-free SHA-256 so the same core works in Node and file:// pages.
function sha256Hex(source) {
  const data = bytesOf(source);
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const length = data.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[length] = 0x80;
  const bitLength = BigInt(length) * 8n;
  for (let index = 0; index < 8; index++) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) w[index] = u32(padded, offset + index * 4) >>> 0;
    for (let index = 16; index < 64; index++) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let index = 0; index < 64; index++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[index] + w[index]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh=g; g=f; f=e; e=(d+temp1)>>>0; d=c; c=b; b=a; a=(temp1+temp2)>>>0;
    }
    const next = [a,b,c,d,e,f,g,hh];
    for (let index = 0; index < 8; index++) h[index] = (h[index] + next[index]) >>> 0;
  }
  return h.map(value => value.toString(16).padStart(8, '0')).join('');
}

function buildScore(source, filename, parsed, notes, maximumVoices,
  releaseTailSeconds, resolution, dropped = [], options = {}) {
  const voices = partitionVoices(notes, maximumVoices, releaseTailSeconds);
  const duration = roundSeconds(Math.max(...notes.map(note => note.endSeconds)));
  const minimumPitch = Math.min(...notes.map(note => note.pitch));
  const maximumPitch = Math.max(...notes.map(note => note.pitch));
  const noteValues = [];
  const voiceHeaders = [];
  const voiceMetadata = [];
  let cursor = HEADER_LENGTH;
  voices.forEach((voice, voiceIndex) => {
    voiceHeaders.push(quat(cursor, voice.notes.length, voice.instrumentCode,
      voice.channelTrackCode));
    for (const note of voice.notes) {
      noteValues.push(quat(note.startSeconds, note.endSeconds, note.pitch, note.velocity));
    }
    voiceMetadata.push({voice: voiceIndex, offset: cursor, count: voice.notes.length,
      instrumentCode: voice.instrumentCode, program: voice.instrumentCode & 0x7f,
      percussion: voice.instrumentCode >= 128, channel: voice.channel,
      track: voice.track, channelTrackCode: voice.channelTrackCode});
    cursor += voice.notes.length;
  });
  const finalCursor = cursor;
  while (voiceHeaders.length < HEADER_VOICE_CAPACITY) {
    voiceHeaders.push(quat(finalCursor, 0, -1, -1));
  }
  const values = [quat(MAGIC, FORMAT_VERSION, voices.length, duration),
    quat(HEADER_LENGTH, releaseTailSeconds, minimumPitch, maximumPitch),
    ...voiceHeaders, ...noteValues];
  const maximumArrayEntries = options.maxArrayEntries ?? ARRAY_CAPACITY;
  if (!Number.isInteger(maximumArrayEntries) || maximumArrayEntries < HEADER_LENGTH) {
    throw new MidiError(`Maximum array entries must be an integer of at least ${HEADER_LENGTH}`);
  }
  if (values.length > maximumArrayEntries) {
    throw new MidiError(`Score requires ${values.length} array entries; capacity is ${maximumArrayEntries}`);
  }
  const score = {
    schema: 'brickadia-midi-single-quat-array', version: FORMAT_VERSION,
    source: {filename, sha256: sha256Hex(source), midiFormat: parsed.midiFormat,
      trackCount: parsed.trackCount, trackNames: parsed.trackNames},
    maximumVoices: HEADER_VOICE_CAPACITY, voiceLimit: maximumVoices,
    activeVoices: voices.length, releaseTailSeconds,
    playableMidiRange: [MIN_PLAYABLE_MIDI, MAX_PLAYABLE_MIDI],
    flags: {absoluteSeconds: true, sustainResolved: true,
      releaseTailReserved: releaseTailSeconds > 0, trueKeyOffInNoteEnd: true,
      stableInstrumentPerVoice: true},
    header: {length: HEADER_LENGTH, globalIndex: 0,
      globalFields: ['magic','version','activeVoiceCount','durationSeconds'],
      formatIndex: 1,
      formatFields: ['headerLength','releaseTailSeconds','scoreMinMidi','scoreMaxMidi'],
      voiceTableStart: GLOBAL_HEADER_QUATS, voiceTableCount: HEADER_VOICE_CAPACITY,
      voiceTableFields: ['absoluteNoteOffset','noteCount','instrumentCode','channelTrackCode'],
      noteFields: ['startSeconds','endSeconds','midiNote','velocity']},
    timing: resolution.timing, warnings: resolution.warnings, voices: voiceMetadata,
    array: {elementType: 'Quat', values},
    diagnostics: {droppedOutOfRangeNotes: dropped},
    statistics: {notes: notes.length, durationSeconds: duration, arrayEntries: values.length,
      minimumPitch, maximumPitch, allocatedVoices: voices.length,
      maximumKeyDownPolyphony: intervalPolyphony(notes, 0),
      maximumReservedPolyphony: intervalPolyphony(notes, releaseTailSeconds),
      instrumentGroups: new Set(notes.map(note => `${instrumentCode(note)}:${note.channel}:${note.track}`)).size,
      droppedOutOfRangeNotes: dropped.length},
  };
  validateScore(score, notes);
  return score;
}

function validateScore(score, sourceNotes) {
  const values = score?.array?.values;
  if (score?.array?.elementType !== 'Quat' || !Array.isArray(values) || values.length < HEADER_LENGTH) {
    throw new Error('Score is not a complete Quat array');
  }
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value || Object.keys(value).sort().join(',') !== 'W,X,Y,Z'
      || !Object.values(value).every(item => typeof item === 'number' && Number.isFinite(item))) {
      throw new Error(`Array element ${index} is not a finite X/Y/Z/W quaternion`);
    }
  }
  const global = values[0];
  const format = values[1];
  if (JSON.stringify(global) !== JSON.stringify(quat(MAGIC, FORMAT_VERSION,
    score.activeVoices, score.statistics.durationSeconds))) {
    throw new Error('Global quaternion header does not match score metadata');
  }
  if (JSON.stringify(format) !== JSON.stringify(quat(HEADER_LENGTH,
    score.releaseTailSeconds, score.statistics.minimumPitch, score.statistics.maximumPitch))) {
    throw new Error('Format quaternion header does not match score metadata');
  }
  const reconstructed = [];
  let previousEnd = HEADER_LENGTH;
  let activeHeaders = 0;
  for (let voice = 0; voice < HEADER_VOICE_CAPACITY; voice++) {
    const header = values[GLOBAL_HEADER_QUATS + voice];
    const [offset, count, instrument, packed] = [header.X, header.Y, header.Z, header.W];
    if (![offset,count,instrument,packed].every(Number.isInteger)) throw new Error('Voice header fields must be integers');
    if (offset !== previousEnd || count < 0) throw new Error('Voice note records are not contiguous');
    if (!count) {
      if (instrument !== -1 || packed !== -1) throw new Error('Unused voice header must use -1 metadata');
      continue;
    }
    if (activeHeaders++ !== voice) throw new Error('Active voice headers must precede unused headers');
    let priorReservedEnd = -Infinity;
    for (let index = offset; index < offset + count; index++) {
      const note = values[index];
      if (note.X < priorReservedEnd - 1e-9) throw new Error(`Voice ${voice} overlaps its reserved release tail`);
      if (note.Y <= note.X || !Number.isInteger(note.Z)
        || note.Z < MIN_PLAYABLE_MIDI || note.Z > MAX_PLAYABLE_MIDI
        || !Number.isInteger(note.W) || note.W < 1 || note.W > 127) {
        throw new Error(`Invalid note quaternion in voice ${voice}`);
      }
      priorReservedEnd = note.Y + score.releaseTailSeconds;
      reconstructed.push([note.X,note.Y,note.Z,note.W,instrument,packed % 16,Math.floor(packed / 16)]);
    }
    previousEnd = offset + count;
  }
  if (activeHeaders !== score.activeVoices || previousEnd !== values.length) {
    throw new Error('Score voice table does not account for every note');
  }
  const tupleSort = (a, b) => {
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  };
  const expected = sourceNotes.map(note => [note.startSeconds,note.endSeconds,note.pitch,
    note.velocity,instrumentCode(note),note.channel,note.track]).sort(tupleSort);
  reconstructed.sort(tupleSort);
  if (JSON.stringify(reconstructed) !== JSON.stringify(expected)) {
    throw new Error('Quat records do not reconstruct the resolved MIDI notes');
  }
  return true;
}

function convertMidi(source, options = {}) {
  const bytes = bytesOf(source);
  const filename = options.filename || 'song.mid';
  const maximumVoices = options.maximumVoices ?? DEFAULT_MAX_VOICES;
  const releaseTailSeconds = options.releaseTailSeconds ?? 0.2;
  const outOfRange = options.outOfRange ?? 'error';
  const parsed = parseMidi(bytes, {maxInputBytes: options.maxInputBytes});
  const {notes: resolvedNotes, resolution} = resolveNotes(parsed,
    {strictUnsupported: options.strictUnsupported});
  if (!resolvedNotes.length) throw new MidiError('MIDI file contains no notes');
  const filtered = filterPlayableNotes(resolvedNotes, outOfRange);
  if (!filtered.notes.length) throw new MidiError('No playable notes remain after the pitch-range policy');
  const score = buildScore(bytes, filename, parsed, filtered.notes, maximumVoices,
    releaseTailSeconds, resolution, filtered.dropped,
    {maxArrayEntries: options.maxArrayEntries});
  return {score, parsed, resolvedNotes, notes: filtered.notes,
    report: {...score.statistics, activeVoices: score.activeVoices,
      maximumVoices: HEADER_VOICE_CAPACITY, voiceLimit: maximumVoices,
      releaseTailSeconds, timing: resolution.timing, warnings: resolution.warnings,
      validation: 'passed'}};
}

module.exports = {
  MidiError, parseMidi, resolveNotes, partitionVoices, filterPlayableNotes,
  buildScore, validateScore, convertMidi, intervalPolyphony, instrumentCode,
  channelTrackCode, sha256Hex, roundSeconds,
  constants: {MAGIC, FORMAT_VERSION, HEADER_VOICE_CAPACITY, GLOBAL_HEADER_QUATS,
    HEADER_LENGTH, DEFAULT_MAX_VOICES, MIN_PLAYABLE_MIDI, MAX_PLAYABLE_MIDI,
    ARRAY_CAPACITY, DEFAULT_MAX_INPUT_BYTES},
};
