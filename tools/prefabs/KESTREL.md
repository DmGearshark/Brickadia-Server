# Kestrel GT

New blue-and-amber compact coupe body. It retains the user's original wheels,
seats, suspension, engine and hinged rear-deck mechanism. Unlike the targa
prototype, all 63 exterior brick slots are authored anew, including the cabin,
roof, glazing, doors, bonnet, bumper, grille, lights, side rails and mirrors.
The retained rear-deck pieces are recolored to match.

From this directory after `npm ci`:

```sh
node build-kestrel.cjs /path/to/original/car.brz ../../prefabs/kestrel-gt.brz
python3 preview-kestrel.py ../../prefabs/kestrel-gt.brz.geometry.json ../../prefabs/previews/kestrel-gt.png
```

Preview requires Python, NumPy and Matplotlib. It draws the authored body boxes
from geometry read back from the output archive. Native wheels, seats and the
hinged rear deck are simplified; the image is not a game screenshot or an exact
render of native assets. No thumbnail from the original car is reused.

Checks:

- Zero positive-volume intersections between the 63 authored body cuboids.
- Every authored cuboid reaches the chassis by face contact.
- Clearance against the retained chassis, expanded seat bounds, engine and
  lamp envelopes, and the rear-deck bounding boxes at their saved pose.
- Every authored saved size, position and color reads back as specified.
- Mechanical component/wire files and all entity records are unchanged.
- 189 bricks, six grids, nine entities remain.

Native asset envelopes remain approximations. Seat entry, the moving deck's
full sweep, suspension travel, appearance and driving need in-game testing.
Previous roadster import failures are not treated as resolved by these checks.

The source car and user re-exports remain local and are not published.
