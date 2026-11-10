# SQM1 His Theme cartridge V2

`prefabs/sqm1-his-theme-cartridge-v2.brz` retains the complete sustain-resolved
His Theme arrangement while increasing each lane's reserved release interval
from 120 ms to 200 ms. The player uses at most the first 80 ms as audible
release, leaving 120 ms of musical time to unload, read, decode and publish the
next record. At playback speed 2 that is still 60 ms of wall time.

The source MIDI, all 1,936 note onsets, velocities, pedal-resolved timing and
eight octave-folded low notes are retained. The eighteen-lane fit shortens 676
old pedal-held notes only when a later onset needs their lane, compared with
651 in V1. The score still reaches exactly 18 voices with its full reservation.

Build and validate:

```bash
python3 tools/prefabs/arrange-piano-midi-single-array.py \
  undertale-his-theme-toby-fox.mid \
  tools/prefabs/undertale-his-theme-single-quat-score-v2.json \
  --max-voices 18 --release-tail 0.20
node tools/prefabs/build-sqm1-his-theme-cartridge-v2.cjs
node tools/prefabs/test-sqm1-his-theme-cartridge-v2.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-his-theme-cartridge-v2.brz --strict
```

V1 remains unchanged for comparison.
