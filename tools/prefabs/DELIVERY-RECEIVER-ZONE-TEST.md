# Receiving-zone identity test

The user confirmed all four pickup isolation stages ran without a crash and red showed PASS. Native player-ID lookup, plain prefab spawning, writing OwnerId and reading it directly from the spawner reference are therefore confirmed for that test. The original combined rig's crash cause remains unknown.

`prefabs/delivery-receiver-zone-test.brz` retains the plain single-cube payload and manual pickup steps. It adds a receiving zone and an isolated movement step. There are no physics-grid payload flags, object events, entity tags, cargo microchips, deletion gates or score writes.

## Run in game

1. Paste one fresh test copy.
2. Repeat green, blue, yellow, red, waiting for each stage. Red should PASS as before.
3. Press the new **purple — 5 ZONE TEST** button. It moves the existing cube into the receiving zone; no manual hauling is needed.
4. Read the lower RECEIVING ZONE section. Expect PASS, Same cube true, Property found true, Owner matches true, and the zone-read owner ID matching the expected User ID.

If Zone entries stays zero, report that separately from an identity failure. If a crash occurs, report the exact button pressed. If there is a failure without a crash, capture the entire readout. Test one cube per fresh rig, no simultaneous inputs.

The key new path is EntityZoneEvent_Entered.Entity -> stored arriving entity -> Get Custom Property OwnerId. The receiver never substitutes the spawner reference for that read. It independently checks that the detected entity is the registered cube and that the ID matches. This is identity transport validation, not payment/completion logic or a production load board. No real ownership or currency state is saved.

The earlier sender rig is still withdrawn. This test does not establish that the removed physics payload or object initialization was the cause of the earlier crash.

## Rebuild and offline checks

```sh
node tools/prefabs/build-delivery-pickup-isolation.cjs prefabs/delivery-receiver-zone-test.brz --zone
```

Checks verify exact serialized endpoints, ordinary embedded cargo, zone-derived property-read wiring and acceptance predicate cases for matching, wrong owner, missing property, unrelated entity and absent registered cube. The original four-stage generator's checks also pass. Native zone overlap, entity movement and identity retention through movement still need in-game confirmation.
