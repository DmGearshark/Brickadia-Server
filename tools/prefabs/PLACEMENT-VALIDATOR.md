# Placement preflight validator

Run before publishing a generated prefab:

```sh
node tools/prefabs/validate-placement.cjs prefab.brz
```

The command exits unsuccessfully for confirmed overlaps between box-shaped
bricks and decoded convex ramps. `--strict` also rejects envelope overlaps
involving assets whose exact collision mesh is still unknown.

The validator uses the orientation rules verified by Placement Probe 2 and a
CC0, reflection-derived native asset catalogue from
[`brickadia-community/brdb`](https://github.com/brickadia-community/brdb).
Procedural brick sizes come from the prefab itself. Exact face contact is
accepted; positive-volume intersection is reported. Connected overlap groups
are included because Brickadia removes the complete connected group during
clipboard placement.

Standard procedural bricks, ramps, wedges, tiles, and arches use construction
grid rules recovered from Brickadia's cooked procedural assets: X/Y
half-extents use 5-unit increments and Z half-extents use 2-unit increments.
Micro-bricks retain their 1-unit grid. All six Brickadia directions remain
valid. Violations are reported in `invalidBricks`; they can make a connected
assembly disappear even when its bounding boxes do not overlap.

Ramp/box and ramp/ramp intersections use convex separating-axis tests, so
empty space above a slope no longer counts as an overlap. Curved and non-convex
assets remain reported separately because their solid volume can occupy less
than their oriented bounding envelope.
