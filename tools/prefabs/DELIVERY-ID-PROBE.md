# Delivery owner ID test

> **Withdrawn from testing:** the user reports the game crashes when pressing green Assign. Cause unconfirmed. Do not use this combined rig; use `delivery-pickup-isolation.brz` to identify the failing pickup stage.

Download `prefabs/delivery-owner-id-test.brz`. This is a single-contract test rig for cargo identity, not the load board. It includes its own frozen physics cargo prefab. It writes no leaderboard scores or currency and does not alter the existing shops.

## In-game procedure

1. Paste one fresh test rig. Press **1. ASSIGN** (green). Wait for **READY**. A crate should appear with your display name, user ID and a delivery number.
2. Press **2. DELIVER** (blue). The rig moves the crate into its receiving zone automatically. Expect **ACCEPTED**, Accepted 1, Properties found true/true/true, and Same spawned entity true. The expected and read owner IDs should match.
3. Press green again and wait for READY. This replaces the old test crate and creates the next delivery number.
4. Press **CORRUPT ID** (red), then blue. Expect **REJECTED**: Read owner should be WRONG-OWNER while Expected owner remains your actual ID. Accepted should stay 1 and Rejected should become 1.
5. Optionally have player A assign and player B press Deliver. The crate should remain assigned to A and be accepted for A's contract. There is no payment in this test.

If a step fails, capture the entire display and describe the last button pressed. In particular, Zone entries zero after blue points toward movement/zone detection; a zone entry with Properties found false points toward entity/property storage or entity identity; failed acceptance with all properties present is visible in the compared values. A crate label that remains uninitialized isolates a separate object-event problem.

The crate remains after acceptance for inspection. A new green assignment deletes only the previous crate referenced by this rig. Lifetime zero requests no timed expiration. The source also includes an explicit spawner limit of one. Test one rig at a time and avoid overlapping button presses; simultaneous multiplayer acceptance is outside this diagnostic's scope. Do not save it as a production system. Completion is memory-only and is reset by assigning a new test crate.

## Implementation

- Pickup derives PlayerState from the clicking character and uses native Get User ID, not the display name, as owner identity.
- Set Custom Property writes `LoadProbe.OwnerId`, `LoadProbe.DeliveryId`, and `LoadProbe.Destination` onto the spawner's returned entity. Set Tag marks it `LoadProbeCargo` for the receiving zone's broad category filter.
- An object-scoped global `LoadProbe.Label` event initializes the specific cargo instance's cosmetic text only. Acceptance reads native entity properties; it does not trust label text.
- The receiver snapshots Entity from Entity Zone Entered and reads all three properties from that detected entity. It requires found flags, expected owner/contract/destination, a nonempty expected owner, the registered physical entity, and an incomplete contract.
- Completion is marked before incrementing the local Accepted counter. A second delivery for the same completed contract is rejected. The red button changes only the cargo OwnerId property, not the expected contract or its original cosmetic label.
- Tick buffers separate native query outputs and variable assignments from dependent decisions, using what was learned from the shops' first-entry timing issue.
- Green/blue/red controls use rising-edge detection and a short action lock. The receiver has its own processing lock. These guards simplify manual tests; they are not a full request queue or persistent contract authority.

## Offline validation

```sh
node tools/prefabs/build-delivery-id-probe.cjs prefabs/delivery-owner-id-test.brz
```

Checks round-trip the embedded cargo and every connected component/wire through BRZ serialization. The actual serialized acceptance predicate is evaluated against matching, wrong-owner, wrong-contract, wrong-destination, missing-property, already-completed, unregistered-entity and empty-owner cases. Checks confirm object-scoped label targeting and absence of leaderboard gates. They do not emulate native physics, zone overlaps, custom-property persistence or runtime event scheduling. Those are the purpose of the in-game test.
