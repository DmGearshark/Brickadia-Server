# Viva La Vida — six-voice array sequencer

## Array player v3: adjustable tempo

The source MIDI specifies 120 BPM. At the user's report that playback felt
slow, v3 adds an exposed SPEED variable, default 1.15 (138 BPM equivalent).
Elapsed clock time is multiplied by this value before all twelve note-time
comparisons and the auto-stop comparison. Pitch and velocity are unchanged.
Set speed to 1.0 for source tempo; stop playback before changing the value,
then Play again. It scales elapsed time, not the remaining interval, so changing
it during playback can skip forward/backward in the score.

V3 has 223 bricks, 225 components and 345 wires. Checks verify the saved speed
value and all thirteen scaled timing connections. Live perceived tempo still
depends on the game's evaluation rate and the one-tick voice advance buffers.

## Array player v2: feedback-wire fix

The user's re-export retained all arrays and components, but omitted exactly
the six `Exec_Var_Set.ExecOut -> Exec_Var_Increment.Exec` wires used to advance
voices at note-off. These immediate feedback paths are now deferred through
one-tick buffers, a pattern supported by the supplied world's existing logic.
Before buffering, an explicit setter clears the loaded flag so the old note
cannot retrigger during the delay. Each emitter still has one Play and one
Stop source. The corrected build has 220 bricks, 222 components and 343 wires.

Checks confirm six buffers and six buffered increment inputs. A scheduling
model including the extra tick dispatched all notes before auto-stop at both
30 and 60 Hz (maximum modeled onset lateness 50 ms / 16.7 ms). These are model
results; the new wiring still needs an actual in-game connection test.

Rebuild after `npm ci` from this directory:

```sh
python3 inspect-midi.py /path/to/song.mid /tmp/midi-score
node build-array-music.cjs /tmp/midi-score/notes.json '/path/to/Default Pitch.brz' ../../prefabs/viva-la-vida-array-player-v3.brz
```

The exported prefab is standalone. Source MIDI and preset files are not
published. The MIDI arrangement uses the supplied OBA_Beep_1 sample, not a
recording or a piano instrument. Default pitch anchors MIDI69 to the sample's
unknown base note; the exposed master-pitch and volume variables are retained.

## Wiring diagnosis

The user's in-game re-export of v2 retained all 7,625 bricks, but only 17,235
of 19,894 wires. All 2,658 extra global-stop wires to emitter Stop inputs were
missing, as was one of two sources to the global halt setter's Exec input.
The exporter had permitted multiple sources for a single input. Every new
graph input is now restricted to one source, checked before export and again
after decoding the saved wire records. Execution unions and boolean OR gates
combine events explicitly.

## Architecture

Greedy interval partitioning assigns the 2,658 MIDI notes to six monophonic
voices, preserving overlaps across voices. Each voice has four f64 arrays:
absolute start time, end time, pitch ratio and velocity gain. A distant sentinel
entry terminates the voice safely without playing another note.

One shared clock, start-time memory and playing flag control the sequencer.
Each voice has an index, active flag and loaded flag. Reset/advance events
merge through Exec_Union; four sequential ArrayVar_Get gates load a note before
setting loaded true. A due-start condition activates the voice and triggers
its emitter. A due-end or Stop condition deactivates it, stops its emitter,
advances the index and fetches the next note. There is one Play source and one
Stop source per emitter. Pitch and velocity are multiplied by master controls.

The full prefab contains 208 bricks, 210 component instances, 24 arrays,
six emitters and 325 wires across two grids. The outer layout has 14 bricks;
the remaining circuitry is in the microchip. No synthetic preview is generated.

## Validation and limits

- Every source note is reconstructed exactly from the arrays' four columns.
- Each voice is non-overlapping by MIDI start/end times.
- Decoded arrays, emitter count, wire count and unique input endpoints match.
- The outer layout passes a positive-volume-overlap check.
- A separate polling schedule model dispatched all 2,658 notes at 30 and 60 Hz;
  maximum modeled onset rounding was about 29.2 ms and 12.5 ms respectively.
  This models scheduling, not Brickadia's graph evaluation order or load.

Click Play and release. Stop silences playback; the next Play starts from the
beginning. Holding Play during a Stop/end may restart it, so release the button.
The one-shot beep cannot sustain beyond the source sample length. Game pitch
limits, tick sequencing and actual audio playback remain unverified until an
in-game import/play test. Absolute musical tuning is still uncalibrated.
