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

## Landscape and architecture reference

The user's `example.brz` is a local-only style reference containing 22,477
bricks, 41 entities, 34 brick grids, 3,154 components, and 3,387 wires. The
main grid contains 18,772 bricks. It includes a timber house, mature trees,
windmill, pond, flower fields, fences, vehicles, lighting, garden furniture,
rockwork, and embedded logic.

The placement validator finds zero confirmed cuboid overlaps across the full
reference. It reports 392 shaped-asset envelope intersections, primarily where
wedges, ramps, and other non-box geometry intentionally occupies compatible
space. This reinforces the rule that complex appearance should come from
shape-aware contact and layering rather than intersecting rectangular solids.

### Visual vocabulary

- 6,001 default microbricks form most custom silhouettes and fine trim.
- 5,468 native small flowers and 3,987 procedural poles create dense fields
  economically through repetition, varied height, rotation, and color.
- 1,769 micro-wedges plus hundreds of side wedges, ramps, round corners, and
  wedge-corner variants soften silhouettes and build roofs, roots, rocks, and
  decorative transitions.
- The material palette is intentionally restrained: 21,176 plastic bricks,
  959 metallic, 189 glass, 135 glow, and 18 translucent plastic. Glass, glow,
  and metal appear as accents where their surface behavior communicates a
  purpose.
- The common colors establish a coherent world palette: field green, dark
  foliage green, warm timber brown, white, yellow, charcoal, red, pink, blue,
  muted stone greys, and limited bright accents.
- Fine dimensions are routine. Half-extents of 1, 2, and 3 appear thousands
  of times beside long beams and broad panels. Good detail comes from mixing
  these scales rather than constructing everything from similarly sized boxes.
- Every direction family and rotation is used. Most landscaping remains
  upright, while roofs, roots, branches, latticework, and mechanical details
  use sideways and inverted orientations.

### Trees

The mature custom tree is organized around a readable structural hierarchy:

1. A thick, multi-piece trunk with slight width and color variation.
2. Tapered roots that radiate outward at ground level using wedges and ramps.
3. Several long primary branches extending from different trunk heights.
4. Smaller secondary branches visible beneath and between foliage masses.
5. An irregular canopy assembled from offset rectangular foliage slabs in
   multiple heights, with gaps, asymmetric overhangs, and hanging edge pieces.

The foliage does not form a symmetric pyramid. Its silhouette changes from
every side, and the visible branch network makes the canopy appear supported.
Use at least two close foliage colors and multiple piece thicknesses. Preserve
open gaps beneath the canopy instead of filling a solid green volume.

Two isolated custom-tree assemblies provide more exact construction guidance.
Their coordinates and source prefab remain local.

#### Ramp-built tree A

This tree contains 131 procedural bricks:

- The entire 78-piece brown structure uses 75 `PB_DefaultRamp` pieces and
  only three `PB_DefaultBrick` pieces.
- Its branch ramps commonly use half-extents `[20,5,6]`, `[25,5,6]`,
  `[30,5,6]`, and `[15,5,6]`, with additional lengths from 10 through 35.
- Its rising trunk and branch transitions use ramp heights from 16 through 54
  with the repeated width/depth `[10,5]`.
- Ramps use both Z-positive and Z-negative directions and every rotation. The
  builder turns and inverts the same ramp asset to taper all four sides rather
  than wrapping a rectangular trunk in a few cosmetic slopes.
- The light-green canopy uses 31 large microbrick slabs, all half-height 5,
  with deliberately varied footprints such as `[20,15,5]`, `[30,15,5]`,
  `[20,25,5]`, `[15,30,5]`, `[35,15,5]`, and `[45,10,5]`.
- Twenty-one dark-green microbricks use tiny `[2,4,2]`, `[2,6,2]`, and
  `[2,2,8]` forms to add fine shoots and vertical foliage accents around the
  broad canopy pieces.

#### Ramp-built tree B

This larger tree contains 181 procedural bricks:

- Its 96-piece brown skeleton uses 43 `PB_DefaultRampInverted`, 33
  `PB_DefaultRamp`, and 20 `PB_DefaultBrick` pieces.
- Branch ramps range from half-length 10 through 40 at thickness `[5,6]`.
  Tall trunk tapers use `[10,5,Z]` pieces with Z half-extents extending from
  26 through 78.
- Standard and inverted ramps are paired through placement and orientation,
  not stacked at identical centers. Each sloped face occupies its own valid
  volume.
- Forty-four dark-green microbricks create the major foliage masses. They use
  thick, varied three-dimensional blocks rather than uniform tiles: examples
  include `[15,15,10]`, `[15,15,16]`, `[20,15,10]`, `[25,15,10]`,
  `[15,30,10]`, `[15,15,28]`, and `[30,15,10]`.
- Forty-one light-green `PB_DefaultPole` pieces add fine foliage detail in
  three repeated sizes: 14 at `[3,3,2]`, 14 at `[3,3,6]`, and 13 at
  `[3,3,12]`.

Future custom trees should begin with a ramp-defined trunk and branch skeleton.
Use standard and inverted ramps to taper roots, trunks, forks, and branch ends
from multiple sides. Add large, varied foliage masses afterward, then use
small poles or microbricks for shoots, hanging tips, and silhouette noise. A
box-built trunk with ramps added only at the roots does not match this style.

### House and small structures

- The house uses warm timber beams as an exposed frame over recessed white
  wall infill. The depth difference makes the framing readable in sunlight.
- Repeated windows share a consistent module of frame, mullions, sill, glass,
  and small roof or trim pieces.
- Roofs use broad sloped fields with narrow edge trim, ridge treatment, and
  gable transitions rather than a single oversized wedge.
- The porch, steps, planters, climbing plants, and furniture break the main
  facade into inhabited layers.
- The windmill combines narrow vertical posts, diagonal lattice braces,
  framed white blades, and a visually distinct hub. Repetition establishes
  structure while small offsets prevent it from reading as a flat diagram.
- Fences and lamps use repeatable modules with consistent post spacing. Their
  color and proportions match nearby timber construction.

### Landscaping

- Flower areas use uneven boundaries, mixed density, multiple stem heights,
  small color families, and occasional gaps. They are arranged as patches and
  drifts rather than a uniform rectangular grid.
- The pond has an irregular stepped perimeter, layered water treatment,
  underwater plants, lotus leaves, fish, edge masonry, a dock or bench area,
  and nearby lighting. The surrounding props make it a place rather than a
  bare water rectangle.
- Large objects are supported by small context: flowers around tree roots,
  paths near entrances, pumpkins beside fields, lamps beside seating, and
  fences defining rather than filling space.
- Repeated native assets provide density; custom microbrick assemblies provide
  focal points. Preserve that balance to keep large scenes detailed without
  making every background object equally complex.
