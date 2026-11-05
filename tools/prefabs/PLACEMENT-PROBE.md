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
