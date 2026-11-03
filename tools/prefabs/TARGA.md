# Tide Targa: reference-constrained prototype

This is deliberately a variation on the user's working car, not a replacement
claim for the original roadster design. It establishes a dependable path for
future design work after the previous roadster's placement failures.

From this directory, after `npm ci`:

```sh
node build-targa.cjs /path/to/car.brz ../../prefabs/tide-targa.brz
```

Changes:

- Teal body, cream roof rails/rear crossbar and cream hood accents.
- The center roof tile changes from saved half-size [15,25,2] to [15,5,2]
  and shifts 20 saved coordinate units toward the rear.
- This opens the center roof while keeping the reference's side rails and
  rear crossbar. The new tile is wholly contained in the original tile's
  occupied volume; it adds no new solid space.
- Existing grille bricks are recolored silver. No overlays are added.

All other brick positions, sizes, assets, orientations and collision flags
remain unchanged. All entity, component and wire archive entries are copied
byte-for-byte. The original thumbnail is omitted. The archive retains all 189
bricks and six grids; it preserves the reference's native type/size-table
structure rather than constructing a new one.

Validation checks every brick against the source, permits one geometric
change, checks exact tile containment, and compares all retained mechanics.
This proves the modification cannot introduce a new geometric intersection
relative to the source tile. It does not prove an in-game import succeeded.

Acceptance test: paste a fresh copy, confirm the open roof and both seats,
enter the driver seat, and drive/steer. Re-export if anything disappears.
The fully original roadster is still an unfinished design; this test is a
controlled step toward a reliable authoring workflow.
