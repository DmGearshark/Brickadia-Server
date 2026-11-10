# SQM1 single-source Piano V7

`prefabs/sqm1-auto-zone-music-player-ui-piano-v7.brz` keeps the complete V6
player but enables only the fundamental emitter for each active Piano lane.
The H2 and H3 emitters remain present for the six non-Piano profiles, whose
enable, volume, and pitch paths are unchanged. Piano therefore requests at
most 18 simultaneous sources instead of 54, preserving every fundamental in
the dense final sheet of *His Theme*.

The removed Piano partial loudness becomes a short attack in the fundamental.
Each lane also reads its raw note pitch ratio `p` to give lower notes a longer,
continuously decaying body. For note age `t`, shaped velocity `s`, and
brightness `b`:

```text
bass     = clamp((0.75 - p) * 2, 0, 1)
slowGain = 0.25 + 0.05 * bass
fastGain = 1 - slowGain
slowRate = -0.5 + 0.15 * bass
base     = fastGain * exp(-4 * t) + slowGain * exp(slowRate * t)
attack   = 0.30 * b * exp(-6 * t)
body     = s * (base + attack)
```

At `bass = 0`, the body follows V6's decay while the attack closely replaces
the summed H2/H3 strike. At `bass = 1`, the slow component is 0.30 and decays
at `exp(-0.35 * t)`, retaining low-note weight without a permanent floor or an
overlong release. The implementation reuses V6's fast and slow body gates, H2
decay chain, and H2 activity Select. It adds 162 pure expression gates and no
new emitters or Dampens.

V5's exact-zero release mask, speed-scaled release smoothing, and 50 ms silent
post-roll remain unchanged. The scheduler, UI, cartridge loader, spatial
controls, and all transport behavior also remain unchanged.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v7.cjs
node tools/prefabs/test-sqm1-piano-player-v7.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v7.brz --strict
```

Runtime acceptance should use the final sheet of *His Theme* at playback
speeds 1 and 2. Confirm that all left-hand fundamentals remain audible, new
strikes stay clear, and held bass notes continue fading instead of settling
into a constant hum.
