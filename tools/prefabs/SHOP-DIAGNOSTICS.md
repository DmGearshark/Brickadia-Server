# Upgrade shop — maintenance diagnostics

This revision adds diagnostics to the working separated-chip version. The
catalog format, green Parts + Refund settings chip, blue Shop Logic chip,
buffered iterator, refund setting and purchase identity remain the same.

## Where to read an error

Open the green **Parts + Refund** chip. A small display below the editable
catalog/refund gates shows the first invalid entry and a reason. It starts
blank/disabled. No large diagnostic text is inserted into the player's Buy
display. The original short player-facing status remains.

Example:

```text
CarOwned.Engine.2
Price must be a whole number >= 0
```

Apply clears the prior diagnostic. The first invalid row encountered is saved,
even if later rows are also invalid. Fix that row and Apply again. A successful
Apply leaves the stored diagnostic empty. No player binding is needed to see
an invalid catalog row.

Covered catalog issues:

- Malformed Vehicle.Category.Position key or invalid display position.
- Missing/extra value separators; expected Name|LeaderboardKey|SavedValue|Price.
- Empty display name or empty leaderboard-key field.
- Scrap used as an upgrade key instead of the currency key.
- Non-integer saved value.
- Negative/non-integer/unparseable price.
- Different leaderboard keys within one category.
- Duplicate saved values within one category.

When the menu is bound and finished loading, the same maintenance display can
also identify missing vehicle/category/option lookups or an unlisted current
player value, such as `Unlisted player value: CarEngine = 99`. Those messages
are derived from live lookup flags rather than overwriting the stored first
catalog error. The display is blank during an Apply or data refresh.

The prefab cannot inspect the game mode's registered stat-name list, so it
does not prove that a nonempty key such as CarEngine is registered or spelled
correctly there. Position gaps still fail when the missing option is selected;
this does not add a whole-catalog contiguity pass. Prices/values follow the
existing parser rules. This change does not introduce atomic/staged cache
updates: an invalid Apply still disables buying until corrected and reapplied.

## Validation

The compiler graph model verifies the exact first-entry/reason text for nine
invalid cases, multiple-error first retention, and clearing a previous error
on valid Apply. Valid catalogs, new vehicles/categories and nonconsecutive saved
values still match the independent catalog compiler. The explicit-stat purchase
model and saved purchase-key/value wiring checks pass.

The settings chip still contains exactly two editable data gates (catalog and
refund); the diagnostic is a text display. New settings/logic placements pass
enclosing-box intersection checks. Serialized wire inputs remain single-source.

Output: 532 bricks, 515 components, 728 wires, six grids, twelve maps. Actual
in-game connection acceptance and diagnostic rendering are not yet verified.

Rebuild after npm ci, from this directory:

```sh
node build-upgrade-shop-v5.cjs /path/to/latest-original-menu.brz ../../prefabs/vehicle-upgrade-diagnostics.brz
node test-upgrade-shop.cjs ../../prefabs/vehicle-upgrade-diagnostics.brz
```

Original uploads remain private and unchanged. The output prefab is standalone.
