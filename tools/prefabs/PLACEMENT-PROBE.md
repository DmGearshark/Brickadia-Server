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
