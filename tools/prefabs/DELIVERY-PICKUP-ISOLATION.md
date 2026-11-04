# Pickup crash isolation

The combined delivery owner ID test crashed the user's game on green Assign, before the receiving-zone test. Green performed character/player lookup, user-ID/name reads, embedded frozen physics cargo spawning, identity property writes and object label initialization. There is no crash log yet, so none of those operations has been established as the cause. BRZ endpoint/predicate checks do not establish runtime safety.

`prefabs/delivery-pickup-isolation.brz` separates four operations. Use a fresh copy; do not use the original combined rig.

1. **Green — 1 ID ONLY.** Reads the clicking player's identity. Expect a nonempty User ID and Last completed 1. It does not spawn or write entity properties.
2. **Blue — 2 SPAWN ONLY.** Spawns one plain cube. Expect Entity present true and Last completed 2. Its ordinary, nonphysics prefab mode follows the previously working wallet demo; runtime spawning still needs this test. It has no payload microchip, custom events or identity writes.
3. **Yellow — 3 WRITE ID.** Writes LoadProbe.OwnerId to the spawned entity. Expect Last completed 3. Does not spawn or read back.
4. **Red — 4 READ ID.** Reads the property. Expect PASS, a matching Read ID and Property found true.

Wait for each completed stage before pressing the next. Stop at the first failure/crash and report the button pressed; if it does not crash but shows a failure, capture the full readout. Blue is intended for one spawn per fresh copy; there is a spawner limit of one and no reset/destruction path. Lifetime zero requests no automatic expiration.

This diagnostic has no delivery zone, teleportation, physics-grid payload flags, cargo microchips, custom events, entity deletion, or leaderboard writes. It is not the load board or a confirmed fix. No simultaneous multiplayer use is intended.

Generate/check with:

```sh
node tools/prefabs/build-delivery-pickup-isolation.cjs prefabs/delivery-pickup-isolation.brz
```

Offline checks verify every serialized endpoint, payload embedding, ordinary nonphysics cargo flags, and execution reachability proving the four stages remain separate. Native user lookup, spawn, property write and property read still require in-game validation.

User subsequently confirmed none of the four stages crashed and red reported PASS. Continue with `delivery-receiver-zone-test.brz` to test reading that property from a zone's detected entity rather than the stored spawner reference. This does not establish the cause of the original combined rig's crash.
