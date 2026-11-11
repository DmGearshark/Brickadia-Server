'use strict';

const assert = require('assert/strict');

const MAGIC = 7_701_001;
const FORMAT_VERSION = 1;
const HEADER_LENGTH = 34;
const VOICE_TABLE_LENGTH = 32;
const PLAYER_VOICE_LIMIT = 24;
const ARRAY_CAPACITY = 65_536;
const MIN_PLAYABLE_MIDI = 30;
const MAX_PLAYABLE_MIDI = 108;
const DEFAULT_RELEASE_TAIL = 0.2;
const EPSILON = 1e-12;
const EXACT_ASSIGNMENT_LIMIT = 12;
const SHORT_TRANSITION_SECONDS = 0.4;

class ArrangementError extends Error {}

const roundSeconds = value => {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clone = value => structuredClone(value);

function field(note, ...names) {
  for (const name of names) if (note[name] !== undefined) return note[name];
  return undefined;
}

function foldPitch(pitch) {
  let folded = pitch;
  while (folded < MIN_PLAYABLE_MIDI) folded += 12;
  while (folded > MAX_PLAYABLE_MIDI) folded -= 12;
  return folded;
}

function normalizeNotes(sourceNotes, options = {}) {
  if (!Array.isArray(sourceNotes) || sourceNotes.length === 0) {
    throw new ArrangementError('MIDI contains no notes');
  }
  const percussionPolicy = options.percussionPolicy ?? 'error';
  if (!['error', 'include'].includes(percussionPolicy)) {
    throw new ArrangementError("Percussion policy must be 'error' or 'include'");
  }
  const foldedRecords = [];
  let percussionNotes = 0;
  const notes = sourceNotes.map((source, index) => {
    const start = field(source, 'start', 'startSeconds', 'start_seconds');
    const end = field(source, 'end', 'endSeconds', 'end_seconds');
    const pitch = field(source, 'pitch', 'midiNote', 'midi_note');
    const velocity = field(source, 'velocity');
    if (![start, end, pitch, velocity].every(Number.isFinite)) {
      throw new ArrangementError(`Note ${index} must contain finite start/end/pitch/velocity`);
    }
    if (start < 0 || end <= start) {
      throw new ArrangementError(`Note ${index} must end after its non-negative start`);
    }
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
      throw new ArrangementError(`Note ${index} MIDI pitch must be an integer from 0 to 127`);
    }
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
      throw new ArrangementError(`Note ${index} velocity must be an integer from 1 to 127`);
    }
    const foldedPitch = foldPitch(pitch);
    const channel = field(source, 'channel') ?? 0;
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
      throw new ArrangementError(`Note ${index} channel must be an integer from 0 to 15`);
    }
    if (channel === 9) percussionNotes++;
    const normalized = {
      start: roundSeconds(start),
      end: roundSeconds(end),
      pitch: foldedPitch,
      velocity,
      sourceVoice: field(source, 'sourceVoice', 'source_voice') ?? 0,
      sourceIndex: field(source, 'sourceIndex', 'source_index') ?? index,
      startTick: field(source, 'startTick', 'start_tick') ?? null,
      endTick: field(source, 'endTick', 'end_tick') ?? null,
      channel,
      track: field(source, 'track') ?? 0,
      program: field(source, 'program') ?? 0,
      originalPitch: pitch,
    };
    if (foldedPitch !== pitch) foldedRecords.push({
      sourceNoteIndex: index,
      startSeconds: normalized.start,
      originalMidiNote: pitch,
      arrangedMidiNote: foldedPitch,
      octavesMoved: (foldedPitch - pitch) / 12,
    });
    return normalized;
  });
  if (percussionNotes && percussionPolicy === 'error') {
    throw new ArrangementError(`${percussionNotes} percussion-channel note(s) cannot be `
      + 'faithfully rendered by the player-selected melodic instrument; choose the explicit '
      + "'include' percussion policy to flatten them anyway");
  }
  notes.sort((a, b) => a.start - b.start || a.end - b.end
    || a.pitch - b.pitch || a.velocity - b.velocity
    || a.sourceVoice - b.sourceVoice || a.sourceIndex - b.sourceIndex);
  return {notes, foldedRecords, percussionNotes, percussionPolicy};
}

function addCost(a, b) {
  return a.map((value, index) => value + b[index]);
}

function compareArray(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (Array.isArray(a[index]) && Array.isArray(b[index])) {
      const nested = compareArray(a[index], b[index]);
      if (nested) return nested;
    } else if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length;
}

function compareCandidate(a, b) {
  return compareArray(a.cost, b.cost) || compareArray(a.assignments, b.assignments);
}

function assignmentCost(laneIndex, noteIndex, lanes, batch, start, cutoff) {
  const previous = lanes[laneIndex].at(-1);
  const cut = Boolean(previous && previous.end + batch.releaseTail > start + EPSILON);
  const removedNs = cut ? Math.round((previous.end - cutoff) * 1e9) : 0;
  const pitchDistance = previous ? Math.abs(previous.pitch - batch.notes[noteIndex].pitch) : 0;
  return {cut, value: [Number(cut), removedNs, pitchDistance]};
}

function exactAssignment(candidates, batchNotes, lanes, start, cutoff, releaseTail) {
  const batch = {notes: batchNotes, releaseTail};
  let state = new Map([[0, {cost: [0, 0, 0], assignments: []}]]);
  for (const laneIndex of [...candidates].sort((a, b) => a - b)) {
    const next = new Map(state);
    for (const [mask, existing] of state) {
      for (let noteIndex = 0; noteIndex < batchNotes.length; noteIndex++) {
        if (mask & (1 << noteIndex)) continue;
        const item = assignmentCost(laneIndex, noteIndex, lanes, batch, start, cutoff);
        const nextMask = mask | (1 << noteIndex);
        const candidate = {
          cost: addCost(existing.cost, item.value),
          assignments: [...existing.assignments, [laneIndex, noteIndex, Number(item.cut)]],
        };
        if (!next.has(nextMask) || compareCandidate(candidate, next.get(nextMask)) < 0) {
          next.set(nextMask, candidate);
        }
      }
    }
    state = next;
  }
  const complete = (1 << batchNotes.length) - 1;
  if (!state.has(complete)) throw new ArrangementError('Unable to assign onset to available lanes');
  return state.get(complete);
}

function compareCost(a, b) {
  if (b === null) return -1;
  return compareArray(a, b);
}

function polynomialAssignment(candidates, batchNotes, lanes, start, cutoff, releaseTail) {
  // Successive shortest augmenting paths over a small bipartite graph. Costs
  // remain tuples, so primary cut count, removed sustain and pitch distance
  // are compared exactly without unsafe scalar weighting.
  const laneCount = candidates.length;
  const noteCount = batchNotes.length;
  const source = 0;
  const laneStart = 1;
  const noteStart = laneStart + laneCount;
  const sink = noteStart + noteCount;
  const graph = Array.from({length: sink + 1}, () => []);
  let order = 0;
  const addEdge = (from, to, capacity, cost, meta = null) => {
    const forward = {to, rev: graph[to].length, capacity, cost, order: order++, meta};
    const reverse = {to: from, rev: graph[from].length, capacity: 0,
      cost: cost.map(value => -value), order: order++, meta: null};
    graph[from].push(forward);
    graph[to].push(reverse);
  };
  candidates.forEach((laneIndex, laneRank) => {
    addEdge(source, laneStart + laneRank, 1, [0, 0, 0, 0]);
    for (let noteIndex = 0; noteIndex < noteCount; noteIndex++) {
      const item = assignmentCost(laneIndex, noteIndex, lanes,
        {notes: batchNotes, releaseTail}, start, cutoff);
      addEdge(laneStart + laneRank, noteStart + noteIndex, 1,
        [...item.value, laneRank * (noteCount + 1) + noteIndex],
        {laneIndex, noteIndex, cut: Number(item.cut)});
    }
  });
  for (let noteIndex = 0; noteIndex < noteCount; noteIndex++) {
    addEdge(noteStart + noteIndex, sink, 1, [0, 0, 0, 0]);
  }

  for (let flow = 0; flow < noteCount; flow++) {
    const distance = Array(graph.length).fill(null);
    const previous = Array(graph.length).fill(null);
    distance[source] = [0, 0, 0, 0];
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false;
      for (let node = 0; node < graph.length; node++) {
        if (distance[node] === null) continue;
        for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex++) {
          const edge = graph[node][edgeIndex];
          if (edge.capacity <= 0) continue;
          const next = addCost(distance[node], edge.cost);
          if (compareCost(next, distance[edge.to]) < 0) {
            distance[edge.to] = next;
            previous[edge.to] = {node, edgeIndex};
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    if (distance[sink] === null) throw new ArrangementError('Unable to assign onset batch');
    for (let node = sink; node !== source;) {
      const step = previous[node];
      if (!step) throw new ArrangementError('Incomplete assignment augmenting path');
      const edge = graph[step.node][step.edgeIndex];
      edge.capacity--;
      graph[node][edge.rev].capacity++;
      node = step.node;
    }
  }

  const assignments = [];
  for (let laneRank = 0; laneRank < laneCount; laneRank++) {
    for (const edge of graph[laneStart + laneRank]) {
      if (edge.meta && edge.capacity === 0) {
        assignments.push([edge.meta.laneIndex, edge.meta.noteIndex, edge.meta.cut]);
      }
    }
  }
  assignments.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cost = assignments.reduce((total, [laneIndex, noteIndex]) => {
    const item = assignmentCost(laneIndex, noteIndex, lanes,
      {notes: batchNotes, releaseTail}, start, cutoff);
    return addCost(total, item.value);
  }, [0, 0, 0]);
  return {cost, assignments};
}

function bestAssignment(candidates, batch, lanes, start, cutoff, releaseTail) {
  return batch.length <= EXACT_ASSIGNMENT_LIMIT
    ? exactAssignment(candidates, batch, lanes, start, cutoff, releaseTail)
    : polynomialAssignment(candidates, batch, lanes, start, cutoff, releaseTail);
}

function maximumPolyphony(notes, releaseTail = 0) {
  const events = [];
  for (const note of notes) {
    events.push([note.start, 1]);
    events.push([roundSeconds(note.end + releaseTail), -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    if (active < 0) throw new ArrangementError('Polyphony sweep closed before opening');
    maximum = Math.max(maximum, active);
  }
  if (active !== 0) throw new ArrangementError('Polyphony sweep did not close');
  return maximum;
}

function transitionMetrics(lanes) {
  const transitions = [];
  for (const lane of lanes) for (let index = 1; index < lane.length; index++) {
    transitions.push({
      gap: lane[index].start - lane[index - 1].end,
      jump: Math.abs(lane[index].pitch - lane[index - 1].pitch),
    });
  }
  const count = predicate => transitions.filter(predicate).length;
  return {
    transitions: transitions.length,
    samePitchTransitions: count(item => item.jump === 0),
    jumpsAtLeast12Semitones: count(item => item.jump >= 12),
    jumpsAtLeast24Semitones: count(item => item.jump >= 24),
    jumpsAtLeast36Semitones: count(item => item.jump >= 36),
    shortGapSeconds: SHORT_TRANSITION_SECONDS,
    shortGapJumpsAtLeast12Semitones: count(item =>
      item.gap <= SHORT_TRANSITION_SECONDS + EPSILON && item.jump >= 12),
    shortGapJumpsAtLeast24Semitones: count(item =>
      item.gap <= SHORT_TRANSITION_SECONDS + EPSILON && item.jump >= 24),
    maximumJumpSemitones: Math.max(0, ...transitions.map(item => item.jump)),
    minimumGapSeconds: roundSeconds(transitions.length
      ? Math.min(...transitions.map(item => item.gap)) : 0),
  };
}

function arrange(sourceNotes, options = {}) {
  const maximumVoices = options.maxVoices ?? PLAYER_VOICE_LIMIT;
  const releaseTail = options.releaseTailSeconds ?? DEFAULT_RELEASE_TAIL;
  if (!Number.isInteger(maximumVoices) || maximumVoices < 1
    || maximumVoices > PLAYER_VOICE_LIMIT) {
    throw new ArrangementError(`Voice limit must be an integer from 1 to ${PLAYER_VOICE_LIMIT}`);
  }
  if (!Number.isFinite(releaseTail) || releaseTail < 0 || releaseTail > 5) {
    throw new ArrangementError('Release tail must be a finite number from 0 to 5 seconds');
  }
  if (sourceNotes.length + HEADER_LENGTH > ARRAY_CAPACITY) {
    throw new ArrangementError(`Score would use ${sourceNotes.length + HEADER_LENGTH} array `
      + `entries; production limit is ${ARRAY_CAPACITY}`);
  }
  const normalized = normalizeNotes(sourceNotes, {
    percussionPolicy: options.percussionPolicy ?? 'error',
  });
  const byStart = new Map();
  for (const note of normalized.notes) {
    if (!byStart.has(note.start)) byStart.set(note.start, []);
    byStart.get(note.start).push(note);
  }

  const lanes = [];
  const shortenedRecords = [];
  let largestSimultaneousOnset = 0;
  for (const [start, unsorted] of [...byStart].sort((a, b) => a[0] - b[0])) {
    const batch = [...unsorted].sort((a, b) => a.pitch - b.pitch
      || a.velocity - b.velocity || a.end - b.end
      || a.sourceVoice - b.sourceVoice || a.sourceIndex - b.sourceIndex);
    largestSimultaneousOnset = Math.max(largestSimultaneousOnset, batch.length);
    if (batch.length > maximumVoices) {
      throw new ArrangementError(`One onset contains ${batch.length} notes; limit is ${maximumVoices}`);
    }
    const free = [];
    for (let lane = 0; lane < lanes.length; lane++) {
      if (lanes[lane].at(-1).end + releaseTail <= start + EPSILON) free.push(lane);
    }
    const newLaneCount = Math.min(batch.length - free.length, maximumVoices - lanes.length);
    for (let count = 0; count < Math.max(0, newLaneCount); count++) {
      lanes.push([]);
      free.push(lanes.length - 1);
    }
    const cutoff = roundSeconds(start - releaseTail);
    const eligible = [];
    for (let lane = 0; lane < lanes.length; lane++) {
      if (!free.includes(lane) && cutoff > lanes[lane].at(-1).start) eligible.push(lane);
    }
    const candidates = [...free, ...eligible];
    if (candidates.length < batch.length) {
      throw new ArrangementError(`Release reservation leaves too few lanes at ${start}`);
    }
    const result = bestAssignment(candidates, batch, lanes, start, cutoff, releaseTail);
    const requiredCuts = Math.max(0, batch.length - free.length);
    if (result.cost[0] !== requiredCuts) {
      throw new ArrangementError(`Pitch assignment added an avoidable cut at ${start}`);
    }
    for (const [laneIndex, noteIndex, cut] of result.assignments) {
      if (cut) {
        const previous = lanes[laneIndex].at(-1);
        const originalEnd = previous.end;
        previous.end = cutoff;
        shortenedRecords.push({
          startSeconds: previous.start,
          originalEndSeconds: originalEnd,
          arrangedEndSeconds: cutoff,
          midiNote: previous.pitch,
          velocity: previous.velocity,
          secondsRemoved: roundSeconds(originalEnd - cutoff),
        });
      }
      lanes[laneIndex].push(clone(batch[noteIndex]));
    }
  }
  if (lanes.length > maximumVoices) throw new ArrangementError('Allocator exceeded voice limit');
  const arrangedNotes = lanes.flat();
  return {
    lanes,
    notes: arrangedNotes,
    foldedRecords: normalized.foldedRecords,
    percussionNotes: normalized.percussionNotes,
    percussionPolicy: normalized.percussionPolicy,
    shortenedRecords,
    largestSimultaneousOnset,
    originalMaximumKeyDownPolyphony: maximumPolyphony(normalized.notes),
    arrangedMaximumKeyDownPolyphony: maximumPolyphony(arrangedNotes),
    arrangedMaximumReservedPolyphony: maximumPolyphony(arrangedNotes, releaseTail),
    transitionMetrics: transitionMetrics(lanes),
    releaseTailSeconds: releaseTail,
    maxVoices: maximumVoices,
  };
}

function quat(X, Y, Z, W) { return {X, Y, Z, W}; }

function validateDocument(document, options = {}) {
  const maxVoices = options.maxVoices ?? PLAYER_VOICE_LIMIT;
  const values = document?.array?.values;
  assert.equal(document.schema, 'brickadia-midi-single-quat-array');
  assert.equal(document.version, FORMAT_VERSION);
  assert(Array.isArray(values) && values.length >= HEADER_LENGTH
    && values.length <= ARRAY_CAPACITY, 'valid SQM1 array size');
  assert.equal(values[0].X, MAGIC);
  assert.equal(values[0].Y, FORMAT_VERSION);
  assert(Number.isInteger(values[0].Z) && values[0].Z >= 1 && values[0].Z <= maxVoices);
  assert.equal(values[1].X, HEADER_LENGTH);
  let cursor = HEADER_LENGTH;
  for (let lane = 0; lane < VOICE_TABLE_LENGTH; lane++) {
    const header = values[2 + lane];
    assert.equal(header.X, cursor, `lane ${lane} contiguous offset`);
    if (lane < values[0].Z) {
      assert(header.Y > 0, `lane ${lane} nonempty`);
      let priorEnd = -Infinity;
      for (const note of values.slice(cursor, cursor + header.Y)) {
        assert(note.X + EPSILON >= priorEnd + values[1].Y, `lane ${lane} release reservation`);
        assert(note.Y > note.X && Number.isInteger(note.Z)
          && Number.isInteger(note.W), `lane ${lane} note record`);
        priorEnd = note.Y;
      }
      cursor += header.Y;
    } else assert.deepEqual(header, quat(cursor, 0, -1, -1));
  }
  assert.equal(cursor, values.length);
  return document;
}

function buildScore(sourceNotes, source = {}, options = {}) {
  const arrangement = arrange(sourceNotes, options);
  const instrumentCode = options.instrumentCode ?? 0;
  const channel = options.channel ?? 0;
  const track = options.track ?? 0;
  const channelTrackCode = channel + 16 * track;
  if (!Number.isInteger(instrumentCode) || instrumentCode < 0 || instrumentCode > 255) {
    throw new ArrangementError('Instrument code must be an integer from 0 to 255');
  }
  const duration = roundSeconds(Math.max(...arrangement.notes.map(note => note.end)));
  const minimumPitch = Math.min(...arrangement.notes.map(note => note.pitch));
  const maximumPitch = Math.max(...arrangement.notes.map(note => note.pitch));
  const voiceHeaders = [];
  const noteValues = [];
  const voiceMetadata = [];
  let cursor = HEADER_LENGTH;
  arrangement.lanes.forEach((lane, voice) => {
    voiceHeaders.push(quat(cursor, lane.length, instrumentCode, channelTrackCode));
    voiceMetadata.push({voice, offset: cursor, count: lane.length, instrumentCode,
      program: instrumentCode & 0x7f, percussion: instrumentCode >= 128,
      channel, track, channelTrackCode});
    noteValues.push(...lane.map(note => quat(note.start, note.end, note.pitch, note.velocity)));
    cursor += lane.length;
  });
  while (voiceHeaders.length < VOICE_TABLE_LENGTH) {
    voiceHeaders.push(quat(cursor, 0, -1, -1));
  }
  const values = [
    quat(MAGIC, FORMAT_VERSION, arrangement.lanes.length, duration),
    quat(HEADER_LENGTH, arrangement.releaseTailSeconds, minimumPitch, maximumPitch),
    ...voiceHeaders,
    ...noteValues,
  ];
  if (values.length > ARRAY_CAPACITY) {
    throw new ArrangementError(`Score uses ${values.length} array entries; limit is ${ARRAY_CAPACITY}`);
  }
  const sourceInstrumentGroups = new Set(sourceNotes.map(note => JSON.stringify([
    field(note, 'program') ?? 0,
    field(note, 'channel') ?? 0,
    field(note, 'track') ?? 0,
  ]))).size;
  const qualityFlags = [];
  if (arrangement.shortenedRecords.length) qualityFlags.push('sustain-trimmed');
  if (arrangement.foldedRecords.length) qualityFlags.push('octave-folded');
  if (arrangement.percussionNotes) qualityFlags.push('percussion-flattened');
  const qualityLabel = qualityFlags.length ? qualityFlags.join('+') : 'lossless';
  const base = options.sourceDocument ? clone(options.sourceDocument) : {};
  const document = Object.assign(base, {
    schema: 'brickadia-midi-single-quat-array',
    version: FORMAT_VERSION,
    source: clone(source),
    maximumVoices: VOICE_TABLE_LENGTH,
    voiceLimit: arrangement.maxVoices,
    activeVoices: arrangement.lanes.length,
    releaseTailSeconds: arrangement.releaseTailSeconds,
    playableMidiRange: [MIN_PLAYABLE_MIDI, MAX_PLAYABLE_MIDI],
    flags: {
      absoluteSeconds: true,
      sustainResolved: true,
      releaseTailReserved: arrangement.releaseTailSeconds > 0,
      trueKeyOffInNoteEnd: true,
      stableInstrumentPerVoice: true,
    },
    header: {
      length: HEADER_LENGTH,
      globalIndex: 0,
      globalFields: ['magic', 'version', 'activeVoiceCount', 'durationSeconds'],
      formatIndex: 1,
      formatFields: ['headerLength', 'releaseTailSeconds', 'scoreMinMidi', 'scoreMaxMidi'],
      voiceTableStart: 2,
      voiceTableCount: VOICE_TABLE_LENGTH,
      voiceTableFields: ['absoluteNoteOffset', 'noteCount', 'instrumentCode', 'channelTrackCode'],
      noteFields: ['startSeconds', 'endSeconds', 'midiNote', 'velocity'],
    },
    timing: clone(options.timing ?? base.timing ?? {}),
    warnings: clone(options.warnings ?? base.warnings ?? {}),
    voices: voiceMetadata,
    array: {elementType: 'Quat', values},
    diagnostics: {droppedOutOfRangeNotes: []},
    statistics: {
      notes: arrangement.notes.length,
      durationSeconds: duration,
      arrayEntries: values.length,
      minimumPitch,
      maximumPitch,
      allocatedVoices: arrangement.lanes.length,
      maximumKeyDownPolyphony: arrangement.arrangedMaximumKeyDownPolyphony,
      maximumReservedPolyphony: arrangement.arrangedMaximumReservedPolyphony,
      instrumentGroups: 1,
      droppedOutOfRangeNotes: 0,
    },
    arrangement: {
      mode: 'pitch-continuity-dense-piano',
      qualityLabel,
      qualityFlags,
      playerSelectedInstrument: true,
      allocationObjectives: [
        'minimum-shortened-note-count',
        'minimum-removed-sustain',
        'minimum-lane-pitch-distance',
      ],
      originalNotes: sourceNotes.length,
      preservedNoteOnsets: arrangement.notes.length,
      originalTrackCount: source.trackCount ?? null,
      mergedTrack: track,
      sourceInstrumentGroups,
      percussionNotes: arrangement.percussionNotes,
      percussionPolicy: arrangement.percussionPolicy,
      octaveFoldedNotes: arrangement.foldedRecords.length,
      shortenedHeldNotes: arrangement.shortenedRecords.length,
      totalHeldSecondsRemoved: roundSeconds(arrangement.shortenedRecords.reduce(
        (sum, record) => sum + record.secondsRemoved, 0)),
      largestSimultaneousOnset: arrangement.largestSimultaneousOnset,
      originalMaximumKeyDownPolyphony: arrangement.originalMaximumKeyDownPolyphony,
      arrangedMaximumKeyDownPolyphony: arrangement.arrangedMaximumKeyDownPolyphony,
      arrangedMaximumReservedPolyphony: arrangement.arrangedMaximumReservedPolyphony,
      transitionMetrics: arrangement.transitionMetrics,
      foldedPitchRecords: arrangement.foldedRecords,
      shortenedNoteRecords: arrangement.shortenedRecords,
    },
  });
  validateDocument(document, {maxVoices: arrangement.maxVoices});
  return {
    document,
    lanes: arrangement.lanes,
    report: {
      ...document.statistics,
      activeVoices: arrangement.lanes.length,
      releaseTailSeconds: arrangement.releaseTailSeconds,
      preservedNoteOnsets: arrangement.notes.length,
      shortenedHeldNotes: arrangement.shortenedRecords.length,
      totalHeldSecondsRemoved: document.arrangement.totalHeldSecondsRemoved,
      octaveFoldedNotes: arrangement.foldedRecords.length,
      transitionMetrics: arrangement.transitionMetrics,
      qualityLabel,
      qualityFlags,
      playerSelectedInstrument: true,
      sourceInstrumentGroups,
      percussionNotes: arrangement.percussionNotes,
      percussionPolicy: arrangement.percussionPolicy,
      validation: 'passed',
    },
    arrangement,
  };
}

module.exports = {
  ArrangementError,
  arrange,
  bestAssignment,
  buildScore,
  foldPitch,
  maximumPolyphony,
  normalizeNotes,
  roundSeconds,
  transitionMetrics,
  validateDocument,
  constants: {
    MAGIC, FORMAT_VERSION, HEADER_LENGTH, VOICE_TABLE_LENGTH, PLAYER_VOICE_LIMIT,
    ARRAY_CAPACITY, MIN_PLAYABLE_MIDI, MAX_PLAYABLE_MIDI, DEFAULT_RELEASE_TAIL,
    EXACT_ASSIGNMENT_LIMIT, SHORT_TRANSITION_SECONDS,
  },
};
