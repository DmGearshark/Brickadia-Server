#!/usr/bin/env python3
"""Focused tests for the dense-piano SQM1 arranger."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("arrange-piano-midi-single-array.py")
SPEC = importlib.util.spec_from_file_location("sqm1_piano_arranger", SCRIPT)
assert SPEC and SPEC.loader
ARRANGER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ARRANGER
SPEC.loader.exec_module(ARRANGER)
Note = ARRANGER.CONVERTER.Note


def note(start, end, pitch, *, track=0, program=0, velocity=80):
    return Note(
        int(start * 1000), int(end * 1000), start, end,
        pitch, velocity, 0, track, program,
    )


class PianoArrangerTests(unittest.TestCase):
    def test_pitch_folding_and_compatible_track_merge(self):
        source = [
            note(0.0, 1.0, 21, track=1),
            note(1.0, 2.0, 26, track=0),
            note(2.0, 3.0, 105, track=1),
        ]
        arranged, folded, target = ARRANGER.normalize_piano_notes(source)
        self.assertEqual([item.pitch for item in arranged], [33, 38, 105])
        self.assertEqual([item.track for item in arranged], [0, 0, 0])
        self.assertEqual([item["octavesMoved"] for item in folded], [1, 1])
        self.assertEqual(target, 0)

    def test_multiple_programs_are_rejected(self):
        with self.assertRaisesRegex(
            ARRANGER.CONVERTER.MidiError, "one program/channel"
        ):
            ARRANGER.normalize_piano_notes([
                note(0.0, 1.0, 60, program=0),
                note(1.0, 2.0, 64, program=1),
            ])

    def test_oldest_held_note_is_shortened_without_dropping_onsets(self):
        source = [
            note(0.0, 3.0, 60),
            note(0.0, 3.0, 64),
            note(1.0, 2.0, 67),
        ]
        arranged, shortened, largest = ARRANGER.limit_held_notes(source, 2, 0.1)
        self.assertEqual(len(arranged), len(source))
        self.assertEqual(largest, 2)
        self.assertEqual(len(shortened), 1)
        self.assertEqual(shortened[0]["arrangedEndSeconds"], 0.9)
        self.assertEqual(
            ARRANGER.CONVERTER._interval_polyphony(arranged, 0.1), 2
        )
        self.assertEqual(
            sorted((item.start_seconds, item.pitch) for item in arranged),
            [(0.0, 60), (0.0, 64), (1.0, 67)],
        )


if __name__ == "__main__":
    unittest.main()
