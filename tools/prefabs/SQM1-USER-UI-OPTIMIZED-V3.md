# SQM1 custom-UI optimized player V3

This build patches the user's `Working as intended..brz` directly. It preserves
the swapped Play/Stop and instrument controls, resized title text, complete
retained Viva La Vida score, loaded state and visible frame geometry.

## Files

- Preserved source: `tools/prefabs/sources/sqm1-working-as-intended-ui.brz`
- Optimized player: `prefabs/sqm1-auto-zone-music-player-ui-optimized-v3.brz`
- Builder: `tools/prefabs/patch-sqm1-user-player-controls-v1.cjs`
- Runtime optimizer: `tools/prefabs/optimize-sqm1-player-v2.cjs`

## Controls

- Volume uses additive `0.1` steps and clamps to `1..2`.
- Pitch uses additive `0.1` steps and clamps to `0.25..2`.
- Speed uses additive `0.1` steps and clamps to `0.1..2`.
- The exposed Volume, Pitch and Speed overrides use the same clamps. Zero or
  an unwired input continues to select the retained button value.
- Retained starting values are Volume `2`, Pitch `1` and Speed `1`.

The first row inside the main player logic chip reuses the old, disconnected
input-gate positions. Three editable Vars control all 54 Sine emitters:

- `SQM1CFG:Inner Radius`: `400` -> `InnerRadius`
- `SQM1CFG:Max Distance`: `4000` -> `MaxDistance`
- `SQM1CFG:Directional`: `false` -> `bSpatialization`

## Runtime optimization

The playback Stopwatch is saved paused. A valid edge from the retained Playing
state resumes it when playback begins and pauses it again when playback stops.
This prevents the musical-time graph and its 18 scheduler lanes from updating
while the player is idle.

The optimizer removes side-only note counters, out-of-bounds snapshots, enable
edge counters, detached diagnostic expressions, two superseded inner outputs
and hidden development markers. It keeps the proven FunctionCall decoding
sequence, staging and active validation, automatic cartridge transaction,
delete-after-commit behavior, all 18 schedulers and all 54 emitters.

- Before new controls: 5,142 bricks and 8,191 wires
- With requested control wiring: 5,142 bricks and 8,355 wires
- Final optimized graph: 4,847 bricks and 7,975 wires
- Components after controls: 5,703 -> 4,855

The saved graph passes deterministic rebuild, exact root-UI comparison,
retained-array comparison, strict placement, valid-port, unique-target,
transport and eighteen-voice playback checks. The optimized clock and stripped
diagnostics still need their first in-game test.

```sh
node tools/prefabs/patch-sqm1-user-player-controls-v1.cjs
node tools/prefabs/test-optimize-sqm1-player-v2.cjs
```
