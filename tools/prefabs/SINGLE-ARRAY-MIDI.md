# Single-array MIDI sine player

This system converts a Standard MIDI File into one native Brickadia `Quat`
`ArrayVar`, then builds a self-contained player around it. Every audible voice
uses the continuous `BA_Synth_Basic_Sine` descriptor. It does not use one-shot
audio.

## Build a song

From the repository root:

```bash
python3 tools/prefabs/convert-midi-single-array.py \
  song.mid /tmp/song-single-quat-score.json \
  --max-voices 32 --release-tail 0.2 --compact

node tools/prefabs/build-single-quat-midi-player.cjs \
  /tmp/song-single-quat-score.json \
  prefabs/song-single-array-sine-player.brz
```

The converter fails instead of silently stealing a held note. It also fails on
pitches outside the sine emitter's usable MIDI range, 30 through 108. Pass
`--drop-out-of-range` only when discarding those notes is intentional.

`--release-tail` reserves a physical voice after key-off so its volume can fade
without being repitched for the next note. The true key-off time remains in the
array.

## Array format

The prefab contains exactly one score array. A quaternion is used as a native
four-number record, so one `ArrayVar Get` and one `Split Quaternion` read a
complete note.

| Array element | X | Y | Z | W |
| --- | --- | --- | --- | --- |
| `q0` | magic `7701001` | format version | active voice count | duration in seconds |
| `q1` | header length | release tail in seconds | score minimum MIDI note | score maximum MIDI note |
| `q2..q33` | absolute note offset | note count | instrument code | channel + 16 x track |
| `q34+` | start seconds | true key-off seconds | MIDI note | velocity |

Each voice owns a contiguous, non-overlapping segment of the same array and an
independent cursor. This is why simultaneous chord notes start in parallel;
one chronological cursor would spread a chord across several logic ticks.

The instrument code is the General MIDI program captured at note-on. Channel
10 uses program + 128. Keeping this metadata in the array allows later players
to choose different synthesis without reconverting the MIDI.

## Sine voice

`Component_AudioEmitter` is a continuous source. Its `bEnabled` input is driven
by the loaded note's time window and the player's running state. Its pitch is:

```text
2 ^ ((midiNote - 69) / 12) * masterPitch
```

Velocity uses `(velocity / 127) ^ 1.4`. A `Dampen` gate gives the note a short
attack and release, and piano-program voices add a decaying body. Piano program
0 uses three continuous sine layers: two slightly detuned fundamentals and a
quiet, faster-decaying stretched octave. Other programs still use the same sine
descriptor, with one sustained layer. The included player therefore remains
all-sine while retaining the MIDI's program data.

The exposed defaults are master pitch `1`, master volume `0.06`, and playback
speed `1`. `PLAY` always restarts from the beginning; `STOP` mutes immediately.

## MIDI handling

The converter supports format 0 and format 1 files, PPQ and SMPTE timing,
tempo maps, running status, overlapping copies of the same pitch, global MIDI
channel programs across tracks, sustain pedal CC64, All Sound Off CC120, Reset
All Controllers CC121, and All Notes Off/channel-mode controllers CC123-127.
Same-tick events retain their source order within a track; ties between tracks
follow file track order.

This first version does not synthesize pitch bend, aftertouch, CC7/CC11 volume
automation, bank selection, or format 2 sequences. It has a 32-voice limit and
does not perform voice stealing.

## Included Viva La Vida build

The user-supplied piano/violin arrangement produced:

- 3,430 notes and 239.998867 seconds
- MIDI range 32 through 80, with no dropped notes
- 9 simultaneous key-down notes
- 18 allocated voices with a 0.2-second release reservation
- one array containing 3,464 quaternions
- 50 continuous sine emitters and zero one-shot emitters
- 1,367 components and 2,107 uniquely driven wires

The source MIDI SHA-256 is
`a4f6ac10e617b39d89ff478ff1c6b88aabd08d561e592d5d30486112f54c2e06`.
The generated prefab SHA-256 is
`ea6bf3a0e1080e3d9b89e65135d48f050cfa790b074af9c2d9222db0cde93a40`.

The committed source MIDI is intentionally omitted; the canonical converted
array is `viva-la-vida-single-quat-score.json`, and the built artifact is
`prefabs/viva-la-vida-single-array-sine-player.brz`.

## Verification

```bash
python3 tools/prefabs/test-convert-midi-single-array.py
node tools/prefabs/test-single-quat-midi-player.cjs
node tools/prefabs/build-single-quat-midi-player.cjs \
  tools/prefabs/viva-la-vida-single-quat-score.json \
  /tmp/viva-la-vida-single-array-sine-player.brz
```

The builder rereads the saved prefab and verifies the exact array, one shared
array source, one getter per voice, continuous sine descriptor resolution,
zero one-shot emitters, unique input drivers, legal pitch multipliers, buffered
voice advancement, and strict brick placement. Perceived envelope quality and
overall loudness still require an in-game listen because the save tooling does
not execute Brickadia audio.
