# Autonomous cat companion bot

This prefab preserves the supplied four-wheel chassis and fills its empty brain chip with autonomous behavior.

- It searches for a nearby player five times per second using the normal player capsule collision and follows that player until it is about 90 units away.
- With no player in its 900-unit search radius, it drives in roaming arcs and chooses a new turn every 3.5 seconds.
- A forward sweep looks 140 units past the nose for bricks, physics objects, and the map. On a hit, the bot backs up and turns for 0.9 seconds.
- The existing face display shows 😺 while roaming, 😼 while following, 😻 when it reaches the player, 😿 when stalled, and 😾 while avoiding an obstacle.

The green `SteeringPolarity` variable in the pursuit row is `1`. If the first in-game test makes the bot turn away from the player, change that single value to `-1`; wheel orientation is the one control sign that a saved prefab does not expose unambiguously.

The brain is arranged in color-coded rows: blue sensing, purple state, green pursuit math, orange roaming, and red final outputs. The player sensor uses collision channel 8 with detailed-body collision disabled, matching the capsule path verified by the earlier returned probe.
