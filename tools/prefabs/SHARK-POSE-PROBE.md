# Shark tail body-part pose probe

`prefabs/shark-tail-body-part-pose-probe.brz` preserves the supplied shark
head/tail follower and adds six diagnostic sweeps at relative heights 0, 10,
20, 30, 40 and 50. Each new sweep has **Only Hit Player Body Parts** enabled
and accepts a hit only when the returned entity is the controlled character.

The follower chip's display reports all six body-part hits plus the original
Z+20 capsule result. Activate the follower, open/view its chip display, and
record the patterns while standing, crouching and using the sit emote. If the
sit pattern differs from standing, animated body-part sweeps can drive an
automatic sitting offset. If they are identical, the emote pose is not exposed
to this Wire query and needs a manual toggle.

The original gates and 107 wires are retained. The probe adds 19 gates and 38
wires. Placement validation finds no invalid bricks, confirmed overlaps or new
contacts. It retains the source prefab's four pre-existing shape-uncertain
switch contacts.
