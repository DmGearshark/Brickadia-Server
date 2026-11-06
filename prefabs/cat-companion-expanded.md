# Expanded autonomous cat companion

`cat-companion-expanded.brz` keeps the supplied cat body, servo, wheel engine,
four native wheels, and all five joints. Its old disconnected brain has been
replaced with a compiled WireScript state machine.

## Behavior

The cat tracks hunger, boredom, sleepiness, social need, affection, fear, and
per-player familiarity. One priority controller owns the motor outputs so its
needs cannot issue conflicting drive commands.

From highest to lowest priority, it can flee, react to being carried, return to
bed or nap where it is, seek food or a treat, stalk and play with a toy or player,
seek petting, answer `/cat`, follow a familiar player, sit, or roam near its spawn
point. Its face uses the supplied 😺 😼 😿 😻 😾 set.

The provided control inputs are now active:

| Posture | Top speed | Front suspension | Rear suspension |
| --- | ---: | ---: | ---: |
| Walk / follow | 100 | 500 | 500 |
| Stalk | 50 | 100 | 100 |
| Sit | 50, with drive braked | 500 | 100 |
| Sleep | 50, with drive braked | 100 | 100 |
| Play / pounce | 280 | 500 | 500 |
| Flee | 320 | 500 | 500 |

Suspension values blend toward their targets instead of changing in one tick.

## Head and neck

The supplied servo is the neck. The brain now drives its `TargetAngle` directly.
The current behavior focus also owns the head direction: players, food, treats,
toys, beds, stalking targets, and travel targets are followed precisely. The
head looks at the carrier while held, wanders through small idle glances only
without a focus, and returns smoothly to center while sleeping. Tracking is
clamped to 55 degrees in either direction.

The microchip remains mounted on the head grid. Physical navigation, sensing,
and spatial audio use explicit chassis adapters, so turning the head does not
change the cat's movement reference.

## Mood indicator

The square decal on the rear of the head normally follows the emoji mood. Two
intent colors take priority so the cat visibly announces what it is pursuing:

| Indicator | Meaning |
| --- | --- |
| Cyan | A treat was spotted and the cat is walking over to eat it |
| Purple | The cat is stalking or pouncing on a toy or player |
| Green | Calm / normal |
| Amber | Playful / mischievous without an active play target |
| Blue | Needy / hungry / tired / unhappy |
| Pink | Affectionate / pleased |
| Red | Angry / frightened / fleeing |

The user's square text, face selection, size, anchor, and head placement are
preserved. Only its `Color` input is controlled by the brain.

## Interaction

- Interact with the visible cat head and choose **Pet Cat**. Petting lowers fear
  and social need, raises affection and familiarity, changes the face, and
  starts purring. A highly stimulated cat can rarely become annoyed and leave.
- Pickup is inferred after the chassis stays off the ground for about two
  seconds while a player is within 210 units. The cat randomly enjoys or
  dislikes each pickup, weighted by affection and fear. A disliked pickup makes
  it flee after landing.
- `/cat` is heard within 1,200 units. Familiar players are much more likely to
  get a response; strangers are usually ignored. Petting and being near the cat
  when it gets a treat increase familiarity.
- Damage to the head immediately raises fear and starts a flee response.

The `/cat` handler uses Brickadia's admin-only Chat Command Event gate. An admin
must place the prefab for that one feature to load. The rest of the behavior is
independent of it.

## Tagged objects

The attached forward zone moves with the chassis. It discovers nearby players
and tagged entities because Brickadia has no global tag lookup, then remembers
the last coordinates of recognized objects after they leave its detection
volume. Tag matching is exact and case-sensitive. The current aliases are:

| Object | Recognized tags |
| --- | --- |
| Bed | `Cat Bed 1`, `cat:bed` |
| Food | `Cat Food 1`, `cat:food` |
| Treat | `Kitty Treat 1`, `cat:treat` |
| Toy | `Cat toy 1`, `cat:toy` |

Each object must be its own physics entity. A tagged brick merged into the map
or another large grid identifies that entire grid rather than the individual
object.

When the cat reaches a treat, it runs `DestroySpawnedPrefab` on that treat and
clears its remembered reference. Each consumable treat must therefore be its own
spawned prefab instance. A manually pasted object may ignore that gate, while a
treat bundled into a larger spawned prefab can cause the entire instance to be
removed. Food bowls, beds, and toys remain persistent.

Treats no longer depend on hunger or a random roll. A discovered treat becomes
the highest ordinary priority after carrying and danger, and the indicator turns
cyan during the approach. Five successful treats are allowed in any rolling
three-minute window; further treats are ignored until the oldest one leaves that
window. Missing treats grant no rewards and do not count toward the limit.

Toy play begins soon after placement, then settles into a slower boredom cycle.
When both a toy and player are available, the toy always wins. The cat turns
purple, lowers itself, stalks to within 180 units, then raises its speed to 280
and runs directly into the exact toy. A successful pounce relieves boredom;
toys remain in the world.

The sensor reaches 900 units in front of the chassis and is approximately 240
units wide by 120 units tall. Roaming lets the cat discover objects in different
directions over time.

## Audio

Brickadia's shipped asset catalogue has no cat meow or purr recording. Meows use
the verified `OBA_Beep_3` spatial sound with a new random pitch from 0.5 to 1.5
for every call. Purring uses a quiet, low-pitched spatial
`BA_Thumpy_Machine` emitter mounted invisibly on the chassis.

## Verification

The final prefab contains 1,203 bricks, including 1,182 compiled brain gates plus
the three supplied annotated control gates, and 2,092 wires. Static verification
found zero invalid bricks, overlaps, duplicate wire drivers, or instant cycles.
The four native wheel entities, four suspension joints, and neck servo joint
survive byte-level round trips.

The first live test should check wheel steering, neck polarity, mood-indicator
color, physical pickup detection, zone discovery and treat deletion using the
user's tagged objects, spatial audio volume, and `/cat` behavior with two
players. Those physics and multiplayer details cannot be reproduced by the
headless gate simulator.
