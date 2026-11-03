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
