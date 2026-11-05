# Brick placement probe

`build-placement-probe.cjs` creates isolated two-brick cases for face contact,
overlap depth, rotation, direction, containment, thin parts, and a gate asset.
The blue base is serialized first and the orange probe second. Each carries
hidden tags with its test ID, while the visible label sits outside the tested
collision volume.

Paste the prefab once in an empty area, copy the entire placed result, save it
as a prefab, and return that `.brz`. Analyze it with:

```sh
node tools/prefabs/analyze-placement-probe.cjs returned.brz
```

The returned file is authoritative. The paste summary alone gives totals but
cannot identify which specific collision cases Brickadia rejected.

## First observed result (2026-11-05)

Brickadia placed 94 bricks and rejected 48 bricks. The analyzer identified 23
accepted cases and 24 rejected cases. In every rejected case it removed both
the blue base and orange probe, rather than keeping the first serialized brick.
The corresponding 48 invalid components were the disabled test-ID text decals
attached to those rejected bricks.

Measured behavior:

- Two half-size-10 cubes accept center separation 20 and reject 19.
- Two half-thickness-1 plates accept center separation 2 and reject 1.
- A half-size-12 cube and half-size-2 cube accept separation 14 and reject 13.
- A 90-degree rotated `[10,2,2]` bar uses an X half-extent of 2: separation 12
  from the unrotated bar is accepted, while separation 8 is rejected.
- Full containment and coincident placement are rejected.
- Exact face contact is accepted on both horizontal and vertical axes.

These results establish strict positive-volume intersection as the rejection
condition for resized default microbricks. They also show that rotation changes
the effective extents used by placement validation.

## Second observed result (2026-11-05)

Probe 2 placed 259 bricks and rejected 117. All 117 invalid components were
the disabled test-ID decals attached to rejected bricks.

Additional measured behavior:

- The 24 orientation transforms in `brick-shapes.cjs` match the game. Local
  half-extents `[10,4,2]` rotate into the expected grid axes for every tested
  direction and rotation family.
- `B_1x1_Gate_Variable`, `B_1x1_Gate_Exec_Branch`, `B_Button_Square`, and the
  `B_1x1_Microchip` shell all have an X half-extent of 5. Against a half-size-1
  cube, separation 6 is accepted and separation 4 is rejected. This agrees
  with the reflection-derived basic-asset table in `brickadia-community/brdb`.
- Odd and even procedural half-extents use the exact integer boundary:
  separations `1+1`, `1+2`, `2+3`, `3+5`, and `5+7` all place; reducing any
  separation by one grid unit rejects the pair.
- Wedges and ramps use shaped collision, not their full axis-aligned envelope.
  The empty corner of the default wedge/ramp accepted a tiny cube while solid
  sample points rejected the pair. Micro-wedge empty-space results differ by
  corner, confirming that asset-specific shape/orientation matters.
- Collision rejection propagates through the connected overlap graph. For a
  chain where A overlaps B and B overlaps C, all three bricks disappear. When
  A overlaps B and C is distant, A and B disappear while C survives. Three
  bricks with exact face contact all survive.

Practical validator rule: construct an overlap graph using oriented native or
procedural bounds and reject every connected component containing a confirmed
solid intersection. Exact face contact is valid and must not create an edge.
