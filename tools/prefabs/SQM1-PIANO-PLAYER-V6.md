# SQM1 pedal-decay Piano V6

`prefabs/sqm1-auto-zone-music-player-ui-piano-v6.brz` keeps the complete V5
player and replaces the Piano's held-note floors with continuous decay. This
targets the dense final sheet of *His Theme*, where many pedal-held notes could
otherwise accumulate into a steady background tone.

For note age `t` in musical seconds and V4's shaped velocity and brightness,
the three Piano layers are:

```text
body = shaped * (0.75 * exp(-4 * t) + 0.25 * exp(-0.5 * t))
H2   = shaped * brightness * (0.23  * exp(-6 * t))
H3   = shaped * brightness * (0.065 * exp(-8 * t))
```

At `t = 0` their multipliers are exactly `1`, `0.23`, and `0.065`, preserving
V5's hard strike. The body keeps a quieter slow tail while both partials now
fall to zero instead of reaching a fixed floor. The patch reuses V4's body
curve and partial decay gates: it adds 54 pure expression gates, removes the
36 obsolete partial-floor Adds, and therefore costs 18 net gates.

V5's exact-zero release mask, speed-scaled smoothing, and 50 ms silent
post-roll remain unchanged. The scheduler, UI, cartridge loader, spatial
controls, three Sine emitters per lane, and every non-Piano profile also remain
unchanged.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v6.cjs
node tools/prefabs/test-sqm1-piano-player-v6.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v6.brz --strict
```

The structural tests establish the exact graph, onset amplitudes, decay math,
preserved V5 behavior, placement safety, and deterministic artifact. Runtime
acceptance should use the dense final sheet of *His Theme* at playback speeds
1 and 2, listening for distinct new strikes and a background that continues to
decay instead of becoming a constant hum.
