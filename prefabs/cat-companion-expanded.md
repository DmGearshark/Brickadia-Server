# Expanded autonomous cat companion

`cat-companion-expanded.brz` keeps the supplied cat body, servo, wheel engine,
four native wheels, and all five joints. Its old disconnected brain has been
replaced with a compiled WireScript state machine mounted on the body chassis.

## Behavior

The cat tracks hunger, boredom, its nap schedule, social need, affection, fear,
and per-player familiarity. One priority controller owns the motor outputs so
its needs cannot issue conflicting drive commands.

From highest to lowest priority, it can react to being carried, flee danger,
hold an angry response, eat a discovered treat, wait after asking for pets,
return to bed or nap where it is, seek food, answer `/cat`, stalk and chase a
toy or player, ask for petting, follow a nearby player, stretch, sit, sprint, or
roam near its spawn point. Its face uses the supplied emoji moods plus `zzz`,
`zzZ`, and 🐈, with active states choosing the face text and color together.

The provided control inputs are now active:

| Posture | Top speed | Front suspension | Rear suspension |
| --- | ---: | ---: | ---: |
| Walk / follow | 100 | 500 | 500 |
| Stalk | 50 | 100 | 500 |
| Sit | 50, with drive braked | 500 | 100 |
| Sleep | 50, with drive braked | 100 | 100 |
| Chase / pounce | 280 | 500 | 500 |
| Flee | 320 | 500 | 500 |
| Angry | 180 while retreating, then braked | 100 | 100 |
| Stretch | 50, gently reversing | 100 | 500 |

Suspension values blend toward their targets instead of changing in one tick.

## Head and neck

The supplied servo is the neck. The brain now drives its `TargetAngle` directly.
The current behavior focus also owns the head direction: players, food, treats,
toys, beds, stalking targets, and travel targets are followed precisely. The
head looks at the carrier while held, wanders through small idle glances only
without a focus, and returns smoothly to center while sleeping. Tracking is
clamped to 55 degrees in either direction.

The outer microchip is mounted on the wheel-engine chassis at a checked free
body position. The internal logic plane remains linked to that shell. The face
and square stay on the servo head, while navigation, sensing, interaction, and
spatial audio now share the body's reference directly.

## Mood indicator

The face display and square decal share the same `MoodColor` output, so both
follow the active behavior:

| Indicator | Meaning |
| --- | --- |
| Orange + 😼 | Stalking a locked toy or player |
| Yellow + 😼 | Chasing after a stalk or having a spontaneous fast run |
| Red + 😾 | Angry, retreating, or lying low |
| Cyan + `zzz` | Sleepy or returning to bed |
| Dark blue + `zzZ` | Sleeping |
| Amber + 🐈 | Stretching |
| Lime + 😿 | Hungry or walking to food |
| Magenta + 😻 | Walking to a treat |
| Green + 😺 | Calm / normal |
| Amber + 😼 | Playful / mischievous without an active play target |
| Blue + 😿 | Needy, unhappy, frightened, or fleeing |
| Pink + 😻 | Affectionate / pleased |

The user's square and face display placement and style are preserved. The brain
controls the face text and sends the same color to both displays.

## Interaction

- Interact with the cat body and choose **Pet Cat**. Petting lowers fear
  and social need, raises affection and familiarity, changes the face, and
  starts purring. When the cat walks over to ask for pets, it waits 15 seconds.
  Being ignored makes it angry for about 12 seconds. During a requested petting
  session the sixth accepted pet is too much; outside a request, the third and
  later rapid pets each have a 35% chance to annoy it. Accepted pets are spaced
  by the existing two-second interaction cooldown. Angry cats do not award
  affection or purr, and wait at least 45 seconds before asking again. Angry
  cats drive away from the offending or nearby player for five seconds, then
  remain braked with both suspensions low for the rest of the angry period.
- Pickup is inferred after the chassis stays off the ground for about two
  seconds while a player is within 210 units. The cat randomly enjoys or
  dislikes each pickup, weighted by affection and fear. A disliked pickup makes
  it flee after landing.
- `/cat` is heard within 1,200 units and every safe call starts a 20-second
  follow response. It wakes a sleeping cat, but carrying, danger, anger, or an
  active pet request take priority. Familiarity changes the greeting face.
  Petting and being near the cat when it gets a treat increase familiarity.
- Damage to the body immediately raises fear and starts a flee response.

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
| Consumable food | `Cat Food` |
| Persistent food bowl | `Cat Food 1`, `cat:food` |
| Treat | `Kitty Treat 1`, `cat:treat` |
| Toy | `Cat toy 1`, `cat:toy` |

Each object must be its own physics entity. A tagged brick merged into the map
or another large grid identifies that entire grid rather than the individual
object.

When the cat reaches a treat or exact `Cat Food`, it confirms that entity is
still inside the sensor, runs `DestroySpawnedPrefab`, and clears its remembered
reference. Each consumable must therefore be its own spawned prefab instance. A
manually pasted object may ignore that gate, while an object bundled into a
larger spawned prefab can cause the entire instance to be removed. The two food
bowl aliases, beds, and toys remain persistent.

Treats no longer depend on hunger or a random roll. A discovered treat becomes
the highest ordinary priority after carrying, danger, and an active angry
response, and the indicator turns magenta during the approach. Five successful
treats are allowed in any rolling three-minute window; further treats are
ignored until the oldest one leaves that window. Missing treats grant no rewards
and do not count toward the limit.

Toy play begins soon after placement, then settles into a slower boredom cycle.
When both a toy and player are available, the toy always wins. The cat turns
orange, lowers its front while keeping the rear suspension high, and stalks to
within 180 units. It then enters yellow Chase, raises its speed to 280, and runs
directly into that exact focus. A successful focused pounce relieves boredom;
toys remain in the world. Chase can also occur as a five-to-eight-second random
burst of energy without a stalking target or boredom reward.

Navigation has separate forward and rear wall sweeps positioned to clear the
servo head while explicitly ignoring the chassis, preventing self-detection.
A front obstruction allows only a short 0.6-second recovery at low reverse power,
then starts a ten-second reverse cooldown. During that cooldown the cat brakes
without discarding its current target and resumes immediately when the path is
clear. A persistent obstruction can trigger only one short retry per cooldown.
The rear sweep watches every negative drive command; a brick or map wall behind
the cat stops and brakes it immediately. Continuous reversing also has a
three-second hard limit as a final guard.

After five to ten minutes awake and once higher-priority behavior clears, the cat
prefers a known bed 75% of the time and otherwise naps in place. The final minute
before that deadline is the cyan `zzz` period unless another active mode owns the
indicator. Sleep uses `zzZ`. A nap lasts 30 to 60 seconds, then the cat schedules
a two-to-four-second stretch, with the reverse guard limiting continuous motion
to three seconds. Idle stretches begin after two to four minutes and recur only
every three to six minutes. Stretch lowers the front, raises the rear, centers
the neck, and backs up gently unless the rear sweep sees an obstruction.

The sensor reaches 900 units in front of the chassis and is approximately 240
units wide by 120 units tall. Roaming lets the cat discover objects in different
directions over time.

## Audio

Brickadia's shipped asset catalogue has no cat meow or purr recording. Meows use
the verified `OBA_Beep_3` spatial sound with a new random pitch from 0.5 to 1.5
for every call. Purring uses a quiet, low-pitched spatial
`BA_Thumpy_Machine` emitter mounted invisibly on the chassis.

## Verification

The final prefab contains 1,683 bricks, including 1,662 compiled brain gates plus
the three supplied annotated control gates, and 2,980 wires. Static verification
found zero invalid bricks, overlaps, duplicate wire drivers, or instant cycles.
The four native wheel entities, four suspension joints, and neck servo joint
survive byte-level round trips.

The first live test should check wheel steering, neck polarity, physical pickup
detection, spatial audio volume, and `/cat` behavior with two players. It should
also verify orange Stalk with a low front and high rear, yellow Chase at speed,
the angry retreat and low resting posture, cyan `zzz`, dark-blue `zzZ`, amber
Stretch reverse movement, the pet-request timeout and both over-petting paths,
30-to-60-second naps, zone discovery, treat deletion, exact `Cat Food` deletion,
and immediate braking when a wall is placed behind it during either Stretch or
obstacle recovery. Those physics and multiplayer details cannot be reproduced by
the headless gate simulator.
