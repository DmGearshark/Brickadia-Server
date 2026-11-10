# SQM1 zero-cut Piano V5

`prefabs/sqm1-auto-zone-music-player-ui-piano-v5.brz` keeps the complete V4
hard-strike Piano and changes its release boundary. Brickadia's engine-wide
parallel-sound ceiling is 64 after EA3/CL14852, according to the supplied
[SteamDB patch notes](https://steamdb.info/patchnotes/24079271/) and
[Brickadia update post](https://www.reddit.com/r/brickadia/comments/1uphqoo/brickadia_update_for_7626_cl14852/).
The player has 18 lanes with three Sine emitters each, for 54 emitters, so that
ceiling does not explain the reported cutoff by itself.

V4 used `Dampen` for the Piano body and partial releases, then disabled each
emitter at the end of its audible 80 ms tail. [`Dampen` approaches its target
asymptotically](https://github.com/Meshiest/wirescript/blob/main/docs/src/learn/motion/over-time.md),
so its output could still be audible when that Boolean boundary closed. V5
multiplies all three Piano layers by a shared, activity-gated release gain:

```text
elapsed = max(musicalTime - noteEnd, 0)
progress = clamp(elapsed / max(audibleTail, 0.001), 0, 1)
releaseGain = 1 - progress
```

The gain reaches exact zero at the musical release boundary. The Piano emitter
then remains enabled at zero volume for another 50 ms of real time before its
Boolean enable closes:

```text
silentPostEnd = noteEnd + audibleTail + 0.05 * effectiveSpeed
```

That silent post-roll prevents the last audible sample and emitter disable from
sharing the same ordinary logic update. Stop still closes the window
immediately, and loading a future note closes the old window before its onset.
Non-Piano profiles continue to use the original enable window. A separate
zero-tail path follows the note-active state, so a cartridge with no reserved
release does not extend its audible lane; every positive tail, including one
shorter than 1 ms, uses its exact duration. Piano release smoothing also scales
with playback speed:

```text
body release SmoothTime = 0.07 / effectiveSpeed
partial release SmoothTime = 0.05 / effectiveSpeed
```

The 6 ms attack, velocity shaping, held-note decay, exact 2x/3x partials, all
18 scheduler lanes, cartridge intake, retained song, transport and spatial
controls remain in place. Bell, Organ, Strings, Bass, Flute, and Synth retain
their prior profiles, giving seven selectable instruments including Piano.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v5.cjs
node tools/prefabs/test-sqm1-piano-player-v5.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v5.brz --strict
```

The structural tests establish the graph, boundary and post-roll math,
preserved profiles, placement safety, and deterministic artifact. Runtime
listening remains the acceptance test for the fast Viva la Vida passages at
playback speeds 1 and 2.
