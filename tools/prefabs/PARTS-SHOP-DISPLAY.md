# Parts shop on the new PC display

`prefabs/parts-shop-new-display.brz` rewires the supplied working parts shop into the compact PC and keyboard marked in `Old Shop that needs Rewiring to New Shop.brz`.

## Controls and displays

- Selected Car Up/Down browses owned vehicles. The middle highlighted vehicle is selected automatically; there is no separate Select button.
- Part Up/Down browses the options within the selected category.
- Part Left/Right changes categories.
- Buy/Installed purchases or trades the selected option using the existing parts-shop calculation and leaderboard keys/values.
- Bind connects the player to the menu. Existing bound-player restrictions are preserved; raw button presses are filtered for a non-null interacting character before entering the old control circuit.

The marked fields show the owned-vehicle list, part name, full part price, net transaction price, and installed/buy status. The keyboard Buy/Installed button also shows that status. The top readout combines player name and Scrap. Presentation strips `Owned` from visible vehicle IDs while leaving their saved/backend identifiers unchanged. The indicator decal is green while bound and red while unbound.

All eight replacement buttons have independent math-blend gates driving their text decals' LineHeight from Held. The resting sizes are preserved: six navigation labels shrink from 1.5 to 1, the Buy/Installed label from 1 to 0.65, and the bind symbol from 3 to 2. Releasing a button restores its original size; its physical brick is unchanged.

The copied purchase success/failure emitters are connected to the existing transaction outcomes. As requested, the copied Sold Vehicle emitter is retained but unconnected.

## Retained configuration and cleanup

The editable parts catalogue, refund percentage, generated caches, cache rebuilding, purchase validation, and per-player leaderboard backend are retained. The configuration chip and the three required logic chips are placed behind the new PC for access. This is the parts-shop logic; it does not use the dealership's vehicle buy/sell transactions.

The old large display and controls, manual Select chain, old animation chip, old internal display labels, obsolete sound bricks, and other unreachable components are removed. The original upload contained 584 bricks; the new prefab has 477 including its four chip bricks. In total 144 old bricks are removed, and 33 new functional gates are added. The retained PC and keyboard keep their original geometry, colors, materials, decal orientation, and resting text sizes. Paste bounds are recalculated around the remaining PC and accessible chips.

## Rebuild and validation

```sh
node tools/prefabs/rewire-parts-shop-display.cjs '/path/to/Old Shop that needs Rewiring to New Shop.brz' prefabs/parts-shop-new-display.brz
node tools/prefabs/test-upgrade-shop.cjs prefabs/parts-shop-new-display.brz
```

The builder checks automatic centre-row selection, all eight held blends, the saved per-player purchase key/value lookup connections, catalogue/cache retention, all 743 saved wire endpoints and unique input targets, new-layout geometry, and the unconnected sale sound. The purchase-model and installed-check regression tests also pass. In-game validation is pending.

## Three-minute timeout and idle blanking

Use `prefabs/parts-shop-3-minute-timeout.brz` for the version with automatic shutdown. After **180 seconds of inactivity**, it clears the bound player and disables the screen readouts and non-bind keyboard text. The bind symbol and red/green indicator remain visible, so the PC can be activated again. Binding restores the display.

Each of the eight accepted controls independently resets the timer. Navigation/purchase activity uses the shop's existing bound-player guards; rejected input from another player does not reset it. Purchases and catalogue rebuilding prevent expiry and restart the countdown when processing finishes. A queued expiry rechecks current activity and processing state before unbinding. No ownership, part configuration, or Scrap is changed by expiry.

This patch adds 31 gates inside the existing logic chip. Catalogue settings, keyboard blends, sounds, and the existing purchasing backend are retained.

```sh
node tools/prefabs/add-parts-shop-timeout.cjs prefabs/parts-shop-new-display.brz prefabs/parts-shop-3-minute-timeout.brz
node tools/prefabs/test-upgrade-shop.cjs prefabs/parts-shop-3-minute-timeout.brz
```

Checks cover the 180-second boundary, all eight activity reset paths, long purchases and catalogue rebuilds, queued-expiry cancellation, fourteen display-enable connections, and valid unique saved wire endpoints. The purchase-model and saved key/value/installed-check regression checks pass. In-game validation is pending.

## Button label length

`prefabs/parts-shop-compact-button.brz` limits the Buy/Installed button's text and interaction prompt to nine characters, the length of Installed. Known labels are Buy, Installed, … (updating), Error (catalogue error), and Bind (select a vehicle). Longer status messages are retained on the separate status display. A final nine-character substring cap protects against future longer labels. The timeout, screen blanking and held-size blends are retained.

Rebuild with `node tools/prefabs/compact-parts-shop-button.cjs prefabs/parts-shop-3-minute-timeout.brz prefabs/parts-shop-compact-button.brz`. Label cases and the saved length cap are checked.
