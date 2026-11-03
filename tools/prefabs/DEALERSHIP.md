# Vehicle dealership

Download `prefabs/vehicle-dealership-unified.brz`. This is a replacement dealership menu built from the user's supplied physical layout, with new logic rather than the mechanic's category/replacement system.

## Use

1. Bind yourself with the original blue button.
2. Browse with the list's up/down buttons. The highlighted middle vehicle is immediately active; there is no Select button.
3. Use the single action button at the former Buy button position. It shows **Buy** for an unowned vehicle and **Sell** for an owned vehicle.
4. The single price display shows **Buy Price: X Scrap** or **Sell Price: X Scrap**, matching that action. Sell Price includes installed upgrade resale.

Buying checks funds and sets ownership. Selling credits the total sale price, clears ownership, and resets the configured upgrade scores to zero. The button and quote refresh automatically after each completed transaction. If funds are insufficient, Buy stays available and the status explains the failure.

The redundant Sell control and second price text are removed; their panel backing is retained. The existing spawning system is untouched, and an already spawned vehicle can remain.

Only the bound player can browse, transact, or apply settings. Another player can bind with the blue button when the menu is idle. Controls are locked and show Updating/Calculating during valuation and transactions. There is no extra confirmation step.

The action displayed at click time is latched before rechecking ownership. If another system changes ownership meanwhile, a Buy click cannot unexpectedly become a sale (or vice versa); it fails and refreshes the button instead.

## Green configuration chip

The green chip contains **two editable maps**, the upgrade resale percentage, an Apply Catalog button, and a maintenance/debug display. The blue chip contains the dealership logic. No generated lookup maps need editing.

### Vehicle catalogue

Key: the exact ownership leaderboard score name.

Value: `Display Name|Owned Value|Buy Price|Base Sell Price`

| Key | Initial value |
| --- | --- |
| `CarOwned` | `Car\|1\|1000\|600` |
| `TruckOwned` | `Truck\|1\|1500\|900` |

Enter ordinary `|` separators in game (the table escapes them for Markdown). Ownership zero means unowned. Buying sets the configured positive ownership value; selling sets zero. Base sell prices start at 60% of the user-specified buy prices and can be changed independently. Prices must be nonnegative whole numbers, with base sell price no greater than buy price.

### Upgrade resale catalogue

Key: `OwnershipScore.UpgradeScore`

Value: `SavedValue:OriginalPrice|SavedValue:OriginalPrice|...`

Initial entries retain the non-stock prices and saved IDs from the supplied mechanic catalogue:

```text
CarOwned.CarEngine         = 0:0|1:100|2:250|3:500
CarOwned.CarFuelTank       = 0:0|1:75|2:200
TruckOwned.TruckEngine     = 0:0|1:150|2:350|3:600
TruckOwned.TruckWheelDistance = 0:0|1:0|2:100|3:0|4:350
```

Each listed upgrade score is reset to **0** when that vehicle is sold. Include **every score you want reset** here; the game does not provide this circuit with a way to discover other vehicle configuration keys. Additional colours, tanks, or other configuration scores must be added explicitly, with their saved values and prices. A configuration with no resale value can list each supported saved value at price zero.

Saved IDs may be sparse, such as `0:0|5:250|9:500`. Use each ID once. Zero represents stock/default and always contributes no upgrade refund, preventing the base vehicle and stock configuration being valued twice. Thus the old Wheel Distance 0 option's mechanic purchase price of 50 is not refunded as a stock upgrade.

The resale percentage starts at `0.75`. Each installed nonzero upgrade contributes `floor(original price × percentage)`, matching the mechanic's rounding. The total is added to the vehicle's base sell price. Keep these prices aligned with the mechanic's configuration; the two prefabs do not synchronize themselves.

Bind and press Apply Catalog after editing to refresh immediately. Binding, browsing, and transactions also reload the live configuration; Apply never changes the bound player. Prices and ownership are rechecked on each transaction.

## Removed and retained

The rebuild removes the old category selector, part selection, installed-part/replacement-cost logic, runtime cache compiler, all eleven generated caches, unused category/part arrows, and old logic chips. The remaining two chips hold configuration and dealership logic. The physical menu backing and shared price/action displays are retained; Select and redundant action/price text are removed. The debug display reports invalid vehicle settings, unsafe upgrade score keys, and installed nonzero values absent from the resale catalogue. These failures stop all transaction writes.

The initial build contains **316 bricks versus 549** in the source, a reduction of about **42%**. It uses 268 logic gates and 483 wires. Upgrade rows are processed with buffered ticks, so controls are briefly locked during valuation/reset; there is no continuous polling.

## Rebuild and validation

```sh
node tools/prefabs/build-dealership.cjs /path/to/source.brz prefabs/vehicle-dealership-unified.brz
```

The builder runs an offline evaluator of the generated circuit and repeats its behavior checks using components and wires read back from the serialized prefab. Tests cover buy/sell, upgrade payouts and resets, repeat transactions, binding and blocked controls during processing, current balance checks, configurable prices/percentages/sparse IDs, malformed data, and preservation of spawned-state scores and the other player's data. Every saved wire endpoint is checked, and input targets must be unique. Prefab pivot metadata is retained. In-game testing is still required.

## Button input handling

The click signal combines Held and the valid player identity before producing an execution edge, supporting either propagation order. Busy remains a separate execution guard so releasing the transaction lock cannot retrigger a held button. Tests cover both input orders and repeat the behavior checks on the saved circuit. Scrolling uses increment instructions and snapshot reads rather than feeding a live index calculation back into its own setter. A single index drives the highlight and the transaction target.
