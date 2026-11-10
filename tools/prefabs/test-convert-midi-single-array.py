#!/usr/bin/env python3
"""Regression tests for convert-midi-single-array.py.

The fixtures are assembled as raw Standard MIDI Files so the tests exercise the
converter's parser as well as its note resolver and quaternion encoder.  No MIDI
library or network access is required.
"""

from __future__ import annotations

import importlib.util
import inspect
import struct
import sys
import tempfile
import unittest
from pathlib import Path


CONVERTER = Path(__file__).with_name("convert-midi-single-array.py")
SPEC = importlib.util.spec_from_file_location("convert_midi_single_array", CONVERTER)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import machinery guard
    raise RuntimeError(f"Could not import {CONVERTER}")
midi = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = midi
SPEC.loader.exec_module(midi)


def vlq(value: int) -> bytes:
    """Encode the non-negative integer *value* as a MIDI VLQ."""
    if value < 0 or value > 0x0FFFFFFF:
        raise ValueError(value)
    encoded = [value & 0x7F]
    value >>= 7
    while value:
        encoded.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(encoded))


def track(events: list[tuple[int, bytes]], end_tick: int | None = None) -> bytes:
    """Build an MTrk from stable-ordered absolute-tick events."""
    payload = bytearray()
    prior = 0
    for tick, event in sorted(enumerate(events), key=lambda item: (item[1][0], item[0])):
        absolute_tick, raw = event
        if absolute_tick < prior:
            raise ValueError("events are not monotonic")
        payload += vlq(absolute_tick - prior)
        payload += raw
        prior = absolute_tick
    if end_tick is None:
        end_tick = prior
    if end_tick < prior:
        raise ValueError("end tick precedes final event")
    payload += vlq(end_tick - prior) + b"\xff\x2f\x00"
    return b"MTrk" + len(payload).to_bytes(4, "big") + payload


def smf(tracks: list[bytes], division: int = 480, midi_format: int | None = None) -> bytes:
    if midi_format is None:
        midi_format = 0 if len(tracks) == 1 else 1
    header = struct.pack(">4sIHHH", b"MThd", 6, midi_format, len(tracks), division)
    return header + b"".join(tracks)


def tempo(microseconds_per_quarter: int) -> bytes:
    return b"\xff\x51\x03" + microseconds_per_quarter.to_bytes(3, "big")


class MidiFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)

    def write(self, data: bytes, name: str = "fixture.mid") -> Path:
        path = Path(self.temporary.name, name)
        path.write_bytes(data)
        return path

    def convert(self, data: bytes, **kwargs):
        path = self.write(data)
        parameters = inspect.signature(midi.convert_file).parameters
        if "maximum_voices" not in kwargs:
            kwargs["maximum_voices"] = 32
        if "release_tail" in kwargs and "release_tail" not in parameters:
            kwargs["release_tail_seconds"] = kwargs.pop("release_tail")
        return midi.convert_file(path, **kwargs)


class ParserAndResolutionTests(MidiFixture):
    def test_tempo_running_status_fifo_overlap_and_global_program(self) -> None:
        conductor = track([(0, tempo(500_000)), (480, tempo(1_000_000))], 960)
        # The program lives in an earlier-numbered track than the notes.  This
        # verifies that Format-1 channel state is global after tracks are merged,
        # without changing the file's deterministic (tick, track, order) ties.
        channel_state = track([(0, b"\xc2\x28")], 960)
        # The second note-on and second note-off use running status (no repeated
        # status byte).
        melody = track([
            (0, b"\x92\x3c\x64"),
            (120, b"\x3c\x50"),
            (240, b"\x82\x3c\x00"),
            (360, b"\x3c\x00"),
        ], 960)
        path = self.write(smf([conductor, channel_state, melody]))

        parsed = midi.parse_midi(path)
        notes, resolution = midi.resolve_notes(parsed)

        self.assertEqual(len(notes), 2)
        self.assertEqual([note.program for note in notes], [40, 40])
        self.assertEqual([note.start_tick for note in notes], [0, 120])
        # FIFO pairing is observable here: the older of two overlapping copies
        # ends at the first note-off.
        self.assertEqual([note.end_tick for note in notes], [240, 360])
        self.assertEqual(
            [(note.start_seconds, note.end_seconds) for note in notes],
            [(0.0, 0.25), (0.125, 0.375)],
        )
        self.assertEqual(
            [point["microsecondsPerQuarter"] for point in resolution["timing"]["tempoMap"]],
            [500_000, 1_000_000],
        )
        self.assertEqual(resolution["warnings"]["unmatchedNoteOffs"], 0)

    def test_realtime_status_does_not_cancel_running_status(self) -> None:
        data = smf([track([
            (0, b"\x90\x3c\x64"),
            (120, b"\xf8"),              # timing clock preserves running status
            (120, b"\x3e\x50"),
            (240, b"\x80\x3c\x00"),
            (240, b"\x3e\x00"),
        ], 240)])
        notes, _ = midi.resolve_notes(midi.parse_midi(self.write(data)))
        self.assertEqual(
            sorted((note.pitch, note.start_tick, note.end_tick) for note in notes),
            [(60, 0, 240), (62, 120, 240)],
        )

    def test_sustain_reset_all_notes_off_and_all_sound_off(self) -> None:
        events = [
            (0, b"\xb0\x40\x7f"),       # sustain on
            (0, b"\x90\x3c\x64"),
            (120, b"\x80\x3c\x00"),    # held by pedal
            (240, b"\x90\x3e\x60"),
            (360, b"\xb0\x7b\x00"),    # CC123: move active note to pedal-held
            (480, b"\xb0\x79\x00"),    # CC121: pedal reset releases both
            (480, b"\x90\x43\x58"),
            (600, b"\xb0\x7b\x00"),    # sustain is off, so close immediately
            (720, b"\xb0\x40\x7f"),
            (720, b"\x90\x40\x50"),
            (840, b"\x80\x40\x00"),    # held by pedal
            (960, b"\x90\x41\x48"),
            (1080, b"\xb0\x78\x00"),   # CC120: immediate even under sustain
        ]
        path = self.write(smf([track(events, 1200)]))
        notes, resolution = midi.resolve_notes(midi.parse_midi(path))
        by_pitch = {note.pitch: note for note in notes}

        self.assertEqual((by_pitch[60].start_tick, by_pitch[60].end_tick), (0, 480))
        self.assertEqual((by_pitch[62].start_tick, by_pitch[62].end_tick), (240, 480))
        self.assertEqual((by_pitch[67].start_tick, by_pitch[67].end_tick), (480, 600))
        self.assertEqual((by_pitch[64].start_tick, by_pitch[64].end_tick), (720, 1080))
        self.assertEqual((by_pitch[65].start_tick, by_pitch[65].end_tick), (960, 1080))
        self.assertEqual(resolution["warnings"]["danglingNotesClosedAtEnd"], 0)

    def test_cross_track_ties_follow_track_order(self) -> None:
        # The lower-numbered control track executes CC123 before the same-tick
        # note-on in the later track.  This closes the old note while allowing
        # the new one to continue, exactly as the merged SMF order specifies.
        control_track = track([(120, b"\xb0\x7b\x00")], 240)
        notes_track = track([
            (0, b"\x90\x3c\x64"),
            (120, b"\x90\x3e\x50"),
            (240, b"\x80\x3e\x00"),
        ], 240)
        notes, resolution = midi.resolve_notes(
            midi.parse_midi(self.write(smf([control_track, notes_track])))
        )
        self.assertEqual(
            sorted((note.pitch, note.start_tick, note.end_tick) for note in notes),
            [(60, 0, 120), (62, 120, 240)],
        )
        self.assertEqual(resolution["warnings"]["unmatchedNoteOffs"], 0)

    def test_same_track_program_and_note_on_keep_source_order(self) -> None:
        events = [
            # Note-on precedes ProgramChange: it captures the old default program.
            (0, b"\x90\x3c\x64"),
            (0, b"\xc0\x0a"),
            (120, b"\x80\x3c\x00"),
            # ProgramChange precedes NoteOn: the new note captures program 20.
            (240, b"\xc0\x14"),
            (240, b"\x90\x3e\x64"),
            (360, b"\x80\x3e\x00"),
        ]
        notes, _ = midi.resolve_notes(
            midi.parse_midi(self.write(smf([track(events, 360)])))
        )
        self.assertEqual(
            [(note.pitch, note.program) for note in notes],
            [(60, 0), (62, 20)],
        )

    def test_smpte_drop_frame_timing(self) -> None:
        # -29 means 29.97 drop-frame timing.  At 10 ticks/frame, 300 ticks are
        # 1.001 seconds exactly (to the converter's nine-decimal precision).
        division = ((-29 & 0xFF) << 8) | 10
        data = smf([track([
            (0, b"\x90\x3c\x64"),
            (300, b"\x80\x3c\x00"),
        ], 300)], division=division)
        notes, resolution = midi.resolve_notes(midi.parse_midi(self.write(data)))
        self.assertEqual(resolution["timing"]["mode"], "smpte")
        self.assertAlmostEqual(notes[0].end_seconds, 1.001, places=9)


class QuaternionEncodingTests(MidiFixture):
    def test_quaternion_header_records_and_stable_instrument_voices(self) -> None:
        # Four sequential, non-overlapping notes still require four voices: each
        # changes a stable voice property (program, MIDI channel, or percussion).
        events = [
            (0, b"\xc0\x01"),
            (0, b"\x90\x3c\x64"),
            (96, b"\x80\x3c\x00"),
            (96, b"\xc0\x02"),
            (96, b"\x90\x3d\x64"),
            (192, b"\x80\x3d\x00"),
            (192, b"\xc1\x01"),
            (192, b"\x91\x3e\x64"),
            (288, b"\x81\x3e\x00"),
            (288, b"\xc9\x00"),
            (288, b"\x99\x24\x64"),
            (384, b"\x89\x24\x00"),
        ]
        score, report = self.convert(smf([track(events, 384)]), release_tail=0.0)
        values = score["array"]["values"]

        self.assertEqual(score["array"]["elementType"].lower(), "quat")
        self.assertEqual(len(values), 34 + 4)
        self.assertEqual(
            (values[0]["X"], values[0]["Y"], values[0]["Z"]),
            (midi.MAGIC, midi.FORMAT_VERSION, 4),
        )
        self.assertEqual(score["activeVoices"], 4)
        self.assertEqual(
            score["header"]["formatFields"][-2:],
            ["scoreMinMidi", "scoreMaxMidi"],
        )
        self.assertEqual(
            (values[1]["X"], values[1]["Y"], values[1]["Z"], values[1]["W"]),
            (34, 0.0, 36, 62),
        )
        headers = values[2:34]
        used = [header for header in headers if header["Y"]]
        self.assertEqual([header["X"] for header in used], [34, 35, 36, 37])
        self.assertEqual([header["Y"] for header in used], [1, 1, 1, 1])
        self.assertEqual(sorted(header["Z"] for header in used), [1, 1, 2, 128])
        self.assertEqual(sorted(header["W"] for header in used), [0, 0, 1, 9])
        self.assertEqual(
            sorted((record["Z"], record["W"]) for record in values[34:]),
            [(36, 100), (60, 100), (61, 100), (62, 100)],
        )
        self.assertEqual(report["notes"], 4)

    def test_release_tail_reserves_voice_but_does_not_extend_record_end(self) -> None:
        events = [
            (0, b"\x90\x3c\x64"),
            (96, b"\x80\x3c\x00"),       # end 0.1 s
            (192, b"\x90\x3e\x64"),      # starts 0.2 s; within 0.2 s tail
            (288, b"\x80\x3e\x00"),
        ]
        data = smf([track(events, 288)])
        no_tail, _ = self.convert(data, release_tail=0.0)
        tail, _ = self.convert(data, release_tail=0.2)

        self.assertEqual(no_tail["activeVoices"], 1)
        self.assertEqual(tail["activeVoices"], 2)
        self.assertEqual(tail["releaseTailSeconds"], 0.2)
        self.assertEqual(tail["array"]["values"][1]["Y"], 0.2)
        records = tail["array"]["values"][34:]
        self.assertEqual(sorted(record["Y"] for record in records), [0.1, 0.3])

    def test_voice_header_track_code_is_stable(self) -> None:
        conductor = track([(0, tempo(500_000))], 384)
        first = track([
            (0, b"\xc0\x01"),
            (0, b"\x90\x3c\x50"),
            (96, b"\x80\x3c\x00"),
        ], 384)
        second = track([
            (192, b"\x90\x3e\x50"),
            (288, b"\x80\x3e\x00"),
        ], 384)
        score, _ = self.convert(smf([conductor, first, second]), release_tail=0.0)
        used = [header for header in score["array"]["values"][2:34] if header["Y"]]
        # Both notes use program 1 on global channel 0, but their diagnostic
        # track code differs, so a voice never changes its header metadata.
        self.assertEqual(score["activeVoices"], 2)
        self.assertEqual([header["Z"] for header in used], [1, 1])
        self.assertEqual(sorted(header["W"] for header in used), [16, 32])

    def test_pitch_range_defaults_to_error_and_can_drop(self) -> None:
        events = [
            (0, b"\x90\x1d\x50"),       # 29: below 0.1 pitch multiplier
            (0, b"\x90\x3c\x64"),       # 60: playable
            (0, b"\x90\x6d\x50"),       # 109: above 10x pitch multiplier
            (96, b"\x80\x1d\x00"),
            (96, b"\x80\x3c\x00"),
            (96, b"\x80\x6d\x00"),
        ]
        data = smf([track(events, 96)])
        with self.assertRaisesRegex(midi.MidiError, r"29|109|range|playable"):
            self.convert(data, release_tail=0.0)

        score, report = self.convert(data, release_tail=0.0, out_of_range="drop")
        self.assertEqual(report["notes"], 1)
        self.assertEqual(score["array"]["values"][34]["Z"], 60)
        self.assertEqual(report["droppedOutOfRangeNotes"], 2)
        self.assertEqual(len(score["diagnostics"]["droppedOutOfRangeNotes"]), 2)

    def test_more_than_32_simultaneous_notes_fails_cleanly(self) -> None:
        events = []
        for pitch in range(33):
            events.append((0, bytes((0x90, 40 + pitch, 80))))
        for pitch in range(33):
            events.append((480, bytes((0x80, 40 + pitch, 0))))
        data = smf([track(events, 480)])
        with self.assertRaisesRegex(midi.MidiError, r"33.*voices|voices.*32"):
            self.convert(data, release_tail=0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
