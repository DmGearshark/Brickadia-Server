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

The initial build contains **317 bricks versus 549** in the source, a reduction of about **42%**. It uses 269 logic gates and 484 wires. Upgrade rows are processed with buffered ticks, so controls are briefly locked during valuation/reset; there is no continuous polling.

## Rebuild and validation

```sh
node tools/prefabs/build-dealership.cjs /path/to/source.brz prefabs/vehicle-dealership-unified.brz
```

The builder runs an offline evaluator of the generated circuit and repeats its behavior checks using components and wires read back from the serialized prefab. Tests cover buy/sell, upgrade payouts and resets, repeat transactions, binding and blocked controls during processing, current balance checks, configurable prices/percentages/sparse IDs, malformed data, and preservation of spawned-state scores and the other player's data. Every saved wire endpoint is checked, and input targets must be unique. Prefab pivot metadata is retained. In-game testing is still required.

## Button input handling

The click signal combines Held and the valid player identity before producing an execution edge, supporting either propagation order. Busy remains a separate execution guard so releasing the transaction lock cannot retrigger a held button. Tests cover both input orders and repeat the behavior checks on the saved circuit. Scrolling uses increment instructions and snapshot reads rather than feeding a live index calculation back into its own setter. A single index drives the highlight and the transaction target.

## Compact display version

`prefabs/vehicle-dealership-new-display.brz` moves the confirmed working unified dealership into the user's labeled `New Display ref.brz` case. The five-row list, selected vehicle/status, shared Buy/Sell price, and shared action use their marked display bricks. Name and Scrap are combined into the top readout. The original blue square button binds the player.

Two wired scroll buttons sit outside the left side of the case; move them wherever desired. The configuration and logic chips sit outside the right side for access. Settings and business logic are retained from `vehicle-dealership-unified.brz`; only display routing and the balance text format change. The static Vehicle Catalog header and all original case geometry remain. Font/sound asset indices are remapped so the reference's font is retained.

Rebuild and run the transplant checks with:

```sh
node tools/prefabs/rehouse-dealership.cjs prefabs/vehicle-dealership-unified.brz '/path/to/New Display ref.brz' prefabs/vehicle-dealership-new-display.brz
```

The checks compare every saved connection against its expected endpoints, compare all copied logic/settings component data, preserve every reference brick's geometry, and confirm Held and Character are connected for both external scroll buttons. This adds one player-readout formatter and one wire; the result has 484 wires. Visual and interaction validation in game is pending.

## Stuck-update repair

Use `prefabs/vehicle-dealership-refresh-fixed.brz` for the user's latest saved layout. Its transaction-completion-to-refresh connection was absent in the uploaded in-game save (483 wires rather than the 484 emitted for the compact display). The repair reconnects completion to refresh through a one-tick buffer and clears the saved busy flag and pending transaction mode. It preserves the user's geometry, relocated buttons, and editable settings. Bind yourself again after pasting.

The readback checks compare every original and repaired connection by grid, position, component, and port, confirm the busy flag is false, and verify execution loops cross a buffer. The shared generator and `vehicle-dealership-unified.brz` now also include the buffered completion path, so future display transplants inherit the fix. Offline transaction checks pass; this repaired copy still needs in-game validation.

```sh
node tools/prefabs/repair-dealership-refresh.cjs '/path/to/Stuck in Update.brz' prefabs/vehicle-dealership-refresh-fixed.brz
```

## Three-minute inactivity timeout

`prefabs/vehicle-dealership-3-minute-timeout.brz` adds automatic unbinding to the repaired current display. The timeout is **180 seconds**. Accepted binding, scrolling, Buy/Sell, and Apply actions restart the countdown; other players' rejected inputs do not. Transaction processing is excluded: the countdown restarts when processing finishes, giving the player a full three minutes after completion.

Expiry clears only the menu's bound player and shows Session expired. The shared price/action return to the bind prompts, and the top player readout becomes `Name: Unbound` with no displayed balance. Ownership, upgrades, and Scrap are not changed. The original binding and transaction guards are retained.

The circuit uses a running stopwatch and the timestamp of the last accepted processing transition. The expiration condition is rechecked after a one-tick buffer, so a queued timeout cannot unbind a player who just interacted or interrupt a transaction. Seventeen gates are added inside the logic chip; the layout and editable catalogue remain as in the repaired save.

```sh
node tools/prefabs/add-dealership-timeout.cjs prefabs/vehicle-dealership-refresh-fixed.brz prefabs/vehicle-dealership-3-minute-timeout.brz
```

Offline checks cover the 180-second boundary, resets, long transactions, a queued timeout followed by fresh activity, the unbound readout, and saved wire endpoints. In-game timing validation is pending.

## Binding indicator decal

`prefabs/vehicle-dealership-binding-indicator.brz` uses the user's latest saved layout. The square `■` text decal is green when the existing bound-player reference is non-null and red when it is null, including after the three-minute inactivity timeout. Only `Component_TextDisplay.Color` is driven; the underlying brick's color and all original geometry are preserved. The patch adds one color-blend gate and two wires and retains the existing shop and timeout logic.

```sh
node tools/prefabs/add-dealership-indicator.cjs /path/to/latest-save.brz prefabs/vehicle-dealership-binding-indicator.brz
```

Readback checks verify the saved decal-color connection, red/green endpoints, unique valid wire targets, and preservation of every original brick's geometry/material/color. In-game validation is pending.

## Blank screen when idle

`prefabs/vehicle-dealership-idle-black-screen.brz` connects the six on-screen text displays' `bEnabled` inputs to the existing bound-player signal. The catalogue header, vehicle list, selected vehicle/status, price, action label, and name/balance readout are disabled while unbound and enabled while bound. The three-minute timeout therefore blanks the screen automatically. The separate red/green indicator and external scroll arrows stay visible.

The patch adds six wires and no gates. Initial screen text components are disabled to avoid showing cached text before binding state propagates. The saved file checks all six enabled connections, preserves the indicator/arrows, and retains all brick geometry and colors. In-game validation is pending.

```sh
node tools/prefabs/blank-idle-dealership.cjs prefabs/vehicle-dealership-binding-indicator.brz prefabs/vehicle-dealership-idle-black-screen.brz
```

## Replacement controls

`prefabs/vehicle-dealership-new-buttons.brz` uses the latest `Update these Buttons.brz` layout and its four marked button prompts. Scroll Down, Scroll Up, Buy/Sell, and Bind Player are rewired to their new physical buttons, including Character and Held signals. The old animated bind button and two standalone scroll buttons are deleted. The former on-screen Buy/Sell button's interaction and text components are removed; its black panel backing remains.

The dynamic Buy/Sell label, prompt, and enabled state now follow the new Buy/Sell button. Existing enabled-state connections for the scroll labels follow the replacement arrows. The indicator, black idle screen, three-minute timeout, catalogue and transaction logic are retained. Instructional Rewire prompts are replaced with normal action labels.

```sh
node tools/prefabs/rewire-dealership-buttons.cjs '/path/to/Update these Buttons.brz' prefabs/vehicle-dealership-new-buttons.brz
```

Checks compare every saved connection with the intended remapping (520 wires), require exactly four public buttons, verify both input signals on each, and preserve the geometry of all retained bricks. In-game validation is pending.
