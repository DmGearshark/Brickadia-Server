#!/usr/bin/env python3
"""Arrange a dense piano MIDI for the 18-voice SQM1 player.

The canonical MIDI converter deliberately rejects songs that need more voices
than the player owns. Piano exports often leave every arpeggiated note held
until a pedal release, though, so their instantaneous MIDI polyphony can be far
higher than the number of newly struck notes. This arranger preserves every
onset, pitch class and velocity while shortening the oldest held notes only
when another note needs one of the fixed voices.

Pitches outside the Sine player's MIDI 30..108 range are folded by octaves,
and compatible piano tracks are merged into one stable instrument group. The
result remains a normal SQM1 format-1 score and is validated by the canonical
converter before being written.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import importlib.util
import json
import math
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
CONVERTER_PATH = HERE / "convert-midi-single-array.py"


def load_converter():
    spec = importlib.util.spec_from_file_location("sqm1_midi_converter", CONVERTER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {CONVERTER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


CONVERTER = load_converter()


def fold_pitch(pitch: int) -> int:
    while pitch < CONVERTER.MIN_PLAYABLE_MIDI:
        pitch += 12
    while pitch > CONVERTER.MAX_PLAYABLE_MIDI:
        pitch -= 12
    return pitch


def normalize_piano_notes(notes):
    programs = {(note.program, note.channel) for note in notes}
    if len(programs) != 1:
        raise CONVERTER.MidiError(
            "Piano arranger requires one program/channel after MIDI resolution; "
            f"found {len(programs)} groups"
        )
    target_track = min(note.track for note in notes)
    arranged = []
    folded = []
    for index, note in enumerate(notes):
        pitch = fold_pitch(note.pitch)
        if pitch != note.pitch:
            folded.append({
                "sourceNoteIndex": index,
                "startSeconds": note.start_seconds,
                "originalMidiNote": note.pitch,
                "arrangedMidiNote": pitch,
                "octavesMoved": (pitch - note.pitch) // 12,
            })
        arranged.append(dataclasses.replace(note, pitch=pitch, track=target_track))
    return arranged, folded, target_track


def limit_held_notes(notes, maximum_voices: int, release_tail_seconds: float):
    if not 1 <= maximum_voices <= CONVERTER.HEADER_VOICE_CAPACITY:
        raise CONVERTER.MidiError("Maximum voices must be between 1 and 32")
    if not math.isfinite(release_tail_seconds) or release_tail_seconds < 0:
        raise CONVERTER.MidiError("Release tail must be finite and non-negative")

    by_start = collections.defaultdict(list)
    for note in notes:
        by_start[note.start_seconds].append(note)
    largest_onset = max(map(len, by_start.values()), default=0)
    if largest_onset > maximum_voices:
        raise CONVERTER.MidiError(
            f"One onset contains {largest_onset} notes, above the "
            f"{maximum_voices}-voice limit"
        )

    lanes: list[list] = []
    shortened = []
    for start_seconds, batch in sorted(by_start.items()):
        free = [
            index for index, lane in enumerate(lanes)
            if lane[-1].end_seconds + release_tail_seconds <= start_seconds + 1e-12
        ]

        new_lane_count = min(
            len(batch) - len(free),
            maximum_voices - len(lanes),
        )
        for _ in range(max(0, new_lane_count)):
            lanes.append([])
            free.append(len(lanes) - 1)

        needed = len(batch) - len(free)
        if needed > 0:
            active = [index for index in range(len(lanes)) if index not in free]
            cutoff = round(start_seconds - release_tail_seconds, 9)
            eligible = [
                index for index in active
                if cutoff > lanes[index][-1].start_seconds
            ]
            # Reclaim the note that naturally ends first. Ties prefer the
            # oldest and then the quietest note, which preserves new melodic
            # activity and minimizes the duration removed.
            eligible.sort(key=lambda index: (
                lanes[index][-1].end_seconds,
                lanes[index][-1].start_seconds,
                lanes[index][-1].velocity,
                lanes[index][-1].pitch,
            ))
            if len(eligible) < needed:
                raise CONVERTER.MidiError(
                    "The requested release tail leaves too little time to reuse "
                    f"{needed} voice(s) at {start_seconds:.9f} seconds"
                )
            earliest_new_tick = min(note.start_tick for note in batch)
            for lane_index in eligible[:needed]:
                original = lanes[lane_index][-1]
                replacement = dataclasses.replace(
                    original,
                    end_tick=max(original.start_tick + 1, earliest_new_tick - 1),
                    end_seconds=cutoff,
                )
                lanes[lane_index][-1] = replacement
                shortened.append({
                    "startSeconds": original.start_seconds,
                    "originalEndSeconds": original.end_seconds,
                    "arrangedEndSeconds": replacement.end_seconds,
                    "midiNote": original.pitch,
                    "velocity": original.velocity,
                    "secondsRemoved": round(
                        original.end_seconds - replacement.end_seconds, 9
                    ),
                })
                free.append(lane_index)

        if len(free) < len(batch):
            raise AssertionError("Voice limiter failed to provide one lane per onset")
        ordered_batch = sorted(
            batch,
            key=lambda note: (note.pitch, note.velocity, note.end_seconds),
        )
        for note, lane_index in zip(ordered_batch, sorted(free)[:len(batch)]):
            lanes[lane_index].append(note)

    arranged = [note for lane in lanes for note in lane]
    arranged.sort(key=lambda note: (
        note.start_tick, note.end_tick, note.track, note.channel,
        note.pitch, note.velocity,
    ))
    return arranged, shortened, largest_onset


def arrange(input_path: Path, maximum_voices: int, release_tail_seconds: float):
    parsed = CONVERTER.parse_midi(input_path)
    source_notes, resolution = CONVERTER.resolve_notes(parsed)
    if not source_notes:
        raise CONVERTER.MidiError("MIDI file contains no notes")
    normalized, folded, target_track = normalize_piano_notes(source_notes)
    arranged, shortened, largest_onset = limit_held_notes(
        normalized, maximum_voices, release_tail_seconds
    )
    if len(arranged) != len(source_notes):
        raise AssertionError("The arranger must preserve every MIDI note onset")

    score = CONVERTER.build_score(
        input_path,
        parsed,
        arranged,
        maximum_voices,
        release_tail_seconds,
        resolution,
        [],
    )
    score["arrangement"] = {
        "mode": "oldest-held-note-reuse",
        "originalNotes": len(source_notes),
        "preservedNoteOnsets": len(arranged),
        "originalTrackCount": parsed.track_count,
        "mergedTrack": target_track,
        "octaveFoldedNotes": len(folded),
        "shortenedHeldNotes": len(shortened),
        "totalHeldSecondsRemoved": round(
            sum(item["secondsRemoved"] for item in shortened), 9
        ),
        "largestSimultaneousOnset": largest_onset,
        "originalMaximumKeyDownPolyphony": CONVERTER._interval_polyphony(
            normalized, 0.0
        ),
        "arrangedMaximumKeyDownPolyphony": CONVERTER._interval_polyphony(
            arranged, 0.0
        ),
        "arrangedMaximumReservedPolyphony": CONVERTER._interval_polyphony(
            arranged, release_tail_seconds
        ),
        "foldedPitchRecords": folded,
        "shortenedNoteRecords": shortened,
    }
    report = {
        **score["statistics"],
        "activeVoices": score["activeVoices"],
        "releaseTailSeconds": release_tail_seconds,
        **{key: value for key, value in score["arrangement"].items()
           if not key.endswith("Records")},
        "validation": "passed",
    }
    return score, report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Arrange a dense piano MIDI for one validated SQM1 Quat array",
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-voices", type=int, default=18)
    parser.add_argument("--release-tail", type=float, default=0.12, metavar="SECONDS")
    parser.add_argument("--compact", action="store_true")
    arguments = parser.parse_args()
    try:
        score, report = arrange(
            arguments.input, arguments.max_voices, arguments.release_tail
        )
    except (OSError, CONVERTER.MidiError) as error:
        parser.error(str(error))
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(
            score,
            separators=(",", ":") if arguments.compact else None,
            indent=None if arguments.compact else 2,
        ) + "\n",
        "utf8",
    )
    print(json.dumps({"output": str(arguments.output), **report}, indent=2))


if __name__ == "__main__":
    main()
