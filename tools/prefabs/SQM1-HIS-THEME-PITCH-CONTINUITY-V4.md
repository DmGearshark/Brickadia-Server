# SQM1 His Theme pitch-continuity cartridge V4

`prefabs/sqm1-his-theme-pitch-continuity-v4.brz` is an isolated full-song
A/B cartridge for the 24-lane SQM1 player. It tests whether buzz-like or
"frappy" transitions come from repeatedly retuning one physical Sine emitter
between distant registers.

V3 always reused the lowest-numbered free lane. V4 instead minimizes three
objectives in order: the number of shortened notes, removed sustain time, and
the pitch distance from the preceding note on the selected lane. Pitch
continuity can therefore never add another cut or remove more sustain.

The musical content and resource budget are unchanged:

```text
note onsets:                         1,936 -> 1,936
lanes:                                  24 -> 24
shortened pedal-held notes:            358 -> 358
removed sustain seconds:      216.100795475 -> 216.100795475
release reservation:                  0.20 -> 0.20 seconds
```

Only lane assignment changes:

```text
same-pitch lane reuse:                 514 -> 1,202
jumps of at least 12 semitones:        686 -> 162
jumps of at least 24 semitones:        339 -> 50
<=400 ms jumps of at least 12:         216 -> 12
<=400 ms jumps of at least 24:         111 -> 2
```

Use the same player and settings for V3 and V4. If the artifact is materially
reduced with V4, physical-emitter retuning is involved. If it sounds the same,
the next investigation should stay in the player's amplitude/enable path.

Build and validate:

```bash
python3 tools/prefabs/generate-sqm1-his-theme-pitch-continuity-v4.py
node tools/prefabs/build-sqm1-his-theme-pitch-continuity-v4.cjs
node tools/prefabs/test-sqm1-his-theme-pitch-continuity-v4.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-his-theme-pitch-continuity-v4.brz --strict
```

The generator derives the normalized source notes from the committed V3 score,
so regenerating V4 does not require the original MIDI file.
