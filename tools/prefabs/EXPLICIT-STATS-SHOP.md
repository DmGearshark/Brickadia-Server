# Upgrade shop — explicit player-stat catalog

A separate prefab based on the user's latest menu export. The visible menu,
ownership filtering, player binding and navigation are retained. Catalog
resolution and purchase identity now distinguish display positions, saved
values and exact leaderboard keys. The source menu is unchanged and excluded
from publication.

## Edit one map

Open the green CATALOG chip, edit the map beside `PartsCatalog →`, then press
APPLY CATALOG and reselect the vehicle.

```text
KEY:   VehicleID.Category.DisplayPosition
VALUE: Name|LeaderboardKey|SavedValue|ScrapPrice

CarOwned.Engine.0 = Stock Engine|CarEngine|1|25
CarOwned.Engine.1 = Race Engine|CarEngine|5|250
CarOwned.Color.0  = Blue|CarColor|3|50
CarOwned.Color.1  = Purple|CarColor|4|50
```

These are explanatory examples. The shipped catalog carries over all sixteen
existing options, their prices and their original saved values, including
stock value 0 where present. It does not migrate player scores or assume that
stock must be 1. The known WheelDistnace spelling error is corrected while its
stored zero price is retained.

- Display positions run consecutively from 0. Only these control menu order.
- Saved values can be nonconsecutive whole integers, including zero. They
  must match the vehicle's existing configuration logic.
- Leaderboard keys are literal, case-sensitive player-stat keys. They must
  already be configured in the game mode. They are not inferred from part names.
- Every option in one category uses the same leaderboard key and a unique
  saved value. Duplicate values or mixed keys disable purchases on Apply.
- Prices are nonnegative whole Scrap amounts. Scrap is reserved for currency
  and cannot also be selected as a vehicle configuration key.
- Names and key fields cannot contain the `|` separator. Vehicle/category
  identifiers cannot contain `.`. Keep category and vehicle identifiers stable.

The automatically generated lookup maps remain internal caches. Only the
catalog is edited. The selector's master vehicle list and category/option
limits are regenerated on Apply, as in the previous prototype.

## How a purchase works

The exact stat key is looked up for the selected category. The selected menu
position separately resolves its desired saved value and price. The shop reads
that stat for the bound player and compares the current value with the desired
saved value for Installed status.

Reverse lookups map `(vehicle/category, current saved value)` to the old option's
price and display position. This restores the correct highlight and computes
the existing 75% rounded-down trade-in refund. The UI displays the net charge.
The purchase deducts that player's Scrap, then sets that player's explicit
leaderboard key to the selected saved value. It never writes the menu position
as a configuration value merely because it was selected.

An unlisted current player value is a configuration error; no refund is
guessed. Include the real stock/default state in the catalog. A newly configured
vehicle still needs its ownership/acquisition and vehicle-reading logic outside
this shop. Apply does not change existing player data to new defaults.

Ready flags block buying while selected/installed data is refreshing. A busy
flag blocks repeated purchase events until refresh or rejection completes.
This is serialized gate logic, not a database transaction or rollback feature.

## Verification

Output: 473 bricks, 456 component instances, 623 wires, six grids. There are
twelve map gates: one editable catalog and eleven generated/internal maps.

The independent catalog parser and actual generated compiler-graph model check
initial data, newly added vehicles/categories, nonconsecutive saved values,
renames/reprices, malformed rows, duplicate values, mixed stat keys and reserved
currency keys. Serialized wires are checked for single-source inputs. New grid
placements are checked for cuboid overlap using 1x1 native gate envelopes.

The purchase specification model checks explicit values (e.g. position 1 saves
5), player isolation, Installed/no-charge, insufficient funds and unknown current
values. A separate saved-wire check confirms that SetLeaderboardValue.Key and
Value are fed by the explicit stat/value lookup gates, that the stat read shares
the same key, and that Installed compares the saved value.

These are offline model, wiring and serialization checks. Native foreach
execution, connection acceptance, player interaction and actual purchases are
not verified until tested in-game. Test a fresh copy beside the original with
a known player configuration, sufficient/insufficient funds, a trade-in, and
another player. Leave the original menu available until this is verified.

## Rebuild

After `npm ci`, from this directory:

```sh
node catalog-data-v2.cjs
node build-upgrade-shop-v2.cjs /path/to/latest-menu.brz ../../prefabs/vehicle-upgrade-explicit-stats.brz
node test-upgrade-shop.cjs ../../prefabs/vehicle-upgrade-explicit-stats.brz
```

The original menu is needed for generation only. The output prefab is standalone.
