# Marten R4 rally coupe

A standalone original car prefab: ivory bodywork, burgundy roof and mirrors,
dark center stripe, sloped bonnet/hatch, flared wheel-arch strips, stepped
glazing, mud flaps, tow loops, lamps and a grille. The original world's vehicle
examples inform construction, but the world is not embedded or modified.

From this directory after `npm ci`:

```sh
node build-marten.cjs ../../prefabs/marten-r4.brz
```

Generation reads the local reference `references/car.brz`, or the path in
`MARTEN_REFERENCE_CAR`. That source is not published. Only generation needs it;
the exported `.brz` is standalone. The car has two seats; the right-hand seat
is wired as the driver. The engine drives four wheel joints using the original
two-level wheel assemblies. The output has 229 bricks, five brick grids,
eight entities and five drivetrain wires.

The World builder creates the archive and rebuilds all brick, component and
entity references. There is no fixed 63-piece body budget and no raw-patching
of an existing exterior. Mechanical references are separate from cosmetic
body pieces. The resulting bundle is marked as a physics-grid prefab.
The builder's native-wheel-class limitation is handled by an archive finalizer
which imports the reference's actual caster schema and records, then checks
all eight joint targets. Bounds explicitly include the wheels below the body.

Geometry checks classify cuboids exactly under all 24 discrete orientations.
Ramp/wedge enclosing-volume intersections are reported as unknown, never
silently passed as exact solid tests. The design avoids even those enclosing
intersections. Face contacts are distinguished from positive-volume overlap.
The checker also traces enclosing-face connectivity to the chassis and checks
the seat, engine and chassis clearance regions. Seat bounds remain conservative
approximations, supported by observed reference adjacency rather than native
mesh data. Door skins retain selectively disabled physics collision.
The envelope connectivity check does not establish exact contact along ramp
surfaces. Stepped windscreen/hatch glazing still needs visual inspection in
game. Rear glazing follows the rear pillar's 16-to-20 depth/height ratio,
rounded to the calibrated 0.1 placement grid.

No external geometry preview is generated, per the user's preference. Native
placement rules, visible appearance, seat entry, wheel suspension travel,
braking/steering and full physics still need an in-game test. Successful
serialization/readback does not establish these behaviors.
