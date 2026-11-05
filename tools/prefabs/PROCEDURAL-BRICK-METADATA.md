# Procedural brick metadata

The procedural grid rules and catalog presets in `procedural-brick-metadata.json`
come from Brickadia's cooked 2026-10-19 IoStore assets. The supplied UTOC was
used to locate the relevant UCAS blocks; the blocks were then decompressed and
mapped back to their named procedural assets.

Brickadia stores BRS brick sizes as half-extents. The extracted standard-brick
presets consistently use 5-unit horizontal increments and 2-unit vertical
increments. Micro-brick assets use the finer 1-unit grid. Catalog presets are
examples offered by the editor, not an exhaustive list of every resizable size.

Orientation is independent of these local size rules. Directions 0 through 5
are valid Brickadia orientations, so the placement validator must not reject a
standard shape merely because it is mounted sideways.

The validator models `PB_DefaultRamp` and `PB_DefaultRampInverted` as convex
triangular prisms and uses the separating axis theorem for ramp/box and
ramp/ramp checks. Other non-convex or curved procedural assets remain marked as
uncertain until their cooked geometry has an exact decomposition.
