# Upgrade shop — separate settings and logic chips

This is a layout-only revision of the working flat-iterator version.

- Green **PARTS + REFUND** chip: the editable PartsCatalog map and the existing
  trade-in refund variable. These are its only two logic/data gates. Labels
  identify each. The default refund remains 0.75 (75%); 0.50 means 50%.
- Blue **SHOP LOGIC** chip: the generated compiler and added upgrade logic.
- Existing menu/player-selection chips and the Apply Catalog button remain.

The catalog format is unchanged:

```text
CarOwned.Engine.0 = Stock Engine|CarEngine|0|0
```

Edit catalog entries in the green chip, then press Apply Catalog as before.
The refund variable is wired directly to the existing refund calculation.
There is no duplicate inactive refund gate left behind; the former label
inside the old shop now points to the settings chip.

The generator uses import-menu's optional relocation hook to place the original
refund gate in the settings grid while retaining all original wire references
through World-builder handles. The catalog moves to that grid as well. Both
chips are ordinary microchips; no failing callable boundary is reintroduced.

Validation confirms the settings grid has four bricks (map, refund variable,
two labels), catalog entries are unchanged, refund is 0.75, and the complete
source-type/source-port/target-type/target-port wire multiset matches the working
flat version exactly: 649 wires. The added physical chip/labels pass placement
checks, and explicit-stat purchase tests pass. In-game confirmation of the
relocated ordinary-chip references is still required.

Output totals: 491 bricks, 474 components, six grids, twelve maps.

Rebuild after npm ci:

```sh
node build-upgrade-shop-v4.cjs /path/to/latest-original-menu.brz ../../prefabs/vehicle-upgrade-separated-chips.brz
node test-upgrade-shop.cjs ../../prefabs/vehicle-upgrade-separated-chips.brz
```

Source uploads remain local and unmodified; the exported prefab is standalone.
