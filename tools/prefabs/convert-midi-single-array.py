#!/usr/bin/env python3
"""Convert a Standard MIDI File into one Brickadia quaternion song array.

The score is grouped into non-overlapping monophonic voice segments so every
voice can read the same ArrayVar independently. Tempo changes and sustain are
resolved offline; the runtime only schedules absolute seconds, pitch and
velocity. One quaternion stores every header or note record, matching
Brickadia's native ``Quat`` ArrayVar element and ``SplitQuaternion`` gate.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import heapq
import json
import math
import struct
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MAGIC = 7_701_001
FORMAT_VERSION = 1
HEADER_VOICE_CAPACITY = 32
GLOBAL_HEADER_QUATS = 2
HEADER_LENGTH = GLOBAL_HEADER_QUATS + HEADER_VOICE_CAPACITY
DEFAULT_MAX_VOICES = HEADER_VOICE_CAPACITY
MIN_PLAYABLE_MIDI = 30
MAX_PLAYABLE_MIDI = 108


class MidiError(ValueError):
    """Raised when a MIDI file or requested score cannot be represented."""


@dataclass(frozen=True)
class ChannelEvent:
    tick: int
    track: int
    order: int
    kind: str
    channel: int
    data1: int
    data2: int = 0


@dataclass(frozen=True)
class TempoEvent:
    tick: int
    track: int
    order: int
    microseconds_per_quarter: int


@dataclass(frozen=True)
class ActiveNote:
    start_tick: int
    pitch: int
    velocity: int
    channel: int
    track: int
    program: int


@dataclass(frozen=True)
class Note:
    start_tick: int
    end_tick: int
    start_seconds: float
    end_seconds: float
    pitch: int
    velocity: int
    channel: int
    track: int
    program: int


@dataclass
class ParsedMidi:
    midi_format: int
    track_count: int
    division: int
    track_names: list[str]
    track_end_ticks: list[int]
    channel_events: list[ChannelEvent]
    tempo_events: list[TempoEvent]


def read_vlq(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if position >= len(data):
            raise MidiError("Truncated variable-length quantity")
        byte = data[position]
        position += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, position
    raise MidiError("MIDI variable-length quantity exceeds four bytes")


def _take_data(data: bytes, position: int, count: int, context: str) -> tuple[bytes, int]:
    end = position + count
    if end > len(data):
        raise MidiError(f"Truncated {context}")
    value = data[position:end]
    if any(byte & 0x80 for byte in value):
        raise MidiError(f"Unexpected status byte inside {context}")
    return value, end


def parse_track(data: bytes, track: int) -> tuple[list[ChannelEvent], list[TempoEvent], str, int]:
    position = 0
    tick = 0
    order = 0
    running_status: int | None = None
    channel_events: list[ChannelEvent] = []
    tempo_events: list[TempoEvent] = []
    name = ""

    while position < len(data):
        delta, position = read_vlq(data, position)
        tick += delta
        if position >= len(data):
            raise MidiError(f"Track {track}: missing event after delta time")

        first = data[position]
        explicit_status = first >= 0x80
        if explicit_status:
            status = first
            position += 1
        else:
            if running_status is None:
                raise MidiError(f"Track {track}: data byte without running status at tick {tick}")
            status = running_status

        if status == 0xFF:
            running_status = None
            if position >= len(data):
                raise MidiError(f"Track {track}: truncated meta event")
            meta_type = data[position]
            position += 1
            length, position = read_vlq(data, position)
            end = position + length
            if end > len(data):
                raise MidiError(f"Track {track}: truncated meta payload")
            payload = data[position:end]
            position = end
            if meta_type == 0x03 and not name:
                decoded = payload.decode("latin-1", errors="replace")
                trailing_controls = "".join(chr(value) for value in range(32)) + "\x7f"
                name = decoded.rstrip(trailing_controls)
            elif meta_type == 0x51:
                if length != 3:
                    raise MidiError(f"Track {track}: tempo meta event must contain three bytes")
                tempo = int.from_bytes(payload, "big")
                if tempo <= 0:
                    raise MidiError(f"Track {track}: tempo must be positive")
                tempo_events.append(TempoEvent(tick, track, order, tempo))
            order += 1
            continue

        if status in (0xF0, 0xF7):
            running_status = None
            length, position = read_vlq(data, position)
            if position + length > len(data):
                raise MidiError(f"Track {track}: truncated SysEx payload")
            position += length
            order += 1
            continue

        if status >= 0xF0:
            # Real-time statuses do not cancel a channel running status.
            if status < 0xF8:
                running_status = None
            system_lengths = {0xF1: 1, 0xF2: 2, 0xF3: 1, 0xF6: 0, 0xF8: 0,
                              0xF9: 0, 0xFA: 0, 0xFB: 0, 0xFC: 0, 0xFD: 0,
                              0xFE: 0}
            if status not in system_lengths:
                raise MidiError(f"Track {track}: unsupported system status 0x{status:02X}")
            _, position = _take_data(
                data, position, system_lengths[status], f"system event 0x{status:02X}"
            )
            order += 1
            continue

        running_status = status
        kind = status >> 4
        channel = status & 0x0F
        data_length = 1 if kind in (0xC, 0xD) else 2
        values, position = _take_data(data, position, data_length, "channel event")
        if kind == 0x8:
            channel_events.append(ChannelEvent(tick, track, order, "note_off", channel, values[0], values[1]))
        elif kind == 0x9:
            event_kind = "note_on" if values[1] else "note_off"
            channel_events.append(ChannelEvent(tick, track, order, event_kind, channel, values[0], values[1]))
        elif kind == 0xB:
            channel_events.append(ChannelEvent(tick, track, order, "control", channel, values[0], values[1]))
        elif kind == 0xC:
            channel_events.append(ChannelEvent(tick, track, order, "program", channel, values[0]))
        order += 1

    return channel_events, tempo_events, name, tick


def parse_midi(path: Path) -> ParsedMidi:
    data = path.read_bytes()
    if len(data) < 14 or data[:4] != b"MThd":
        raise MidiError("Not a Standard MIDI File")
    header_length = int.from_bytes(data[4:8], "big")
    if header_length < 6 or 8 + header_length > len(data):
        raise MidiError("Invalid MIDI header length")
    midi_format, track_count, division = struct.unpack_from(">HHH", data, 8)
    if midi_format not in (0, 1):
        raise MidiError(f"MIDI format {midi_format} is not supported; use format 0 or 1")
    if midi_format == 0 and track_count != 1:
        raise MidiError("MIDI format 0 must contain exactly one track")
    if track_count == 0:
        raise MidiError("MIDI file contains no tracks")
    if division == 0:
        raise MidiError("MIDI timing division cannot be zero")

    position = 8 + header_length
    channel_events: list[ChannelEvent] = []
    tempo_events: list[TempoEvent] = []
    track_names: list[str] = []
    track_end_ticks: list[int] = []
    for track in range(track_count):
        if position + 8 > len(data) or data[position:position + 4] != b"MTrk":
            raise MidiError(f"Missing MTrk chunk for track {track}")
        length = int.from_bytes(data[position + 4:position + 8], "big")
        start = position + 8
        end = start + length
        if end > len(data):
            raise MidiError(f"Track {track} extends beyond the file")
        events, tempos, name, end_tick = parse_track(data[start:end], track)
        channel_events.extend(events)
        tempo_events.extend(tempos)
        track_names.append(name)
        track_end_ticks.append(end_tick)
        position = end

    if any(data[position:]):
        raise MidiError("Unexpected non-zero data after the declared tracks")
    return ParsedMidi(
        midi_format, track_count, division, track_names, track_end_ticks,
        channel_events, tempo_events,
    )


class TimeMap:
    def __init__(self, division: int, tempo_events: Iterable[TempoEvent]):
        self.division = division
        self.smpte = bool(division & 0x8000)
        self.tempo_points: list[dict] = []
        self._ticks: list[int] = []
        self._seconds: list[float] = []
        self._rates: list[int] = []
        self.frames_per_second: float | None = None
        self.ticks_per_frame: int | None = None
        self.seconds_per_tick: float | None = None

        if self.smpte:
            signed_frames = (division >> 8) & 0xFF
            signed_frames = signed_frames - 256 if signed_frames >= 128 else signed_frames
            frame_code = -signed_frames
            frames_per_second = 30_000 / 1_001 if frame_code == 29 else float(frame_code)
            ticks_per_frame = division & 0xFF
            if frame_code not in (24, 25, 29, 30) or ticks_per_frame == 0:
                raise MidiError("Invalid SMPTE timing division")
            self.frames_per_second = frames_per_second
            self.ticks_per_frame = ticks_per_frame
            self.seconds_per_tick = 1.0 / (frames_per_second * ticks_per_frame)
            return

        ticks_per_quarter = division
        ordered = sorted(tempo_events, key=lambda item: (item.tick, item.track, item.order))
        by_tick: dict[int, int] = {0: 500_000}
        for item in ordered:
            by_tick[item.tick] = item.microseconds_per_quarter
        cumulative = 0.0
        previous_tick = 0
        previous_rate = by_tick[0]
        for tick, rate in sorted(by_tick.items()):
            if tick:
                cumulative += (tick - previous_tick) * previous_rate / 1_000_000 / ticks_per_quarter
            self._ticks.append(tick)
            self._seconds.append(cumulative)
            self._rates.append(rate)
            self.tempo_points.append({
                "tick": tick,
                "seconds": round(cumulative, 9),
                "microsecondsPerQuarter": rate,
                "bpm": 60_000_000 / rate,
            })
            previous_tick = tick
            previous_rate = rate

    def seconds(self, tick: int) -> float:
        if tick < 0:
            raise MidiError("Negative MIDI tick")
        if self.smpte:
            assert self.seconds_per_tick is not None
            return tick * self.seconds_per_tick
        index = bisect.bisect_right(self._ticks, tick) - 1
        return (
            self._seconds[index]
            + (tick - self._ticks[index]) * self._rates[index]
            / 1_000_000 / self.division
        )


def resolve_notes(parsed: ParsedMidi) -> tuple[list[Note], dict]:
    time_map = TimeMap(parsed.division, parsed.tempo_events)
    # Channel state is global across Format-1 tracks, but event order within a
    # track is semantically significant even when delta time is zero. For
    # cross-track ties MIDI defines no stronger order, so use file track order
    # as a deterministic merge policy.
    events = sorted(
        parsed.channel_events,
        key=lambda item: (item.tick, item.track, item.order),
    )
    active: dict[tuple[int, int], deque[ActiveNote]] = defaultdict(deque)
    held: dict[int, list[ActiveNote]] = defaultdict(list)
    sustain = [False] * 16
    programs = [0] * 16
    completed: list[tuple[ActiveNote, int]] = []
    warnings = {
        "unmatchedNoteOffs": 0,
        "danglingNotesClosedAtEnd": 0,
        "zeroLengthNotesExtendedOneTick": 0,
    }

    def close(note: ActiveNote, tick: int) -> None:
        if tick <= note.start_tick:
            tick = note.start_tick + 1
            warnings["zeroLengthNotesExtendedOneTick"] += 1
        completed.append((note, tick))

    def release_held(channel: int, tick: int) -> None:
        for note in held[channel]:
            close(note, tick)
        held[channel].clear()

    def release_active(channel: int, tick: int, obey_sustain: bool) -> None:
        for (note_channel, _pitch), queue in list(active.items()):
            if note_channel != channel:
                continue
            while queue:
                note = queue.popleft()
                if obey_sustain and sustain[channel]:
                    held[channel].append(note)
                else:
                    close(note, tick)

    for event in events:
        if event.kind == "program":
            programs[event.channel] = event.data1
        elif event.kind == "note_on":
            active[(event.channel, event.data1)].append(ActiveNote(
                event.tick, event.data1, event.data2, event.channel,
                event.track, programs[event.channel],
            ))
        elif event.kind == "note_off":
            queue = active[(event.channel, event.data1)]
            if not queue:
                warnings["unmatchedNoteOffs"] += 1
                continue
            note = queue.popleft()
            if sustain[event.channel]:
                held[event.channel].append(note)
            else:
                close(note, event.tick)
        elif event.kind == "control":
            controller, value = event.data1, event.data2
            if controller == 64:
                enabled = value >= 64
                if sustain[event.channel] and not enabled:
                    release_held(event.channel, event.tick)
                sustain[event.channel] = enabled
            elif controller == 120:  # All Sound Off
                release_active(event.channel, event.tick, obey_sustain=False)
                release_held(event.channel, event.tick)
            elif controller == 121:  # Reset All Controllers
                sustain[event.channel] = False
                release_held(event.channel, event.tick)
            elif controller == 123 or 124 <= controller <= 127:  # All Notes Off / mode
                release_active(event.channel, event.tick, obey_sustain=True)

    final_tick = max(parsed.track_end_ticks, default=0)
    for queue in active.values():
        while queue:
            close(queue.popleft(), final_tick)
            warnings["danglingNotesClosedAtEnd"] += 1
    for channel_notes in held.values():
        while channel_notes:
            close(channel_notes.pop(0), final_tick)
            warnings["danglingNotesClosedAtEnd"] += 1

    notes = [Note(
        note.start_tick,
        end_tick,
        round(time_map.seconds(note.start_tick), 9),
        round(time_map.seconds(end_tick), 9),
        note.pitch,
        note.velocity,
        note.channel,
        note.track,
        note.program,
    ) for note, end_tick in completed]
    notes.sort(key=lambda item: (
        item.start_tick, item.end_tick, item.track, item.channel,
        item.pitch, item.velocity,
    ))
    timing = {
        "mode": "smpte" if time_map.smpte else "ticksPerQuarter",
        "division": parsed.division,
        "tempoMap": time_map.tempo_points,
    }
    if time_map.smpte:
        timing.update({
            "framesPerSecond": time_map.frames_per_second,
            "ticksPerFrame": time_map.ticks_per_frame,
            "secondsPerTick": time_map.seconds_per_tick,
        })
    return notes, {"warnings": warnings, "timing": timing}


def instrument_code(note: Note) -> int:
    """General-MIDI program, with percussion distinguished by bit 7."""
    return note.program + (128 if note.channel == 9 else 0)


def channel_track_code(channel: int, track: int) -> int:
    """Pack zero-based channel and track into one exact integer."""
    return channel + 16 * track


def _quat(x: float | int, y: float | int, z: float | int, w: float | int) -> dict:
    return {"X": x, "Y": y, "Z": z, "W": w}


def _interval_polyphony(notes: list[Note], release_tail_seconds: float) -> int:
    busy: list[float] = []
    maximum = 0
    for note in sorted(notes, key=lambda item: (item.start_seconds, item.end_seconds)):
        while busy and busy[0] <= note.start_seconds + 1e-12:
            heapq.heappop(busy)
        heapq.heappush(busy, note.end_seconds + release_tail_seconds)
        maximum = max(maximum, len(busy))
    return maximum


def partition_voices(
    notes: list[Note],
    maximum: int,
    release_tail_seconds: float = 0.0,
) -> list[dict]:
    """Min-heap interval partitioning with stable instrument metadata.

    Notes from different program/channel/track groups never share a speaker.
    Within each group, the heap allocation is optimal. ``release_tail_seconds``
    reserves the voice after key-off but never changes the note's true end.
    """
    if maximum <= 0 or maximum > HEADER_VOICE_CAPACITY:
        raise MidiError(
            f"Maximum voice count must be between 1 and {HEADER_VOICE_CAPACITY}"
        )
    if not math.isfinite(release_tail_seconds) or release_tail_seconds < 0:
        raise MidiError("Release tail must be a finite non-negative number of seconds")

    groups: dict[tuple[int, int, int], list[Note]] = defaultdict(list)
    for note in notes:
        groups[(instrument_code(note), note.channel, note.track)].append(note)

    ordered_groups = sorted(
        groups.items(),
        key=lambda item: (
            min(note.start_seconds for note in item[1]),
            item[0][2],
            item[0][1],
            item[0][0],
        ),
    )
    voices: list[dict] = []
    for (program, channel, track), group_notes in ordered_groups:
        local_voices: list[list[Note]] = []
        busy: list[tuple[float, int]] = []
        free: list[int] = []
        for note in sorted(group_notes, key=lambda item: (
            item.start_seconds,
            item.end_seconds,
            item.pitch,
            item.velocity,
        )):
            while busy and busy[0][0] <= note.start_seconds + 1e-12:
                _, voice_index = heapq.heappop(busy)
                heapq.heappush(free, voice_index)
            if free:
                voice_index = heapq.heappop(free)
            else:
                voice_index = len(local_voices)
                local_voices.append([])
            local_voices[voice_index].append(note)
            heapq.heappush(
                busy,
                (note.end_seconds + release_tail_seconds, voice_index),
            )
        for voice_notes in local_voices:
            voices.append({
                "instrumentCode": program,
                "channel": channel,
                "track": track,
                "channelTrackCode": channel_track_code(channel, track),
                "notes": voice_notes,
            })

    if len(voices) > maximum:
        reserved = _interval_polyphony(notes, release_tail_seconds)
        raise MidiError(
            f"Song requires {len(voices)} stable-instrument voices "
            f"({reserved} simultaneously reserved); player limit is {maximum}. "
            "Reduce --release-tail or use a larger player; voice stealing is disabled."
        )
    return voices


def _dropped_note(note: Note) -> dict:
    return {
        "startSeconds": note.start_seconds,
        "endSeconds": note.end_seconds,
        "midiNote": note.pitch,
        "velocity": note.velocity,
        "program": note.program,
        "channel": note.channel,
        "track": note.track,
    }


def _filter_playable_notes(notes: list[Note], policy: str) -> tuple[list[Note], list[dict]]:
    if policy not in ("error", "drop"):
        raise MidiError("Out-of-range policy must be 'error' or 'drop'")
    outside = [
        note for note in notes
        if note.pitch < MIN_PLAYABLE_MIDI or note.pitch > MAX_PLAYABLE_MIDI
    ]
    if outside and policy == "error":
        pitches = sorted({note.pitch for note in outside})
        preview = ", ".join(map(str, pitches[:12]))
        if len(pitches) > 12:
            preview += ", ..."
        raise MidiError(
            f"{len(outside)} note(s) use MIDI pitch(es) {preview}, outside the "
            f"Brickadia synth range {MIN_PLAYABLE_MIDI}..{MAX_PLAYABLE_MIDI} "
            "(PitchMultiplier 0.1..10.0). Use --drop-out-of-range to discard them explicitly."
        )
    playable = [
        note for note in notes
        if MIN_PLAYABLE_MIDI <= note.pitch <= MAX_PLAYABLE_MIDI
    ]
    return playable, [_dropped_note(note) for note in outside]


def build_score(
    path: Path,
    parsed: ParsedMidi,
    notes: list[Note],
    maximum_voices: int,
    release_tail_seconds: float,
    resolution: dict,
    dropped_notes: list[dict] | None = None,
) -> dict:
    voices = partition_voices(notes, maximum_voices, release_tail_seconds)
    duration = round(max((note.end_seconds for note in notes), default=0.0), 9)
    minimum_pitch = min(note.pitch for note in notes)
    maximum_pitch = max(note.pitch for note in notes)

    note_values: list[dict] = []
    voice_headers: list[dict] = []
    voice_metadata: list[dict] = []
    cursor = HEADER_LENGTH
    for voice_index, voice in enumerate(voices):
        voice_notes = voice["notes"]
        voice_headers.append(_quat(
            cursor,
            len(voice_notes),
            voice["instrumentCode"],
            voice["channelTrackCode"],
        ))
        for note in voice_notes:
            note_values.append(_quat(
                note.start_seconds,
                note.end_seconds,
                note.pitch,
                note.velocity,
            ))
        voice_metadata.append({
            "voice": voice_index,
            "offset": cursor,
            "count": len(voice_notes),
            "instrumentCode": voice["instrumentCode"],
            "program": voice["instrumentCode"] & 0x7F,
            "percussion": voice["instrumentCode"] >= 128,
            "channel": voice["channel"],
            "track": voice["track"],
            "channelTrackCode": voice["channelTrackCode"],
        })
        cursor += len(voice_notes)

    final_cursor = cursor
    while len(voice_headers) < HEADER_VOICE_CAPACITY:
        voice_headers.append(_quat(final_cursor, 0, -1, -1))

    values = [
        _quat(MAGIC, FORMAT_VERSION, len(voices), duration),
        _quat(HEADER_LENGTH, release_tail_seconds, minimum_pitch, maximum_pitch),
        *voice_headers,
        *note_values,
    ]
    dropped_notes = dropped_notes or []
    score = {
        "schema": "brickadia-midi-single-quat-array",
        "version": FORMAT_VERSION,
        "source": {
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "midiFormat": parsed.midi_format,
            "trackCount": parsed.track_count,
            "trackNames": parsed.track_names,
        },
        "maximumVoices": HEADER_VOICE_CAPACITY,
        "voiceLimit": maximum_voices,
        "activeVoices": len(voices),
        "releaseTailSeconds": release_tail_seconds,
        "playableMidiRange": [MIN_PLAYABLE_MIDI, MAX_PLAYABLE_MIDI],
        "flags": {
            "absoluteSeconds": True,
            "sustainResolved": True,
            "releaseTailReserved": release_tail_seconds > 0,
            "trueKeyOffInNoteEnd": True,
            "stableInstrumentPerVoice": True,
        },
        "header": {
            "length": HEADER_LENGTH,
            "globalIndex": 0,
            "globalFields": ["magic", "version", "activeVoiceCount", "durationSeconds"],
            "formatIndex": 1,
            "formatFields": [
                "headerLength", "releaseTailSeconds", "scoreMinMidi", "scoreMaxMidi",
            ],
            "voiceTableStart": GLOBAL_HEADER_QUATS,
            "voiceTableCount": HEADER_VOICE_CAPACITY,
            "voiceTableFields": [
                "absoluteNoteOffset", "noteCount", "instrumentCode", "channelTrackCode",
            ],
            "noteFields": ["startSeconds", "endSeconds", "midiNote", "velocity"],
        },
        "timing": resolution["timing"],
        "warnings": resolution["warnings"],
        "voices": voice_metadata,
        "array": {
            "elementType": "Quat",
            "values": values,
        },
        "diagnostics": {
            "droppedOutOfRangeNotes": dropped_notes,
        },
        "statistics": {
            "notes": len(notes),
            "durationSeconds": duration,
            "arrayEntries": len(values),
            "minimumPitch": minimum_pitch,
            "maximumPitch": maximum_pitch,
            "allocatedVoices": len(voices),
            "maximumKeyDownPolyphony": _interval_polyphony(notes, 0.0),
            "maximumReservedPolyphony": _interval_polyphony(notes, release_tail_seconds),
            "instrumentGroups": len({
                (instrument_code(note), note.channel, note.track) for note in notes
            }),
            "droppedOutOfRangeNotes": len(dropped_notes),
        },
    }
    validate_score(score, notes)
    return score


def validate_score(score: dict, source_notes: list[Note]) -> None:
    values = score["array"]["values"]
    if score["array"]["elementType"] != "Quat" or len(values) < HEADER_LENGTH:
        raise AssertionError("Score is not a complete Quat array")
    for index, quat in enumerate(values):
        if set(quat) != {"X", "Y", "Z", "W"}:
            raise AssertionError(f"Array element {index} is not an X/Y/Z/W quaternion")
        if any(
            not isinstance(value, (int, float)) or isinstance(value, bool)
            or not math.isfinite(value)
            for value in quat.values()
        ):
            raise AssertionError(f"Array element {index} contains a non-finite number")

    global_header = values[0]
    format_header = values[1]
    duration = score["statistics"]["durationSeconds"]
    if global_header != _quat(MAGIC, FORMAT_VERSION, score["activeVoices"], duration):
        raise AssertionError("Global quaternion header does not match score metadata")
    if format_header != _quat(
        HEADER_LENGTH,
        score["releaseTailSeconds"],
        score["statistics"]["minimumPitch"],
        score["statistics"]["maximumPitch"],
    ):
        raise AssertionError("Format quaternion header does not match score metadata")

    reconstructed: list[tuple] = []
    previous_end = HEADER_LENGTH
    active_headers = 0
    tail = score["releaseTailSeconds"]
    for voice_index in range(HEADER_VOICE_CAPACITY):
        header = values[GLOBAL_HEADER_QUATS + voice_index]
        offset, count = header["X"], header["Y"]
        instrument, packed = header["Z"], header["W"]
        if not all(isinstance(value, int) and not isinstance(value, bool)
                   for value in (offset, count, instrument, packed)):
            raise AssertionError("Voice header fields must be exact integers")
        if offset != previous_end or count < 0:
            raise AssertionError("Voice note records are not contiguous")
        if count == 0:
            if instrument != -1 or packed != -1:
                raise AssertionError("Unused voice header must use -1 metadata")
            continue
        active_headers += 1
        if active_headers - 1 != voice_index:
            raise AssertionError("Active voice headers must precede unused headers")
        if not 0 <= instrument <= 255 or packed < 0:
            raise AssertionError("Active voice header metadata is invalid")
        channel = packed % 16
        track = packed // 16
        prior_reserved_end = -math.inf
        for note_index in range(count):
            record = values[offset + note_index]
            onset, end = record["X"], record["Y"]
            pitch, velocity = record["Z"], record["W"]
            if onset < prior_reserved_end - 1e-9:
                raise AssertionError(
                    f"Voice {voice_index} overlaps its reserved release tail"
                )
            if (end <= onset or not isinstance(pitch, int)
                    or not MIN_PLAYABLE_MIDI <= pitch <= MAX_PLAYABLE_MIDI
                    or not isinstance(velocity, int) or not 1 <= velocity <= 127):
                raise AssertionError(f"Invalid note quaternion in voice {voice_index}")
            prior_reserved_end = end + tail
            reconstructed.append((
                onset, end, pitch, velocity, instrument, channel, track,
            ))
        previous_end = offset + count
    if active_headers != score["activeVoices"]:
        raise AssertionError("Active voice count does not match header table")
    if previous_end != len(values):
        raise AssertionError("Array has unreferenced trailing quaternions")

    expected = sorted(
        (
            note.start_seconds,
            note.end_seconds,
            note.pitch,
            note.velocity,
            instrument_code(note),
            note.channel,
            note.track,
        )
        for note in source_notes
    )
    if sorted(reconstructed) != expected:
        raise AssertionError("Quat records do not reconstruct the resolved MIDI notes")


def convert_file(
    input_path: Path,
    maximum_voices: int = DEFAULT_MAX_VOICES,
    release_tail_seconds: float = 0.0,
    out_of_range: str = "error",
) -> tuple[dict, dict]:
    parsed = parse_midi(input_path)
    resolved_notes, resolution = resolve_notes(parsed)
    if not resolved_notes:
        raise MidiError("MIDI file contains no notes")
    notes, dropped_notes = _filter_playable_notes(resolved_notes, out_of_range)
    if not notes:
        raise MidiError("No playable notes remain after the pitch-range policy")
    score = build_score(
        input_path,
        parsed,
        notes,
        maximum_voices,
        release_tail_seconds,
        resolution,
        dropped_notes,
    )
    report = {
        **score["statistics"],
        "activeVoices": score["activeVoices"],
        "maximumVoices": HEADER_VOICE_CAPACITY,
        "voiceLimit": maximum_voices,
        "releaseTailSeconds": release_tail_seconds,
        "timing": resolution["timing"],
        "warnings": resolution["warnings"],
        "validation": "passed",
    }
    return score, report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert MIDI to one validated Brickadia Quat ArrayVar score",
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-voices", type=int, default=DEFAULT_MAX_VOICES)
    parser.add_argument(
        "--release-tail",
        type=float,
        default=0.0,
        metavar="SECONDS",
        help="Reserve a voice after key-off without changing the stored key-off time",
    )
    parser.add_argument(
        "--drop-out-of-range",
        action="store_true",
        help=f"Explicitly discard pitches outside MIDI {MIN_PLAYABLE_MIDI}..{MAX_PLAYABLE_MIDI}",
    )
    parser.add_argument(
        "--array-type",
        choices=("quat",),
        default="quat",
        help="Array encoding (Quat is the canonical one-element-per-record format)",
    )
    parser.add_argument("--compact", action="store_true", help="Write compact JSON")
    arguments = parser.parse_args()
    try:
        score, report = convert_file(
            arguments.input,
            arguments.max_voices,
            arguments.release_tail,
            "drop" if arguments.drop_out_of_range else "error",
        )
    except (OSError, MidiError) as error:
        parser.error(str(error))
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(score, separators=(",", ":") if arguments.compact else None,
                   indent=None if arguments.compact else 2)
        + "\n",
        "utf8",
    )
    print(json.dumps({"output": str(arguments.output), **report}, indent=2))


if __name__ == "__main__":
    main()
