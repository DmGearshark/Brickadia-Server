# Central load-board system

**Current presentation update:** one top title, default sounds on all four buttons, confirmed accept/abandon/collect/deliver cues, and compact labeled chip sections based on the supplied reference. The working event-driven queues, spawn placement and gameplay are retained. See [LOADBOARD-PRESENTATION.md](LOADBOARD-PRESENTATION.md).

**Current repair:** the spawner feedback boundary is restored, and the four 0.1-second inbox polls are replaced by event-driven queues. The portable client and cargo bytes are unchanged. See [LOADBOARD-SPAWN-REPAIR.md](LOADBOARD-SPAWN-REPAIR.md).

**Current artifact:** optimized after GP1–GP3, with batched request/stat reads and a reusable listing Function. Current display, Fine/collider settings, spawn placement and gameplay safeguards are preserved. See [LOADBOARD-OPTIMIZED.md](LOADBOARD-OPTIMIZED.md) for validation, modeled timings and reproduction.

Latest placement update: the artifact uses the edited collision-free portable display from **needs updating.brz** unchanged. `/loadboard` applies a direct world position 60 units ahead and 16 above the character, facing back toward them, before initialization. See [LOADBOARD-PLACEMENT.md](LOADBOARD-PLACEMENT.md).

> **Updated build:** the portable client now uses the separated chip placement that the user confirmed could spawn and initialize without crashing. String Split gates now use occurrence **1**, matching the working shops; the previous occurrence 0 caused raw packed records to spill across the screen. Replace the old system with this build and retest the normal `/loadboard` path. The exact engine-level cause of the earlier graph assertion remains unconfirmed.

`prefabs/loadboard-system.brz` now uses the five-row display from **Update Needed..brz**, with immediate re-listing of abandoned offers. See [LOADBOARD-V2.md](LOADBOARD-V2.md). Paste **one** copy of the central system. It embeds the portable display and both cargo prefabs; there is no separate file installation.

## First in-game run

1. Type `/loadboard`. A caller-bound screen should appear horizontally ahead of you. The physical board in the reference assembly is a visual template labeled **Use /loadboard**; the command spawns the live client.
2. Scroll to a load and press **Accept**. Owning a Car or Truck permits Cheap Crate; owning a Truck permits either cargo. Default payments are 250 and 400 Scrap.
3. Walk into the pickup terminal's small zone. Its screen binds to the first player and shows that player's active load. Press **Collect**. Cargo should spawn above the marked pad, stamped by the central server.
4. Transport the cargo into the large receiving zone. The server validates its owner UUID, delivery number and destination, clears the active job, credits Scrap and sends **Delivery complete! Received +250 Scrap.** (or the configured amount) privately to the assigned driver. The delivered cargo is removed.

The separated-chip diagnostic was tested in game, but this updated complete assembly and its normal command path still require a new in-game check. First confirm clean load names, pickup binding and cargo placement before testing payout. The earlier isolated ordinary-prefab ID-write/read and receiving-zone ID tests were confirmed in game; the original frozen-physics combined probe remains withdrawn.

## Behavior

- Five shared, exclusive listings. Initial jobs alternate Cheap Crate/Fuel. Each initial listing expires after 10, 15, 20, 25 or 30 minutes. Subsequent lifetimes are randomly chosen from the configurable 10–60 minute range, and cargo type is randomized independently per listing. Accepting reserves that listing. Abandoning immediately returns the original offer to its original slot and restarts that slot’s lifetime; completing delivery leaves it taken until rotation. Other boards refresh on opening, after actions and every 15 seconds.
- Each player has at most one active contract. Payment, cargo type, pickup ID and destination ID are stored at acceptance; listing rotation and later price changes cannot change that accepted reward or route. There is no delivery deadline.
- The centered row is selected automatically. Scroll wraps across the five listings. Taken jobs are marked **Taken**. While a player has a contract, the center shows their cargo and the action becomes **Abandon**; the first click asks **Confirm?**, the second abandons. Confirmation expires after five seconds.
- Spare display fields show **Unused**. Live pickup screens disable their text when unbound. Board controls require the caller's character; pickup controls require the bound character still inside the zone.
- Pickup offers **Replace** after collection. Confirmation invalidates the previous delivery number before deleting tracked old cargo and issuing a replacement. Copies of superseded/abandoned cargo cannot satisfy the current contract.
- The pickup terminal retains its first owner and hands off to a waiting player on exit. It serializes zone events and uses buffered queue/candidate reads to avoid the previously observed first-entry problem. In-flight pickup operations retain their player until complete, while departure blocks controls immediately.
- `/loadboard` replaces the caller's previous command screen. It closes/deletes that screen after three minutes without player input; passive refreshes do not extend that time. Accepted contracts remain on the central server.
- Duplicate/stale board and pickup mutations are rejected using per-screen/per-station receipt counters. The server serializes requests; repeat delivery events see a completed/inactive job and cannot pay or send another receipt.

## Configuration

The added gold chip marked **Load settings** contains the editable catalogue map and five settings variables. It is beside the central server. Both cargo spawners are inside the user-marked cargo-spawner chip.

Catalogue keys `0` and `1` identify the two initial cargo types. Values are:

```text
Name|Payment|VehicleRule|PickupID|DestinationID|PickupName|DestinationName
```

Defaults:

```text
0 = Cheap Crate|250|1|1|1|Pickup Depot|Delivery Depot
1 = Fuel|400|2|1|1|Pickup Depot|Delivery Depot
```

VehicleRule **1** means Car **or** Truck; **2** means Truck only. Names must not contain `|` or `~`, which separate event fields. Keep names short for the supplied display. Payments must be nonnegative numeric values. This initial compiler supports two cargo definitions and five listing slots; adding another map key alone does not add another supported cargo prefab/type.

Other settings in the same chip:

| Gate position inside chip | Setting | Default |
| --- | --- | --- |
| 0, 0 | Catalogue map | Rows above |
| 48, 0 | Car ownership leaderboard key | CarOwned |
| 96, 0 | Truck ownership leaderboard key | TruckOwned |
| 144, 0 | Currency leaderboard key | Scrap |
| 192, 0 | Minimum replacement-listing lifetime, seconds | 600 |
| 240, 0 | Maximum replacement-listing lifetime, seconds | 3600 |

Lifetime edits affect subsequent random intervals; current timers are not reset by editing settings. Numeric interval minimum is clamped to one second, and maximum is clamped to at least that minimum.

The pickup controller's first two variables are numeric station ID `1` and reply-routing key `Pickup:1`. The delivery controller's first two variables are destination ID `1` and key `Delivery:1`. A new station needs its own ID, matching catalogue route IDs, and a unique reply-routing key. Stations communicate with the server by events; physical detection, buttons and spawner wiring remain local to their station.

When relocating the cargo pad, move its small **Get Own Transform** anchor with it. The spawners calculate their offset to that anchor, including a 35-unit vertical lift. Move the pickup display/controller/player zone together, and the delivery controller/receiving zone together. Do not copy the central server when adding another station or display.

## Saved player fields

The server uses numeric leaderboard stats:

| Key | Meaning |
| --- | --- |
| LoadboardState | 0 inactive; 1 awaiting pickup; 2 cargo issued; 3 pickup pending/retry |
| LoadboardId | Current delivery generation; combined with owner UUID |
| LoadboardSerial | Monotonic generation counter; retained after completion/abandonment |
| LoadboardType | 0 Cheap Crate; 1 Fuel |
| LoadboardPay | Accepted reward snapshot |
| LoadboardPickup | Accepted pickup ID |
| LoadboardDestination | Accepted destination ID |
| LoadboardListing | Original listing slot plus one; zero for older contracts |
| LoadboardRule | Accepted qualifying-vehicle rule |

Ensure your gamemode persists these stats: enable **Persist All Player Stats** or include the keys in its persistent-stat list. No existing vehicle configuration fields are reset or changed. Native cargo properties are `LB.Owner`, `LB.Id`, and `LB.Destination`; payment comes from the server's saved contract, never from the crate.

Controller-joined events refresh the UUID-to-PlayerState cache. Opening a board or using pickup also refreshes it. After replacing/re-pasting the server while players are already connected, reopen `/loadboard` before delivering an older active cargo. The model tests restore saved contracts and owner lookup; physical cargo/custom-property survival across actual world save/reload still needs in-game validation. Replacement can issue a fresh generation if old cargo is lost.

Payment and completion use separate native gates, not a database transaction: normal duplicate events are guarded, but a hard shutdown between completion marking and currency increment is not an atomic financial transaction. Offline owners are not paid from a stale player reference and their cargo is not consumed; retry delivery after the owner reconnects/registers.

## Event interface

All events use the `LB1.` namespace.

`LB1.Request` is global. Data fields:

1. PlayerState (null for cargo-driven delivery)
2. Reply target object (portable board root; null for stations)
3. Operation: 0 read, 1 accept, 2 abandon, 3 collect/replace, 4 spawn result, 5 deliver, 6 rotate listing
4. Listing index for boards; numeric pickup/destination ID for station operations
5. Expected listing revision or pickup delivery-generation ID
6. Station reply-routing key
7. Cargo entity for spawn results/delivery
8. Request counter

The central server replies with object-scoped `LB1.Reply` when a target exists; otherwise global `LB1.StationReply` carries the station key, player and counter for filtering. Replies contain target, player, station key, counter, status, five packed row names, packed detail fields and an authorization/result code. Ordinary screens never authorize their own contracts or payouts.

`LB1.BoardInit` is object-scoped: Data1 PlayerState, Data2 containing object/root, Data3 **destroy on idle**. The command sets Data3 true. A future in-vehicle terminal must initialize with **false**, so idle closes its UI rather than deleting the vehicle. This client can be reused by such a terminal, but the actual vehicle-side binding/initializer is not included in this first command-screen implementation.

The server's timed inbox drains snapshot queues one request at a time. It uses native Queue Ticks for argument snapshots and tick buffers around native query results/variable publication. Heartbeat-driven queue dispatch avoids racing simultaneous requests against a newly set busy variable.

## Rebuild and checks

```sh
node tools/prefabs/reskin-loadboard.cjs 'Loadboard needs updating.brz' prefabs/loadboard-system.brz
```

The original v5 baseline can be generated separately with `build-loadboard.cjs`. The current customized assembly uses `test-reskin-loadboard.cjs` preservation checks; details are in LOADBOARD-DISPLAY-UPDATE.md.

`test-loadboard.cjs` validates the baseline’s exact serialized nodes/wire endpoints for the main assembly, client and both embedded cargo assets. It executes the actual generated graph with immediate and one-tick-delayed native-query/variable publication. Cases cover eligibility, simultaneous exclusive acceptance, one active load, authorization/stamping, wrong destinations, replacement, abandonment, stale listings, failed spawning, duplicate pickup/delivery requests, one payout/chat receipt, catalogue edits, saved fields, actual client/station event communication, caller-only controls, first-entry pickup binding, owner handoff, confirmation, reconnect registration, command replacement and non-destructive vehicle UI expiry.

The model supplies native player/property/spawn results. It does not emulate Brickadia physics, actual cargo placement/orientation, transport handling, rendering, native timer implementation or real world persistence. Those remain in-game checks; no geometry preview is used.

## Parsing regression and placement update

The screenshot after `/lbclearinit` shows packed `|`/`~` records rendered as long strings. Inspection found every load-board String Split explicitly configured with Occurrence 0, while the working mechanic/dealership gates use Occurrence 1. The helper now uses 1 for both catalogue parsing and client response parsing. The previous model incorrectly ignored Occurrence; it now models one-based selection and a regression confirms 0 breaks catalogue decoding. Serialized occurrence settings and rendered client row/requirement values are asserted. Main server logic, eligibility and payouts are otherwise retained.

The full-system builder defaults to client chip position (40,0,0), with containing bounds expanded. This matches the diagnostic that no longer crashed. The rendering fix still needs in-game validation. Existing gates/diagnostics are not retroactively updated by rebuilding the package: remove the old server and use one updated copy.

## In-game results after parsing/placement fixes

The user confirmed the normal `/loadboard` command no longer crashes. They then reported:

- Scrolling works.
- Accepting assigns the load to the player; abandonment works.
- Payment, Car / Truck versus Truck requirements, Pickup Depot and Delivery Depot display correctly.
- Pickup terminal UI appears to work correctly.
- Delivering cargo from pickup to receiver produces the private Delivery Complete +250 Scrap message.
- The previous build kept abandoned listings Taken until rotation. The current build returns the original abandoned offer immediately; completed deliveries still wait for normal listing rotation.

The report confirms a delivery receipt, not an independently measured Scrap balance delta. Actual balance change, active-contract clearing after delivery, native timer rotation over 10–60 minutes, and multiplayer contention still need explicit in-game confirmation. Offline models cover those logic paths but are not substitutes for the native checks.
