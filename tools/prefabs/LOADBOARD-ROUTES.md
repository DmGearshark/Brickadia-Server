# Catalogue-driven routes and reusable stations

The loadboard uses centralized cargo, location and route catalogues. Five shared offer slots choose independently from all configured routes with equal probability. Duplicate offers are allowed. Each generated offer rolls and stores an inclusive whole-number payout; accepting it snapshots that payout and route so later rotations or catalogue edits cannot change the contract.

## Load Settings chip

The configuration layout follows `references/diagnostic-customizable-menu.brz`: editable gates and their explanations occupy the left side, while the large right panel is a live diagnostic display. The example Vars and Arrays from the reference are replaced by the actual maps and settings.

### Vehicle Catalogue

```text
Leaderboard Key = Display Name|Minimum Owned Value|Capability

CarOwned   = Car|1|1
TruckOwned = Truck|1|2
```

Capability `1` qualifies for ordinary cargo. Capability `2` qualifies for ordinary and heavy cargo.

### Cargo Catalogue

```text
Cargo ID = Display Name|Required Capability

0 = Cheap Crate|1
1 = Fuel|2
```

Cargo IDs are whole numbers. A new cargo needs one entry here and a matching fixed Spawn Prefab gate in the master pickup template. After updating the master, replace existing pickup copies with it and retain each location's Pickup ID.

### Pickup and Destination Catalogues

```text
Pickup ID = Visible Name
1 = Pickup Depot

Destination ID = Visible Name
1 = Delivery Depot
```

IDs are permanent whole numbers stored in player assignments. Visible names can be edited without changing routes or station gates.

### Route Catalogue

```text
Cargo ID|Pickup ID|Destination ID = Minimum Payout|Maximum Payout

0|1|1 = 250|250
1|1|1 = 400|400
```

An entry authorizes exactly that cargo, origin and destination combination. Equal minimum and maximum values produce a fixed payout. Otherwise the server rolls an inclusive whole-number payout when the offer is generated. Every entry has equal selection probability; the same entry may occupy multiple offer slots.

### Other settings

- **Payout Key** selects the leaderboard score incremented on delivery (`Scrap` by default).
- **Minimum Rotation** and **Maximum Rotation** select the randomized lifetime of newly generated offers.
- **Validate Catalogues** scans every route. The diagnostic panel reports the first invalid route or the number of valid routes.

Validation checks route structure, numeric cargo/pickup/destination IDs, existing catalogue references, cargo name and requirement, nonnegative whole-number payouts, `Min <= Max`, and vehicle requirement `1` or `2`. Invalid generated routes are displayed as unavailable configuration errors rather than becoming contracts.

## Reusable station workflow

Pickup and delivery controllers each expose one location-specific numeric ID. Their global reply key is derived automatically as `Pickup:<ID>` or `Delivery:<ID>`.

To add a pickup:

1. Duplicate the current master pickup display, zone, controller and complete cargo-spawner bank.
2. Change its Pickup ID.
3. Add that ID and visible name to the Pickup Catalogue.
4. Add the allowed routes.

To add a destination:

1. Duplicate the current master destination zone and controller.
2. Change its Destination ID.
3. Add that ID and visible name to the Destination Catalogue.
4. Add the allowed routes.

No payout, route, cargo-name or vehicle rules are stored in station copies. Pickups authorize against the player's server assignment and activate only the fixed spawner matching its Cargo ID. Destinations accept only cargo stamped for their ID and assignment generation.

## Offer and assignment lifecycle

- Accepting marks the current slot Taken and stores its slot generation in `LoadboardOfferRevision`.
- The slot timer continues while Taken.
- Abandoning before that generation rotates restores the same offer and payout without rerolling it.
- Abandoning after rotation clears the assignment without overwriting the newer offer.
- Delivering before rotation pays the saved amount and immediately generates a replacement in that slot.
- Delivering after rotation still succeeds, but cannot replace or alter a newer offer.
- Active assignments have no delivery deadline and remain independent from board rotation.

The authority queue remains event-driven while idle. Request snapshots, publication buffers, duplicate suppression, cargo ownership stamping, private payment chat, local confirmation sounds and wireless delivery audio are retained.

The Load Settings chip uses coarse `PB_DefaultTile` rows for its catalogue labels, live diagnostic readout, validation button and editing notes. This follows the supplied customizable diagnostic-menu layout while using the same native-safe tile construction as the other logic chips. Press **Validate Catalogues** after editing to scan every configured route.

## Rebuild and validation

```sh
git show 6674025b7dd07eb948dad955f1e92bf5f5f26ef4:prefabs/loadboard-system.brz > /tmp/loadboard-before-routes.brz
node --max-old-space-size=512 tools/prefabs/upgrade-loadboard-route-system.cjs /tmp/loadboard-before-routes.brz prefabs/loadboard-system.brz
node --max-old-space-size=512 tools/prefabs/test-loadboard-route-system.cjs /tmp/loadboard-before-routes.brz
```

The tests serialize and reread every component and wire, reject instantaneous cycles and idle polling, preserve embedded display/cargo assets, and execute route generation, new cargo IDs, restoration, expired abandonment, delivery payment/refill and invalid-catalogue diagnostics.
