# SQM1 lean stable Piano V10.1

`prefabs/sqm1-auto-zone-music-player-ui-piano-v10-1-lean.brz` preserves the
approved V10 Piano sound while removing runtime work that cannot affect an
audible result. V10 remains available unchanged as the reference build.

## Removed work

- The 24 decoder lanes no longer write private diagnostic counters and raw
  values that had no readers. This removes 600 bricks and skips 11 unused exec
  operations per decoded note, or about 21,296 operations over the 1,936-note
  *His Theme* V4 cartridge. The function outputs, note setters, one-tick
  validation, success/failure handling and playback timing remain in place.
- Piano's two partial emitters per lane have been disabled since V7, after the
  useful strike was folded into the single body source. V10.1 removes 48
  obsolete Piano-only partial Dampens and their unreachable synthesis tails.
  Exact-zero volume and pitch barriers remain in front of those disabled
  emitters, while every non-Piano profile retains its legacy partial paths.
- The adaptive limiter computes the same squared energy in eight native vector
  groups instead of 24 scalar squares and 23 scalar additions. Its `0.35`
  ceiling, modeled `0.70` RMS target, immediate attenuation and 120 ms recovery
  are unchanged.
- Exact common subexpressions on the hidden logic grid are shared. Only
  stateless expression gates with identical component data and identical wired
  inputs are eligible.

The combined optimization removes 1,163 bricks and 1,833 wires from V10:

| | V10 | V10.1 |
|---|---:|---:|
| Bricks | 7,838 | 6,675 |
| Wires | 13,196 | 11,363 |
| Components | 7,846 | 6,683 |
| Expression gates | 5,925 | 5,386 |
| Clock-driven pure cone | 1,644 | 1,347 |
| Execution components | 1,003 | 691 |
| Timed Dampens | 73 | 25 |
| Physical Sine emitters | 72 | 72 |

The stable 24-body Piano lifecycle, exact-zero retuning, 6 ms hidden-state
flush, audible attack/release, score, all instrument profiles, controls,
automatic cartridge intake, UI, spatial settings and geometry retain V10
behavior.

This is a logic/update optimization. The 24 continuously enabled Piano body
sources that prevent note-restart artifacts and all 72 physical emitters are
unchanged, so V10.1 does not claim to reduce the engine's audio-DSP cost.

SHA-256:

```text
476a2d385ebfa2251e4e579c3ffe6aad2a77f3e050e6fa99a16a55b168e37f40
```

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v10-1.cjs
node tools/prefabs/test-sqm1-piano-player-v10-1.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v10-1-lean.brz --strict
```

For runtime acceptance, compare V10 and V10.1 with the same cartridge, Piano,
volume and speed. The rendered sound should match; compare the game's update
load during the final dense *His Theme* passage. Also switch through the
non-Piano instruments once to confirm their retained legacy partials.
