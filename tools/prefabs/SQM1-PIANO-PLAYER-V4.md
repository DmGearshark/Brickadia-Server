# SQM1 hard-strike Piano V4

`prefabs/sqm1-auto-zone-music-player-ui-piano-v4.brz` is the optimized custom-UI
V3 player with the selected hard-strike Piano envelope added. The automatic
cartridge loader, retained song, transport, eighteen-voice scheduler, user
controls, spatial Vars, Sine emitters, and the Bell, Organ, Strings, Bass,
Flute, and Synth profiles are preserved.

For decoded velocity `v` and note age `t`, Piano uses:

```text
shaped = 0.5 * (v + sqrt(v))
brightness = 0.35 + 0.65 * shaped
body = shaped * (0.35 + 0.65 * exp(-1.6 * t))
H2 = shaped * brightness * (0.05 + 0.18 * exp(-6 * t))
H3 = shaped * brightness * (0.015 + 0.05 * exp(-8 * t))
```

The body and exact 2x/3x partials have independent `Dampen` envelopes. Attack
time is 6 ms. Body release is 70 ms and partial release is 50 ms. The age graph
only advances while that lane is both active and resolved to Piano, avoiding
continuous Exp-chain updates for idle lanes and other instruments.

The score converter reserves each lane through the score's release tail. A
repeated note that arrives while an earlier note is fading is assigned another
lane, so it begins on a fresh oscillator/envelope rather than restarting the
probe's still-decaying envelope. Static validation confirms no same-lane tail
conflicts in the Viva la Vida, Megalovania, or His Theme cartridges. Audible
acceptance should still compare equal hard repeats at speed 1 and 2 because
Brickadia's `Dampen` retains runtime state.

Build and validate:

```bash
node tools/prefabs/build-sqm1-piano-player-v4.cjs
node tools/prefabs/test-sqm1-piano-player-v4.cjs
node tools/prefabs/validate-placement.cjs \
  prefabs/sqm1-auto-zone-music-player-ui-piano-v4.brz
```

The builder first reproduces the exact optimized V3 baseline, applies the Piano
extension afterward, and returns both artifacts to the structural test. This
keeps baseline optimizer tests independent from the sound-profile extension.
