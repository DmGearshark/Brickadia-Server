# SQM1 auto-zone frame integration V1

This installs the proven SQM1 V4 two-voice player in the supplied frame and
turns its separate shell into an automatic test cartridge.

## Files

- Player: `prefabs/sqm1-auto-zone-music-player-frame-v1.brz`
- Cartridge: `prefabs/sqm1-auto-zone-test-cartridge-v1.brz`
- Builder: `tools/prefabs/build-sqm1-auto-zone-frame-integration-v1.cjs`
- Structural test: `tools/prefabs/test-sqm1-auto-zone-frame-integration-v1.cjs`
- Preserved source shell: `tools/prefabs/sources/music-player-frame-and-cartridge.brz`

The original V4 and V1 files remain unchanged.

## Automatic intake

The existing frame zone detects entities and snapshots the exact entrant for
one tick. It sends only that entity an object-targeted `SQM1.Request` with a
random transaction nonce. An unrelated entity has no compatible object receiver
and is retained when the request times out after two seconds. The cartridge's
Request and Ack receivers are object-scoped. Its Offer remains global so the
live-proven same-callback `ArrayVarRef -> CopyFrom` path is preserved.

The visible cartridge plate and its chip are on the cartridge prefab's global
physics grid. Prefab Spawner therefore returns the same root entity that enters
the zone, receives the request and is passed to `DestroySpawnedPrefab`. This
corrects the earlier child-entity layout, which loaded successfully but could
not delete the complete cartridge prefab.

The cartridge offers automatically one tick after accepting a request. The
player consumes it only after staging validation, ActiveScore commit validation
and a targeted success acknowledgment. Failed loads are retained.

Keep the player and cartridge as separate prefabs. They are emitted separately
so prefab-level deletion consumes only the cartridge spawn.

## Controls and instruments

- Play and Stop drive transport.
- Speed changes by `0.1` in `0.25..2`.
- Pitch changes by one equal-tempered semitone in `0.5..2`.
- Volume changes by `0.01` in `0.01..0.2`.
- The two music-note panels select Auto, Piano, Bell, Organ, Strings, Bass,
  Flute or Synth.

All profiles use continuous Sine emitters. Each of the two proven V4 voices has
its fundamental plus two profile-controlled Sine layers. Profiles change
harmonic ratios, harmonic gains and envelope smoothing. Auto derives Piano,
Organ, Bass, Strings, Flute or Synth from each score lane's General MIDI program
family. These are compact Sine interpretations, not sampled GM instruments.

Song Name displays the committed title. Status displays the load/play state,
instrument, volume, speed and pitch.

The outer frame chip exposes Play, Stop, Pitch, Speed and Volume inputs, plus
Loaded, Playing, Song Title and Status outputs. A positive numeric input
overrides the retained button value; zero leaves the button value active.

## Current score boundary

V1 preserves V4's exact validator and two-voice scheduler. The included
cartridge is the known 46-Quaternion, twelve-note test score. Arbitrary MIDI
cartridges still require the planned generic validator and fixed multi-voice
engine; merely replacing this cartridge's array will be rejected.

## Test

1. Paste the player.
2. Spawn the cartridge separately with a Prefab Spawner and move it into the
   intake zone.
3. Watch `Listening`, `Loading`, then `Ready`; confirm the cartridge disappears
   only after Ready.
4. Play the complete eight-second duet twice and try Stop and all controls.
5. Use the music-note panels to compare the eight instrument modes.

The generated pair passes strict placement and saved-graph structural checks.
The new automatic zone and consumption path still needs its first live test.

```sh
node tools/prefabs/build-sqm1-auto-zone-frame-integration-v1.cjs
```
