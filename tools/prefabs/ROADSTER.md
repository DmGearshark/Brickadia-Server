# Tide R-20 Roadster

Original teal open-top body with silver center stripe, low windshield, rear
roll hoop, front grille, side mirrors, hood vents, rear light bar and dual
exhaust tips. Uses the supplied car's wheels, seat positions, engine, suspension,
steering and hinged rear-deck mechanism as its mechanical base.

Rebuild from this directory after `npm ci`:

```sh
node build-roadster.cjs references/car.brz ../../prefabs/tide-r20-roadster-v4.brz
```

The generator replaces 63 exterior bricks without reordering the chunk's brick
indices. It preserves component and wire payloads, entity payloads and wheel
sub-grids byte-for-byte. The existing rear deck is recolored teal and the two
front lamp faces are recolored white. Prefab bounds expand for the mirrors.
The old car thumbnail is omitted.

Versions 1 and 2 failed the in-game test. Comparing the v2 output with the user's
in-game re-export found only 19 of 74 main-grid bricks remained. All 52 rejected
new body boxes overlapped another body box; 10 of 11 retained new body boxes
did not overlap another body box. This strongly implicates intersecting solids,
not merely disconnected geometry. The headlights and engine also disappeared.

Version 3 tiles adjoining panels by face contact. Stripe and body panels share
a plane without occupying the same volume. It checks all body pairs for strict
positive-volume overlap, checks approximate mechanical clearance envelopes,
and requires every new body box to reach the chassis by contact. Mechanical
envelopes approximate native asset geometry; they are not exact mesh checks.
The v3 in-game re-export retained 67 of 74 main-grid bricks: only body indices
0, 1, 2, 4, 5 and both seats were lost. It retained the lamps and engine, which
v2 had lost. The remaining rejects surround the cockpit, indicating that the
previous seat envelope was too small.

V4 changes only those five body bricks. Lower side supports use space below
Z=-8 alongside the original chassis; outer walls start at |X|=21. The center
floor becomes a forward crossmember, clear of the engine. The seat clearance
envelope is expanded to half-extents [10,15,11]. These are conservative bounds,
not measured seat mesh dimensions. All other main-grid bricks remain identical
to v3. The in-game result for v4 is pending.

To reproduce the comparison (the in-game export is not published):

```sh
node compare-car.cjs ../../prefabs/tide-r20-roadster-v2.brz '/path/to/Broken Car.brz'
```

The source `references/car.brz` stays local and is not included in the repository.

Validation rereads all authored positions, sizes and colors; checks the retained
mechanical bricks and entity records; and compares every unmodified archive
entry against the reference. The result retains 189 bricks, six grids and nine
entities. These checks do not simulate collisions or vehicle physics.

In-game checks still required: paste orientation, appearance, seat access,
acceleration, braking, steering, wheel clearance through suspension travel,
and hinged deck clearance. Vehicle handling has not been tuned for the new body.
