# /wallet name-object demo

Download `prefabs/wallet-command-horizontal.brz`, paste **one** controller into the world, then enter `/wallet` in chat. The BRZ includes the small object prefab used by its Spawn Prefab gate; there is no separate prefab file to configure.

The command spawns a small teal name box 120 world units horizontally ahead of the character, with a fixed 20-unit upward offset from the character's position. Four sides display `Wallet` and that player's display name. It remains where spawned and expires after 60 seconds. This is an owner/name initialization proof, not a currency wallet or interactive shop.

## Player-specific initialization

1. Chat Command `wallet` supplies the caller PlayerState.
2. An array queues requests; a busy flag processes one spawn/initialization at a time.
3. Get Character From Controller resolves that player, then Get Entity Location/Rotation reads their character position and rotation. Split Rotation retains yaw only; pitch and roll are set to zero before computing forward direction.
4. The target point is `Character Position + Horizontal Forward × 120 + (0, 0, 20)`. Mouse aim and aim origin are not used.
5. Get Own Transform and inverse rotation convert the target into the Spawn Prefab gate's local offset. The own-transform gate is 48 local units along X from the spawner, which is accounted for in the offset calculation.
6. Spawn Prefab creates the embedded name box. The circuit checks that its Entity is non-null and different from the previous Entity, so a failed/limited spawn cannot rename an earlier player's box.
7. After three ticks, Send Global Custom Event sends `WalletDemo.Initialize` with **Target = the new Entity**, **DataIn1 = the caller PlayerState**, and **DataIn2 = their display name**. A fresh null-target check prevents a destroyed object turning this into an untargeted event.
8. The embedded Global Custom Event has **Is Object Event enabled**. It stores the received owner and name in variables belonging to that particular object instance. Its name variable drives the four text decals.

The object-event targeting and three-tick initialization delay follow the pattern already present in the user's world, but this demo's geometry and circuit are new. No source world content is included.

## Settings and placement

- **Distance:** the numeric variable starts at 120.
- **Height:** the numeric height variable starts at 20 above the character position.
- **Lifetime:** Spawn Prefab starts at 60 seconds.
- **Spawn limit:** 32 active objects for this controller; a failed spawn reports back to the requesting player.
- **Command:** Chat Command's CommandName is `wallet` (without the slash).
- Keep only one active controller registering this command.
- Move/rotate the controller as a whole. Keep the two external transform/spawner gates in their existing relative positions; their 48-unit spacing is part of the placement calculation.

Character facing yaw determines the direction. Looking down or up does not move the spawn into the floor or overhead. The height offset is relative to character position, rather than a terrain measurement; this demo does not perform collision sweeps.

## Rebuild and checks

```sh
node tools/prefabs/build-wallet-name-demo.cjs prefabs/wallet-command-horizontal.brz
```

The builder includes 58 controller gates and six receiver/owner/name gates in the embedded object. Offline graph tests cover Alice/Bob name and owner isolation, overlapping queued requests, controller positions and cardinal yaw rotations, stale Entity output on failed spawn, destroyed targets, dead players, and queue completion. Tests are repeated using the serialized gate data and wires read back from both BRZ files. The embedded dependency, object-event flag, event names, targeted sender, valid wire endpoints and unique inputs are checked. In-game validation of command registration, spawn placement and event delivery is still required.

## Spawn wire repair

The uploaded in-game copy was missing the previous-Entity snapshot setter's ExecOut connection to Spawn Prefab.Exec. The rebuilt controller routes that execution through a one-tick buffer before spawning, separating the previous-Entity read from the spawner's next execution. The three-tick object initialization delay remains. Tests replay both buffered stages from the saved gate graph. Replace the old controller rather than keeping two instances registered for `/wallet`. In-game connection validation is pending.

## Horizontal placement update

The current controller uses character position and yaw instead of Get Aim. Vertical look angles from -90 through +90 degrees are covered in both generated-graph and saved-graph tests, alongside the existing player isolation and queue checks. Replace the old controller before pasting this version to avoid registering `/wallet` twice.
