# SQM1 automatic 18-voice music player V2

V2 keeps the live-proven V1 zone/request/copy/acknowledgment/deletion path and
expands the retained player from two playback lanes to eighteen. It accepts the
complete Viva La Vida piano-and-violin score without reducing chords or notes.

## Files

- Player: `prefabs/sqm1-auto-zone-music-player-frame-v2.brz`
- Viva cartridge: `prefabs/sqm1-viva-la-vida-cartridge-v1.brz`
- Small regression cartridge: `prefabs/sqm1-auto-zone-test-cartridge-v2.brz`
- Frame builder: `tools/prefabs/build-sqm1-auto-zone-frame-integration-v2.cjs`
- Player core: `tools/prefabs/build-sqm1-wireless-sine-player-integration-v5.cjs`
- Viva cartridge builder: `tools/prefabs/build-sqm1-viva-la-vida-cartridge-v1.cjs`

## Viva score

The cartridge stores the canonical conversion of the supplied MIDI in one
Quaternion array:

- 3,430 notes;
- 3,464 Quaternion records;
- 18 release-safe lanes: sixteen piano and two violin;
- 239.998867144 seconds;
- MIDI range 32 through 80;
- source MIDI SHA-256
  `a4f6ac10e617b39d89ff478ff1c6b88aabd08d561e592d5d30486112f54c2e06`.

The player copies the remote array into staging, validates all 34 header
records, copies the validated score into its own active array, acknowledges the
commit, and only then removes the PrefabSpawner root. The cartridge can be gone
while the retained song plays.

V5 accepts format-1 scores with one through eighteen active lanes and at most
65,536 Quaternion records. Header slots 20 through 33 must remain exact unused
sentinels, so a cartridge cannot hide lanes the player does not implement.

## Playback and controls

Every lane has a continuous Sine fundamental and two profile-controlled Sine
harmonics. Auto mode reads each committed lane's General MIDI program; the
frame can also force Piano, Bell, Organ, Strings, Bass, Flute or Synth.

Play, Stop, Speed, Pitch and Volume remain on the frame and on its outer chip.
The Volume buttons and exposed positive override clamp to `0.01..2.0`; zero or
an unwired input keeps the retained button value.

Each score lane reserves a release tail before its next note. Playback uses at
most the first 80 ms as audible release and spends the remaining reservation
loading and decoding the next record. Natural song completion still includes
the complete committed tail.

## Use

1. Paste the V2 player.
2. Create the Viva cartridge with a Prefab Spawner and move or spawn it into
   the intake zone.
3. Wait for the title and `Ready` status. The spawned cartridge disappears only
   after the complete score has committed.
4. Press Play.

The generated graphs pass deterministic score checks, strict placement,
unique-input wiring, complete header validation, continuous-emitter checks and
the V1 transport/deletion topology checks. Copying 3,464 records and full-song
timing still require the first in-game test; the earlier live result covered the
same transaction with the 46-record regression cartridge.

```sh
node tools/prefabs/build-sqm1-auto-zone-frame-integration-v2.cjs
node tools/prefabs/build-sqm1-viva-la-vida-cartridge-v1.cjs
node tools/prefabs/test-sqm1-viva-la-vida-cartridge-v1.cjs
```
