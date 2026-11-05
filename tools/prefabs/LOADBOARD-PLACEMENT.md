# Close, player-facing loadboard placement

This update starts from **needs updating.brz** and preserves its embedded portable display byte-for-byte, including the edited geometry, disabled player/weapon/physics colliders, remaining interaction/tool settings and Fine collision quality. Both embedded cargo assets and every circuit outside the `/loadboard` command chip are also preserved.

The previous command calculated a local spawn offset using a Get Own Transform gate and a fixed +48 X correction. That correction came from the earlier arrangement with the spawner outside the chip. It did not reliably describe the placement after the gates moved into a rotated microchip. The embedded display in this upload also has its visible side along positive local X, requiring a half-turn relative to the player's heading.

The revised command spawns the supplied client, then uses **Set Location Rotation** to apply an explicit world transform before sending its initialization event:

- Position: character location + horizontal heading × 60 + (0,0,16).
- Rotation: zero pitch/roll, character yaw + 180 degrees.

The forward distance was 120. It is now 60. The height offset was 20 and is now 16. Pitch is ignored so looking up/down does not send the board toward the ceiling/floor. These offsets are in native gate units and may be tuned after an in-game check. The command chip’s placement/rotation no longer participates in calculating the final board position. The spawner and command logic remain inside the command chip.

The existing delayed spawn/result checks, caller binding and replacement of the caller's previous board remain. The client retains its inactivity timeout. No server-side offer, delivery or payment logic is regenerated.

Reproduce:

```sh
node tools/prefabs/update-loadboard-placement.cjs 'needs updating.brz' prefabs/loadboard-system.brz
```

The updater runs serialization checks for saved bricks/components/wire endpoints and exact preservation of unrelated circuitry and embedded files. Graph tests cover eight headings, three pitch angles and immediate/one-tick query publication (48 scenarios), facing direction, final position before initialization and repeated command replacement. The baseline graph integration suite passes as well. These checks do not execute the Brickadia engine; confirm placement and interaction in game.

Replace the old central assembly with one updated copy, remove old spawned boards and run `/loadboard` again.
