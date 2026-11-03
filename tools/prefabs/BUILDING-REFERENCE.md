# Brickadia building reference

Derived from the user's working `car.brz`, `Smallest-build-grid.brz`, and their
explanation of the editor's units. Uploaded reference binaries stay local.

## Units and geometry

- Editor placement grid: 0.1, as specified by the user.
- Minimum microbrick full side length: 0.2, as specified by the user.
- The grid sample contains 179 `PB_DefaultMicroBrick` bricks and five
  `PB_DefaultMicroWedge` bricks. All decode with size `[1,1,1]`.
- The saved size is a half-extent: `[1,1,1]` describes a full span of two saved
  coordinate units per axis. Thus one coordinate unit corresponds to 0.1 in
  the user's editor scale; full side length is `2 * saved_size * 0.1`.
- Sample centers contain both one-unit and two-unit steps. Placement is not
  limited to the two-unit full width of a minimum microbrick.
- Apply direction and rotation before checking dimensions in world axes.
- Axis-aligned box intersection is exact for axis-aligned cuboids, but only a
  broad-phase check for ramps, wedges, poles, seats and other shaped assets.
  Do not label the working car as overlapping merely because enclosing boxes
  intersect. Wedges require shape-aware treatment.
- Touching faces have zero overlap volume. Do not intersect solid trim with
  panels; tile a stripe into the panel, or put it wholly outside the surface.

## Working car

The re-uploaded car is byte-identical to the original reference. It contains
189 bricks: 74 in the main grid, four 28-brick wheel grids, and a three-brick
hinged rear-deck grid. There are nine entities.

Preserve the working mechanical geometry and its clearance until native asset
dimensions are measured. The grid sample calibrates units, not seat or engine
collision dimensions. Do not treat estimated asset bounds as verified.

When designing a new exterior, use the original's panel placement, slopes,
seams and wheel clearance as an assembly reference. Maintain explicit local,
grid and entity coordinate transforms. Do not change physics joints or brick
indices merely to make exterior construction easier.

## Evidence from failed roadsters

The v2 re-export retained 19/74 main-grid bricks. All 52 rejected new body
bricks had positive-volume cuboid intersections. The v3 re-export retained
67/74; the remaining omissions were five cockpit panels and both seats.
These observations support the overlap diagnosis but do not measure native
asset collision meshes. V4's in-game result remains unconfirmed.

Before another full-car iteration, validate a small panel assembly against
the working chassis and verify an import/re-export. File readback alone is
not evidence that the game accepts the geometry.
