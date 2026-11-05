# Placement preflight validator

Run before publishing a generated prefab:

```sh
node tools/prefabs/validate-placement.cjs prefab.brz
```

The command exits unsuccessfully for confirmed overlaps between box-shaped
bricks. `--strict` also rejects envelope overlaps involving wedges, ramps, or
assets whose exact collision mesh is unknown.

The validator uses the orientation rules verified by Placement Probe 2 and a
CC0, reflection-derived native asset catalogue from
[`brickadia-community/brdb`](https://github.com/brickadia-community/brdb).
Procedural brick sizes come from the prefab itself. Exact face contact is
accepted; positive-volume intersection is reported. Connected overlap groups
are included because Brickadia removes the complete connected group during
clipboard placement.

This is a preflight model rather than Brickadia engine code. Shaped assets are
reported separately because their solid volume can occupy less than their
oriented bounding envelope.
