# SQM1 His Theme cartridge V3

`prefabs/sqm1-his-theme-cartridge-v3.brz` contains all 1,936 note onsets from
the supplied *His Theme* MIDI for the 24-lane SQM1 player. It retains the V2
200 ms lane reservation, leaving 120 ms of musical-time decoder margin after
the player's 80 ms audible release.

The additional six lanes reduce shortened pedal-held notes from 676 to 358
and reduce removed sustain time from 540.851708982 to 216.100795475 seconds.
Every onset, pitch, velocity, source identity and octave-folded bass note is
unchanged. The score reaches 24 simultaneous reserved voices, so it requires
the matching 24-lane player and should not be loaded into the 18-lane V7
player.

`prefabs/sqm1-his-theme-finale-test-cartridge-v2.brz` is the matching
58.299-second acceptance excerpt beginning on measure 97. It preserves all
508 selected V3 notes and has no arranger-induced early endings during the
final 13 seconds.

Build and validate:

```bash
python3 tools/prefabs/arrange-piano-midi-single-array.py \
  undertale-his-theme-toby-fox.mid \
  tools/prefabs/undertale-his-theme-single-quat-score-v3.json \
  --max-voices 24 --release-tail 0.20
node tools/prefabs/build-sqm1-his-theme-cartridge-v3.cjs
node tools/prefabs/test-sqm1-his-theme-cartridge-v3.cjs
node tools/prefabs/build-sqm1-his-theme-finale-test-cartridge-v2.cjs
node tools/prefabs/test-sqm1-his-theme-finale-test-cartridge-v2.cjs
```

V1 and V2 remain unchanged for the 18-lane players.
