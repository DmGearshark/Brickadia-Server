# Tide R-20 Roadster

Original teal open-top body with silver center stripe, low windshield, rear
roll hoop, front grille, side mirrors, hood vents, rear light bar and dual
exhaust tips. Uses the supplied car's wheels, seat positions, engine, suspension,
steering and hinged rear-deck mechanism as its mechanical base.

Rebuild from this directory after `npm ci`:

```sh
node build-roadster.cjs references/car.brz ../../prefabs/tide-r20-roadster.brz
```

The generator replaces 63 exterior bricks without reordering the chunk's brick
indices. It preserves component and wire payloads, entity payloads and wheel
sub-grids byte-for-byte. The existing rear deck is recolored teal and the two
front lamp faces are recolored white. Prefab bounds expand for the mirrors.
The old car thumbnail is omitted.

Validation rereads all authored positions, sizes and colors; checks the retained
mechanical bricks and entity records; and compares every unmodified archive
entry against the reference. The result retains 189 bricks, six grids and nine
entities. These checks do not simulate collisions or vehicle physics.

In-game checks still required: paste orientation, appearance, seat access,
acceleration, braking, steering, wheel clearance through suspension travel,
and hinged deck clearance. Vehicle handling has not been tuned for the new body.
