# Expanded autonomous cat companion

`cat-companion-expanded.brz` keeps the supplied cat body, servo, wheel engine,
four native wheels, and all five joints. Its old disconnected brain has been
replaced with a compiled WireScript state machine.

## Behavior

The cat tracks hunger, boredom, sleepiness, social need, affection, fear, and
per-player familiarity. One priority controller owns the motor outputs so its
needs cannot issue conflicting drive commands.

From highest to lowest priority, it can flee, react to being carried, return to
bed or nap where it is, seek food or a treat, stalk and play with a toy or player, seek
petting, answer `/cat`, follow a familiar player, sit, or roam near its spawn
point. Its face uses the supplied 😺 😼 😿 😻 😾 set.

The provided control inputs are now active:

| Posture | Top speed | Front suspension | Rear suspension |
| --- | ---: | ---: | ---: |
| Walk / follow | 100 | 500 | 500 |
| Stalk | 50 | 100 | 100 |
| Sit | 50, with drive braked | 500 | 100 |
| Sleep | 50, with drive braked | 100 | 100 |
| Play / pounce | 200 | 500 | 500 |
| Flee | 320 | 500 | 500 |

Suspension values blend toward their targets instead of changing in one tick.

## Interaction

- Interact with the visible cat body and choose **Pet Cat**. Petting lowers fear
  and social need, raises affection and familiarity, changes the face, and
  starts purring. A highly stimulated cat can rarely become annoyed and leave.
- Pickup is inferred after the chassis stays off the ground for about two
  seconds while a player is within 210 units. The cat randomly enjoys or
  dislikes each pickup, weighted by affection and fear. A disliked pickup makes
  it flee after landing.
- `/cat` is heard within 1,200 units. Familiar players are much more likely to
  get a response; strangers are usually ignored. Petting and being near the cat
  when it gets a treat increase familiarity.
- Damage to the visible body immediately raises fear and starts a flee response.

The `/cat` handler uses Brickadia's admin-only Chat Command Event gate. An admin
must place the prefab for that one feature to load. The rest of the behavior is
independent of it.

## Tagged objects

The hidden forward sensor remembers the last coordinates of recognized objects
even after they leave its detection volume. Tag matching is exact and
case-sensitive. The current aliases are:

| Object | Recognized tags |
| --- | --- |
| Bed | `Cat Bed 1`, `cat:bed` |
| Food | `Cat Food 1`, `cat:food` |
| Treat | `Kitty Treat 1`, `cat:treat` |
| Toy | `Cat toy 1`, `cat:toy` |

Each object must be its own physics entity. A tagged brick merged into the map
or another large grid identifies that entire grid rather than the individual
object.

The sensor reaches 900 units in front of the chassis and is approximately 240
units wide by 120 units tall. Roaming lets the cat discover objects in different
directions over time.

## Audio

Brickadia's shipped asset catalogue has no cat meow or purr recording. Meows use
the verified `OBA_Beep_3` spatial sound with a new random pitch from 0.5 to 1.5
for every call. Purring uses a quiet, low-pitched spatial
`BA_Thumpy_Machine` emitter mounted invisibly on the chassis.

## Verification

The final prefab contains 1,002 bricks, including 981 compiled brain gates plus
the three supplied annotated control gates, and 1,724 wires. Static verification
found zero invalid bricks, overlaps, duplicate wire drivers, or instant cycles.
The four native wheel entities, four suspension joints, and body servo joint
survive byte-level round trips.

The first live test should check wheel steering, physical pickup detection,
zone discovery using the user's tagged objects, spatial audio volume, and
`/cat` behavior with two players. Those physics and multiplayer details cannot
be reproduced by the headless gate simulator.
