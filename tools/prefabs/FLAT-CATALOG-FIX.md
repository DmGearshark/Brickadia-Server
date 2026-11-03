# Apply Catalog fix: flat buffered iterator

The user's unchanged in-game re-export showed the catalog still contained all
16 rows, but the generated maps were empty after Apply. The nested foreach
reported 16 iterations. Its MapVar_Get reported bFound=false with an invalid
reference, and all eleven MapVar_Set reference wires were missing. Six getter
reference wires were also lost. Nine gates in the callback grid had disappeared
during placement. These observations supersede the prior offline model's
assumption that direct references across a callable boundary were usable.

The new build removes the nested callable entirely. The catalog, readers,
parsers and writers share the ordinary catalog microchip. A buffered index
iterator reads one key, processes its row, advances and reads the next key on
the following tick. End-of-array triggers completion. No callable boundary is
involved. Newly generated gates use 48-unit placement spacing rather than
12-unit spacing to accommodate gate shapes that may expand in the game.

Apply is guarded against reentry. Buying is disabled while rebuilding, and
option-ready state is cleared until the post-build reads finish. The selector
refreshes its latched player's existing reference; Apply no longer executes
the player-binding setter with the original button's possibly empty signal.
On a fresh copy, activate the original user/player button to bind yourself.

The original catalog entry format and explicit stat/value logic are unchanged.
The output has 488 bricks, 471 components, 649 wires and five grids. The source
and error re-export remain private and unmodified.

The catalog graph model now supports the actual array-read, increment and
buffer path. It checks initial/new/invalid catalog cases. Its buffer executes
synchronously in the offline model, so it does not establish native timing.
The explicit purchase model and saved endpoint tests pass. Actual in-game
placement, wire acceptance and Apply results remain unverified.

Rebuild from this directory after npm ci:

```sh
node build-upgrade-shop-v3.cjs /path/to/latest-menu.brz ../../prefabs/vehicle-upgrade-flat-catalog.brz
node test-upgrade-shop.cjs ../../prefabs/vehicle-upgrade-flat-catalog.brz
```

Use a fresh copy. Bind the player through the original user button, press and
release Apply, wait for rebuilding/rescanning, and check the owned vehicle list.
If it still fails, re-export that copy rather than deleting any generated maps.
