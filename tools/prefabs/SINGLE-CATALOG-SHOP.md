# Vehicle upgrade menu — single editable catalog

This is a separate test prefab derived from the user's supplied menu. It
retains the original menu layout, player-bound controls, ownership checks,
upgrade leaderboard keys and 75% trade-in policy. The source is not modified
or published. The output has 408 bricks, 391 components and 506 wires.

## Edit it in-game

1. Open the added green CATALOG microchip below the original board.
2. Edit the String-to-String Map Variable beside the green `PartsCatalog →`
   label. This is the only configuration map to edit.
3. Enter `VehicleID.Category.Position` as the key and `Name|Price` as the value.
4. Close the chip and press APPLY CATALOG.
5. Select/reselect a vehicle and test the menu.

Examples:

| Key | Value |
| --- | --- |
| CarOwned.Engine.0 | Engine Stock\|0 |
| CarOwned.Engine.1 | Engine Economy\|100 |
| CarOwned.Engine.2 | Engine Race\|250 |
| CarOwned.FuelTank.0 | Fueltank Stock\|0 |
| CarOwned.FuelTank.1 | Fueltank Medium\|75 |

Use whole nonnegative prices without `Scrap`. Names cannot contain `|`; vehicle
IDs and categories cannot contain `.`. Number options consecutively from 0.
Vehicle/category spelling is case-sensitive. Keep existing keys stable after
players purchase them. Display names and prices may change.

The existing 16 names/prices are copied into the catalog. The source typo
`TruckWheelDistnace3` is normalized to `TruckWheelDistance3`; its stored zero
price is deliberately retained as `TruckOwned.WheelDistance.3 = Wheel Distance
7.5|0`. Change that value if the option should cost Scrap.

## What Apply does

A native ForEachArray microchip iterates the sorted catalog keys, parses each
row, and regenerates the old lookup tables: vehicle prefixes, category counts,
category ordering, option limits, names and prices. Those old maps still exist
as generated caches and are labeled accordingly; do not maintain them manually.
An internal seen-category map is also generated. The selector's master vehicle
list is rebuilt from the catalog's vehicle IDs and the current player is
rescanned using the existing selector logic.

Suffix `Owned` is removed from a vehicle ID to preserve legacy upgrade keys:
`CarOwned.Engine.1` still uses leaderboard key `CarEngine`, value 1. Existing
player progress is therefore compatible with the original naming convention.
Categories follow sorted key order. New vehicles still need their existing
ownership/acquisition systems and actual vehicle prefabs; catalog rows configure
this upgrade menu. A new category's absent leaderboard value defaults to 0;
put its stock option at 0, or initialize a different value in vehicle acquisition.

Apply must be pressed after editing. Until then the last applied caches remain
in use. Do not edit the generated lookup maps. Missing active lookups or a
malformed catalog row disable buying. The display shows `Catalog error` for
invalid configuration and `Select a vehicle` before player binding. The visible
Scrap price now follows the net charge after the trade-in refund.

Consecutive indices are checked by the offline data validator. The in-game
parser checks key structure, nonempty fields, nonnegative whole indices/prices
and separators, but does not globally prove that there are no index gaps or
legacy concatenated-key collisions. A missing option fails the active lookup
guard and cannot be bought. Avoid ambiguous vehicle/category concatenations.

## Validation

`catalog-data.cjs` tests schema parsing, category/option derivation and invalid
data. `catalog-model.cjs` separately executes the actual generated compiler
graph, including its foreach body, map reads/writes, parsing and branch paths.
It checks the carried-over catalog, a new TowTruck vehicle/category, a renamed
and repriced part, and malformed/negative/extra-separator cases against the
independent compiler. This is an offline graph model, not Brickadia execution.

Export checks decode all grids, components and wires, enforce unique input
sources and verify the map count. No claim is made that native loop behavior,
in-game wire acceptance or purchase execution has been tested in the game.
Test a fresh copy alongside the original. Verify a rename/reprice, Apply,
new option, affordability, trade-in, installed-state display and another player.

## Rebuild

From this directory after `npm ci`:

```sh
node catalog-data.cjs
node build-catalog-shop.cjs '/path/to/Vehicle upgrade menu selector.brz' ../../prefabs/vehicle-upgrade-single-catalog.brz
```

`import-menu.cjs` rebuilds the supplied menu through the World builder and
preserves its microchip links/wires while replacing stale literal references
with the actual wire sources. The source prefab is needed only for generation;
the exported prefab is standalone. Cached player name, balance and selection
are reset so the new copy does not advertise the previous session.
