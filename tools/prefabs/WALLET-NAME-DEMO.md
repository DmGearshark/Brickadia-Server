# /wallet name-object demo

Download `prefabs/wallet-command-name-demo.brz`, paste **one** controller into the world, then enter `/wallet` in chat. The BRZ includes the small object prefab used by its Spawn Prefab gate; there is no separate prefab file to configure.

The command spawns a small teal name box 120 world units ahead of the caller's aim origin. Four sides display `Wallet` and that player's display name. It remains where spawned and expires after 60 seconds. This is an owner/name initialization proof, not a currency wallet or interactive shop.

## Player-specific initialization

1. Chat Command `wallet` supplies the caller PlayerState.
2. An array queues requests; a busy flag processes one spawn/initialization at a time.
3. Get Character From Controller resolves that player, then Get Aim reads their world origin and direction.
4. The target point is `Aim Origin + Aim Direction × 120`.
5. Get Own Transform and inverse rotation convert the target into the Spawn Prefab gate's local offset. The own-transform gate is 48 local units along X from the spawner, which is accounted for in the offset calculation.
6. Spawn Prefab creates the embedded name box. The circuit checks that its Entity is non-null and different from the previous Entity, so a failed/limited spawn cannot rename an earlier player's box.
7. After three ticks, Send Global Custom Event sends `WalletDemo.Initialize` with **Target = the new Entity**, **DataIn1 = the caller PlayerState**, and **DataIn2 = their display name**. A fresh null-target check prevents a destroyed object turning this into an untargeted event.
8. The embedded Global Custom Event has **Is Object Event enabled**. It stores the received owner and name in variables belonging to that particular object instance. Its name variable drives the four text decals.

The object-event targeting and three-tick initialization delay follow the pattern already present in the user's world, but this demo's geometry and circuit are new. No source world content is included.

## Settings and placement

- **Distance:** the numeric variable starts at 120.
- **Lifetime:** Spawn Prefab starts at 60 seconds.
- **Spawn limit:** 32 active objects for this controller; a failed spawn reports back to the requesting player.
- **Command:** Chat Command's CommandName is `wallet` (without the slash).
- Keep only one active controller registering this command.
- Move/rotate the controller as a whole. Keep the two external transform/spawner gates in their existing relative positions; their 48-unit spacing is part of the placement calculation.

The target follows the look direction, including vertical aim. This demo does not perform a collision sweep to move the object away from a wall or floor.

## Rebuild and checks

```sh
node tools/prefabs/build-wallet-name-demo.cjs prefabs/wallet-command-name-demo.brz
```

The builder includes 51 controller gates and six receiver/owner/name gates in the embedded object. Offline graph tests cover Alice/Bob name and owner isolation, overlapping queued requests, controller positions and cardinal yaw rotations, stale Entity output on failed spawn, destroyed targets, dead players, and queue completion. Tests are repeated using the serialized gate data and wires read back from both BRZ files. The embedded dependency, object-event flag, event names, targeted sender, valid wire endpoints and unique inputs are checked. In-game validation of command registration, spawn placement and event delivery is still required.
