#!/usr/bin/env python3
"""Revoice His Theme V3 to keep each physical Sine lane near one pitch.

The V3 score preserves every MIDI onset and minimizes pedal-held sustain loss,
but its lowest-free-index allocator can move one lane several octaves between
successive notes.  This generator reconstructs the already normalized source
notes from V3, then applies the same two primary objectives (fewest cuts and
least removed sustain) before using pitch distance as a deterministic tertiary
objective.  It changes no player logic and requires no source MIDI file.
"""

from __future__ import annotations

import argparse
import collections
import copy
import json
import math
from pathlib import Path


HERE = Path(__file__).resolve().parent
SOURCE_DEFAULT = HERE / "undertale-his-theme-single-quat-score-v3.json"
OUTPUT_DEFAULT = HERE / "undertale-his-theme-single-quat-score-v4.json"
HEADER_LENGTH = 34
VOICE_TABLE_LENGTH = 32
VOICE_LIMIT = 24
EPSILON = 1e-12
SHORT_TRANSITION_SECONDS = 0.4


def round_seconds(value: float) -> float:
    rounded = round(value, 9)
    return 0.0 if rounded == 0 else rounded


def voice_lanes(document: dict) -> list[list[dict]]:
    values = document["array"]["values"]
    active = values[0]["Z"]
    lanes = []
    for voice in range(active):
        header = values[2 + voice]
        lanes.append(copy.deepcopy(values[header["X"]:header["X"] + header["Y"]]))
    return lanes


def restore_original_notes(document: dict) -> list[dict]:
    notes = []
    by_arranged_identity: dict[tuple, list[dict]] = collections.defaultdict(list)
    for source_voice, lane in enumerate(voice_lanes(document)):
        for source_index, value in enumerate(lane):
            note = {
                "start": value["X"],
                "end": value["Y"],
                "pitch": value["Z"],
                "velocity": value["W"],
                "sourceVoice": source_voice,
                "sourceIndex": source_index,
            }
            notes.append(note)
            key = (note["start"], note["end"], note["pitch"], note["velocity"])
            by_arranged_identity[key].append(note)

    restored = set()
    shortened = document["arrangement"]["shortenedNoteRecords"]
    for record in shortened:
        key = (
            record["startSeconds"],
            record["arrangedEndSeconds"],
            record["midiNote"],
            record["velocity"],
        )
        candidates = by_arranged_identity.get(key, [])
        note = next((candidate for candidate in candidates
                     if id(candidate) not in restored), None)
        if note is None:
            raise ValueError(f"Unable to restore shortened V3 note {record}")
        expected = round_seconds(record["originalEndSeconds"] - note["end"])
        if expected != record["secondsRemoved"]:
            raise ValueError(f"Inconsistent V3 shortened-note record {record}")
        restored.add(id(note))
        note["end"] = record["originalEndSeconds"]

    if len(restored) != len(shortened):
        raise AssertionError("Every V3 shortened-note record must restore one note")
    return sorted(notes, key=lambda note: (
        note["start"], note["end"], note["pitch"], note["velocity"],
        note["sourceVoice"], note["sourceIndex"],
    ))


def add_cost(left: tuple[int, int, int], right: tuple[int, int, int]):
    return tuple(a + b for a, b in zip(left, right))


def best_assignment(candidates: list[int], batch: list[dict], lanes: list[list[dict]],
                    start_seconds: float, cutoff: float, release_tail: float):
    """Return a lexicographically minimal lane/note matching.

    Cost is (number of cuts, removed sustain nanoseconds, semitone distance),
    so pitch continuity can never cause another cut or remove more sustain.
    The MIDI's largest simultaneous onset is five notes, keeping this bitmask
    dynamic program small even with all 24 lanes available.
    """
    state: dict[int, tuple[tuple[int, int, int], tuple]] = {
        0: ((0, 0, 0), ()),
    }
    for lane_index in sorted(candidates):
        previous = lanes[lane_index][-1] if lanes[lane_index] else None
        cut = bool(previous and
                   previous["end"] + release_tail > start_seconds + EPSILON)
        removed_ns = (int(round((previous["end"] - cutoff) * 1_000_000_000))
                      if cut else 0)
        next_state = dict(state)
        for mask, (cost, assignments) in state.items():
            for note_index, note in enumerate(batch):
                if mask & (1 << note_index):
                    continue
                pitch_distance = (abs(previous["pitch"] - note["pitch"])
                                  if previous else 0)
                new_mask = mask | (1 << note_index)
                new_cost = add_cost(cost, (int(cut), removed_ns, pitch_distance))
                new_assignments = assignments + ((lane_index, note_index, cut),)
                candidate = (new_cost, new_assignments)
                if new_mask not in next_state or candidate < next_state[new_mask]:
                    next_state[new_mask] = candidate
        state = next_state
    complete = (1 << len(batch)) - 1
    if complete not in state:
        raise ValueError("Unable to assign an onset batch to available lanes")
    return state[complete]


def allocate_pitch_continuous(notes: list[dict], release_tail: float):
    by_start: dict[float, list[dict]] = collections.defaultdict(list)
    for note in notes:
        by_start[note["start"]].append(copy.deepcopy(note))

    lanes: list[list[dict]] = []
    shortened = []
    largest_onset = 0
    for start_seconds, unsorted_batch in sorted(by_start.items()):
        batch = sorted(unsorted_batch, key=lambda note: (
            note["pitch"], note["velocity"], note["end"],
            note["sourceVoice"], note["sourceIndex"],
        ))
        largest_onset = max(largest_onset, len(batch))
        if len(batch) > VOICE_LIMIT:
            raise ValueError("One onset exceeds the 24-lane player")

        free = [index for index, lane in enumerate(lanes)
                if lane[-1]["end"] + release_tail <= start_seconds + EPSILON]
        new_lane_count = min(
            len(batch) - len(free),
            VOICE_LIMIT - len(lanes),
        )
        for _ in range(max(0, new_lane_count)):
            lanes.append([])
            free.append(len(lanes) - 1)

        cutoff = round_seconds(start_seconds - release_tail)
        eligible = [
            index for index, lane in enumerate(lanes)
            if index not in free and cutoff > lane[-1]["start"]
        ]
        cost, assignments = best_assignment(
            free + eligible, batch, lanes, start_seconds, cutoff, release_tail,
        )
        required_cuts = max(0, len(batch) - len(free))
        if cost[0] != required_cuts:
            raise ValueError(f"Pitch matcher added a cut at {start_seconds}")

        for lane_index, note_index, cut in assignments:
            if cut:
                previous = lanes[lane_index][-1]
                original_end = previous["end"]
                previous["end"] = cutoff
                seconds_removed = round_seconds(original_end - cutoff)
                shortened.append({
                    "startSeconds": previous["start"],
                    "originalEndSeconds": original_end,
                    "arrangedEndSeconds": cutoff,
                    "midiNote": previous["pitch"],
                    "velocity": previous["velocity"],
                    "secondsRemoved": seconds_removed,
                })
            lanes[lane_index].append(batch[note_index])

    if len(lanes) != VOICE_LIMIT:
        raise AssertionError(f"Expected 24 lanes, got {len(lanes)}")
    return lanes, shortened, largest_onset


def maximum_polyphony(notes: list[dict], release_tail: float = 0.0) -> int:
    events = []
    for note in notes:
        events.append((note["start"], 1))
        events.append((round_seconds(note["end"] + release_tail), -1))
    events.sort(key=lambda event: (event[0], event[1]))
    active = 0
    maximum = 0
    for _, delta in events:
        active += delta
        if active < 0:
            raise AssertionError("Polyphony sweep closed before opening")
        maximum = max(maximum, active)
    if active != 0:
        raise AssertionError("Polyphony sweep did not close")
    return maximum


def transition_metrics(lanes: list[list[dict]]) -> dict:
    gaps_and_jumps = [
        (next_note["start"] - note["end"],
         abs(next_note["pitch"] - note["pitch"]))
        for lane in lanes for note, next_note in zip(lane, lane[1:])
    ]
    return {
        "transitions": len(gaps_and_jumps),
        "samePitchTransitions": sum(jump == 0 for _, jump in gaps_and_jumps),
        "jumpsAtLeast12Semitones": sum(jump >= 12 for _, jump in gaps_and_jumps),
        "jumpsAtLeast24Semitones": sum(jump >= 24 for _, jump in gaps_and_jumps),
        "jumpsAtLeast36Semitones": sum(jump >= 36 for _, jump in gaps_and_jumps),
        "shortGapSeconds": SHORT_TRANSITION_SECONDS,
        "shortGapJumpsAtLeast12Semitones": sum(
            gap <= SHORT_TRANSITION_SECONDS + EPSILON and jump >= 12
            for gap, jump in gaps_and_jumps
        ),
        "shortGapJumpsAtLeast24Semitones": sum(
            gap <= SHORT_TRANSITION_SECONDS + EPSILON and jump >= 24
            for gap, jump in gaps_and_jumps
        ),
        "maximumJumpSemitones": max((jump for _, jump in gaps_and_jumps), default=0),
        "minimumGapSeconds": round_seconds(
            min((gap for gap, _ in gaps_and_jumps), default=0.0)
        ),
    }


def build_document(source: dict) -> tuple[dict, dict]:
    values = source["array"]["values"]
    if values[0]["Z"] != VOICE_LIMIT or values[1]["Y"] != 0.2:
        raise ValueError("V4 generator requires the canonical 24-lane V3 score")
    release_tail = values[1]["Y"]
    original_notes = restore_original_notes(source)
    lanes, shortened, largest_onset = allocate_pitch_continuous(
        original_notes, release_tail,
    )
    arranged_notes = [note for lane in lanes for note in lane]
    duration = round_seconds(max(note["end"] for note in arranged_notes))
    minimum_pitch = min(note["pitch"] for note in arranged_notes)
    maximum_pitch = max(note["pitch"] for note in arranged_notes)

    note_values = []
    voice_headers = []
    voice_metadata = []
    cursor = HEADER_LENGTH
    source_voice = source["voices"][0]
    for voice, lane in enumerate(lanes):
        voice_headers.append({
            "X": cursor, "Y": len(lane),
            "Z": source_voice["instrumentCode"],
            "W": source_voice["channelTrackCode"],
        })
        voice_metadata.append({
            "voice": voice,
            "offset": cursor,
            "count": len(lane),
            "instrumentCode": source_voice["instrumentCode"],
            "program": source_voice["program"],
            "percussion": source_voice["percussion"],
            "channel": source_voice["channel"],
            "track": source_voice["track"],
            "channelTrackCode": source_voice["channelTrackCode"],
        })
        note_values.extend({
            "X": note["start"], "Y": note["end"],
            "Z": note["pitch"], "W": note["velocity"],
        } for note in lane)
        cursor += len(lane)
    while len(voice_headers) < VOICE_TABLE_LENGTH:
        voice_headers.append({"X": cursor, "Y": 0, "Z": -1, "W": -1})

    output_values = [
        {"X": 7701001, "Y": 1, "Z": VOICE_LIMIT, "W": duration},
        {"X": HEADER_LENGTH, "Y": release_tail,
         "Z": minimum_pitch, "W": maximum_pitch},
        *voice_headers,
        *note_values,
    ]
    baseline_metrics = transition_metrics([
        [{"start": note["X"], "end": note["Y"],
          "pitch": note["Z"], "velocity": note["W"]} for note in lane]
        for lane in voice_lanes(source)
    ])
    continuity_metrics = transition_metrics(lanes)
    removed = round_seconds(sum(record["secondsRemoved"] for record in shortened))

    document = copy.deepcopy(source)
    document["voices"] = voice_metadata
    document["array"] = {"elementType": "Quat", "values": output_values}
    document["statistics"] = {
        "notes": len(arranged_notes),
        "durationSeconds": duration,
        "arrayEntries": len(output_values),
        "minimumPitch": minimum_pitch,
        "maximumPitch": maximum_pitch,
        "allocatedVoices": len(lanes),
        "maximumKeyDownPolyphony": maximum_polyphony(arranged_notes),
        "maximumReservedPolyphony": maximum_polyphony(arranged_notes, release_tail),
        "instrumentGroups": 1,
        "droppedOutOfRangeNotes": 0,
    }
    document["arrangement"] = {
        "mode": "pitch-continuity-revoice-from-v3",
        "sourceScore": SOURCE_DEFAULT.name,
        "allocationObjectives": [
            "minimum-shortened-note-count",
            "minimum-removed-sustain",
            "minimum-lane-pitch-distance",
        ],
        "originalNotes": len(original_notes),
        "preservedNoteOnsets": len(arranged_notes),
        "originalTrackCount": source["arrangement"]["originalTrackCount"],
        "mergedTrack": source["arrangement"]["mergedTrack"],
        "octaveFoldedNotes": source["arrangement"]["octaveFoldedNotes"],
        "shortenedHeldNotes": len(shortened),
        "totalHeldSecondsRemoved": removed,
        "largestSimultaneousOnset": largest_onset,
        "originalMaximumKeyDownPolyphony": source["arrangement"][
            "originalMaximumKeyDownPolyphony"
        ],
        "arrangedMaximumKeyDownPolyphony": maximum_polyphony(arranged_notes),
        "arrangedMaximumReservedPolyphony": maximum_polyphony(
            arranged_notes, release_tail
        ),
        "baselineTransitionMetrics": baseline_metrics,
        "transitionMetrics": continuity_metrics,
        "foldedPitchRecords": copy.deepcopy(
            source["arrangement"]["foldedPitchRecords"]
        ),
        "shortenedNoteRecords": shortened,
    }
    report = {
        **document["statistics"],
        "activeVoices": VOICE_LIMIT,
        "releaseTailSeconds": release_tail,
        "shortenedHeldNotes": len(shortened),
        "totalHeldSecondsRemoved": removed,
        "baselineTransitionMetrics": baseline_metrics,
        "transitionMetrics": continuity_metrics,
        "validation": "generated",
    }
    return document, report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Revoice His Theme V3 for pitch-continuous 24-lane playback",
    )
    parser.add_argument("source", type=Path, nargs="?", default=SOURCE_DEFAULT)
    parser.add_argument("output", type=Path, nargs="?", default=OUTPUT_DEFAULT)
    parser.add_argument("--compact", action="store_true")
    arguments = parser.parse_args()
    source = json.loads(arguments.source.read_text("utf8"))
    document, report = build_document(source)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(
        document,
        separators=(",", ":") if arguments.compact else None,
        indent=None if arguments.compact else 2,
    ) + "\n", "utf8")
    print(json.dumps({"output": str(arguments.output), **report}, indent=2))


if __name__ == "__main__":
    main()
