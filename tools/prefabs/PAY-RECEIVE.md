# Shop transaction text

`prefabs/vehicle-upgrade-pay-receive.brz` updates the user's latest shop layout with explicit transaction text:

- Positive net cost: `Pay -300 Scrap`
- Negative net cost: `Receive +25 Scrap`
- Zero net cost: `No Scrap cost`

The action remains `Buy` for both payments and refunds. The existing installed-part state and purchase calculations are preserved.

The patch preserves the original bricks, catalog maps, and prefab metadata, adding six expression gates inside the existing logic chip. Original price-text consumers use the new formatted output; the balance display is unchanged.

Regenerate from the latest source prefab with:

```sh
cd tools/prefabs
node format-shop-prices.cjs /path/to/latest-menu.brz ../../prefabs/vehicle-upgrade-pay-receive.brz
node test-upgrade-shop.cjs ../../prefabs/vehicle-upgrade-pay-receive.brz
```

The generator checks positive, negative, and zero formatting, original geometry and catalog preservation, and unique wire targets. Purchase model and saved key/value wiring checks also pass. In-game validation is pending.

## Full part price display

`prefabs/vehicle-upgrade-part-price.brz` uses the user's subsequent `Modify Me.brz` layout. The new display reads `Part Price: {A} Scrap`, using the selected option's catalog price before subtracting the trade-in refund. The existing Pay/Receive display and Buy behavior are retained.

Rebuild with `node add-part-price.cjs /path/to/Modify-Me.brz ../../prefabs/vehicle-upgrade-part-price.brz` from `tools/prefabs`. This adds one formatter and two wires. Geometry, saved formatter connections, unique wire targets, and purchase wiring were checked; in-game validation is pending.
