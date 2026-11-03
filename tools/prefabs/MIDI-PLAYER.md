# Viva La Vida — MIDI logic player

Standalone prefab derived from the user's supplied MIDI and `Default Pitch.brz`.
It uses the preset's real `OBA_Beep_1` one-shot asset. No MIDI/audio file or
original preset is included in this repository. This is a beep arrangement,
not an audio recording or a piano synthesizer.

## Use

Paste the prefab, click PLAY and release it. STOP silences all emitters and
resets the playback state. A subsequent PLAY starts from the beginning.
Playback also stops automatically after the last scheduled note. Release PLAY
before STOP; holding PLAY through a stop can retrigger it.

The two exposed variable gates are master pitch (default 1) and volume
(default 0.15). MIDI note 69 maps to the sample's default pitch, and every other
note uses the equal-tempered ratio `2^((note-69)/12)`. The sample's absolute
frequency is unknown, so this preserves intervals without claiming concert
tuning. Change master pitch if the arrangement sounds transposed.

The beep cannot sustain longer than its source sample. Note-off events stop
remaining sound, but they cannot lengthen the sample. There is no sustain-pedal
or MIDI instrument/timbre reproduction. Game tick resolution and sound-engine
pitch limits may affect the result; live behavior is not yet verified.

## Structure and checks

The MIDI contains two tracks, 2,658 notes and about 271.899 seconds at its
default 120 BPM. A continuously running stopwatch is sampled at Play into a
start-time variable. Elapsed time is compared against 1,641 shared timestamps.
Playing-state gates and explicit rising-edge gates dispatch note-on/off events.
Each MIDI note has a separate emitter, preserving same-pitch overlaps.
Pitch and velocity multipliers are shared by equal values.

The output has 7,627 component instances and 19,894 wire records across two
grids. Export validation rereads every component/wire chunk, checks all 2,658
emitters and wire counts, validates graph port directions, and checks that each
note has start/end timestamp nodes and its correct pitch ratio. This does not
test actual game execution or audio rendering.

## Rebuild

From this directory, after `npm ci`:

```sh
python3 inspect-midi.py /path/to/song.mid /tmp/midi-score
node build-midi-player.cjs /tmp/midi-score/notes.json '/path/to/Default Pitch.brz' ../../prefabs/viva-la-vida-midi-player.brz
```

The source MIDI and preset are required only for generation. The exported
prefab has its score, logic and sound reference embedded for standalone use.
