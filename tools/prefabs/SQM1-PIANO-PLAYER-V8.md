# SQM1 24-lane protected Piano V8

`prefabs/sqm1-auto-zone-music-player-ui-piano-v8-24.brz` keeps the exact
visible UI from `tools/prefabs/sources/sqm1-working-as-intended-ui.brz` and
replaces its internal player and DecodeNote grids with a freshly generated
24-lane scheduler. The extra six lanes reduce allocator pressure in dense
scores such as the final sheet of *His Theme*, where the older 18-lane player
could shorten held left-hand notes while newer right-hand notes arrived.

The V7 Piano voice remains one continuously decaying Sine body per lane. A
Piano score therefore requests at most 24 simultaneous sources. The physical
H2 and H3 emitters remain in every lane so the six other instrument profiles
retain their established timbres. V8 applies this source budget from the
loaded score's declared voice count:

```text
Piano, any supported score:        body only       (at most 24 sources)
non-Piano, 1..18 encoded voices:   body + H2 + H3  (at most 54 sources)
non-Piano, 19..24 encoded voices:  body + H2       (at most 48 sources)
```

Thus every existing score with at most 18 encoded voices keeps the exact
non-Piano three-layer behavior. Denser scores sacrifice only H3; H2 and every
fundamental remain available, and the enabled-source ceiling stays below the
engine's 64-sound limit. The score data and cartridges do not need a new
format. The format-1 header already reserves 32 voice records; this player
accepts 1 through 24 active records and requires the unused records to retain
their normal sentinel values.

V8 preserves V7's bass-aware attack, V6 continuous decay, V5 exact-zero
release mask and 50 ms silent post-roll. Automatic cartridge intake,
transport and instrument controls, speaker controls, text displays, root
buttons, profile chip, assets, and shell geometry are preserved. The builder
asserts the root UI brick/component data against the source shell before
returning the artifact.

The final graph has 7,709 bricks, 12,920 wires, 7,717 components, 72 physical
Sine emitters and 72 Dampens. The 25 V8 policy gates are one shared
`voiceCount <= 18` comparison plus one H3 enable gate per lane.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v8.cjs
node tools/prefabs/test-sqm1-piano-player-v8.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v8-24.brz --strict
```

Runtime acceptance should load the V3 *His Theme* cartridge, select Piano,
and play the final sheet at speeds 1 and 2. Listen for the left-hand bass and
chords continuing beneath the right-hand figure, distinct new attacks, and a
tail that keeps fading rather than becoming a constant hum. Then select a
non-Piano profile with an 18-voice cartridge and confirm its familiar
three-layer timbre.
