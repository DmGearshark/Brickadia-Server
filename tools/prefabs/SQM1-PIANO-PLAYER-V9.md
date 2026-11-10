# SQM1 Piano headroom V9

`prefabs/sqm1-auto-zone-music-player-ui-piano-v9-headroom.brz` keeps the exact
24-lane V8 player and adds one shared Piano-only gain stage. The visible volume
control remains `1.0..2.0`, but Piano maps it to an internal `0.35..0.70`:

```text
internalPianoGain = visibleVolume * 0.35
```

The selected hard-strike envelope was originally auditioned at gain `0.35`.
The finished player later exposed raw gain `1..2`; a maximum-velocity Piano
attack can peak at `1.3` before that master, making a single note reach `1.3`
at volume 1 or `2.6` at volume 2. Chords can therefore overload Brickadia's
mix or limiter even in slow and sparse passages. V9 makes volume 1 the clean
audition reference and leaves volume 2 as a louder `0.70` option.

The scale feeds only the 24 Piano body-envelope masters. Non-Piano profile
targets still bypass those masters through their exact legacy paths. V8's
24-source Piano ceiling, score validation, release mask, lane scheduler,
automatic cartridge intake, controls, spatial settings, assets, geometry and
visible UI are unchanged.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v9.cjs
node tools/prefabs/test-sqm1-piano-player-v9.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v9-headroom.brz --strict
```

Runtime acceptance should use the unchanged His Theme V3 cartridge at visible
volume 1 first. Compare sustained chords and sparse hard notes against V8.
Volume 2 remains available if the clean reference is quieter than desired.
