# SQM1 balanced instrument-family player V11

`outputs/sqm1-music-player-v11-balanced-instruments-saxophone.brz` preserves
the approved V10.3 Dynamic Hammer Piano path and revises the alternate
instrument profiles that previously bypassed Piano's headroom work.

## Modes

The selector now cycles through nine modes:

```text
Auto, Piano, Bell, Organ, Strings, Bass, Flute, Synth, Saxophone
```

Saxophone is mode `8`. In Auto mode, General MIDI reed programs `64..71` map
to Saxophone. Existing Auto mappings remain unchanged; program `0` therefore
still resolves to Piano for converter-produced piano cartridges.

## Alternate-instrument gain and timbre

Bell, Organ, Strings, Bass, Flute and Synth previously retained their early
three-Sine profiles at the later UI's raw `1..2` master-volume range. Piano
alone received fixed headroom and an adaptive limiter, which made the other
modes much louder.

V11 keeps the existing three emitters per lane but gives each family a tuned
attack smoothing value, harmonic balance and solo headroom. Saxophone uses a
fundamental with moderate second and third harmonics. Non-Piano amplitudes are
measured before limiting across all 24 lanes and three layers. The limiter:

```text
scale = min(1, (0.65 * sqrt(2)) / sqrt(sum(layerAmplitude^2)))
```

Attenuation is immediate. Recovery is smoothed over `120 ms`. The modeled
dense RMS ceiling for the combined non-Piano subtotal is therefore `0.65`,
while sparse notes retain each profile's normal headroom. Piano remains on its
independent V10.3 limiter and signal path and is intentionally outside this
subtotal. Its unused legacy branch is forced to zero, so Piano voices cannot
falsely attenuate other instruments in mixed-program Auto songs.

V8's source policy is unchanged: songs using up to 18 lanes can enable at most
54 sources, while 19-to-24-lane songs disable H3 and enable at most 48. V11
adds no emitters or audio assets.

## Build and validate

To patch a returned player while preserving its retained cartridge data:

```bash
node tools/prefabs/build-sqm1-instrument-family-player-v11.cjs \
  '/path/to/Latest Music Player.brz' \
  outputs/sqm1-music-player-v11-balanced-instruments-saxophone.brz
node tools/prefabs/test-sqm1-instrument-family-player-v11.cjs \
  '/path/to/Latest Music Player.brz'
node tools/prefabs/validate-placement.cjs \
  outputs/sqm1-music-player-v11-balanced-instruments-saxophone.brz --strict
```

Automated checks cover selector range and labels, profile constants, Auto reed
mapping, retained score arrays, emitter/source budgets, wire validity, limiter
bounds and deterministic serialization. Timbre and perceived-loudness balance
still require an in-game listening pass because Brickadia's mixer is the final
authority.
