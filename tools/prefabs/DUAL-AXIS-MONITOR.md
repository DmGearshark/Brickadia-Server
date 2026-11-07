# Verified dual-axis player monitor

The working prefab is `prefabs/independent-dual-axis-player-monitor.brz`.
It was built from the user's updated `Fresh Blank Frame.brz`, which has two
rigid bearings and explicit current-angle inputs and target-angle outputs.

Verified in Brickadia by the user:

- The lower base follows the player horizontally.
- The monitor hinge follows the player vertically.
- Base feedback uses the reversed physical bearing sign.
- Hinge feedback is `player pitch - actual monitor pitch`.
- Both axes apply 25% of the remaining error per update.
- Horizontal error is wrapped to the nearest angle in `[-180, 180)`.
- Both target angles are latched only when the player sweep hits.
- Disabling the Clock therefore holds the last target rather than spinning.
- Clock `Enabled` is intentionally left unwired for an external occupancy zone.
- The green Sweep uses radius `150`, approximately 15 blocks.

Do not add a fixed 180-degree correction, invert the display face, or derive
both axes from the final monitor grid. Those approaches were tested and caused
wrong-facing, upside-down, clipping, or oscillating behavior on this frame.

Rebuild with:

```powershell
node tools/prefabs/build-independent-dual-axis-monitor.cjs "Fresh Blank Frame.brz" "independent-dual-axis-player-monitor.brz"
```

