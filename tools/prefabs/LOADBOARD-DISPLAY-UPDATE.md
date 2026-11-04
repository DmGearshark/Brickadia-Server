# Updated spawnable display

`prefabs/loadboard-system.brz` now comes from the uploaded **Loadboard needs updating.brz**. The `/loadboard` command embeds and spawns the new display case, back panel, title, colors and text styling from that file.

The updater uses the **existing embedded client logic** in the uploaded assembly. It does not regenerate the server or replace the user's pickup/delivery/configuration layout with the old v5 reference. The main assembly's only component edit is the command spawner's Prefab path. All its physical bricks, saved component configuration/state, entity transforms/palettes and serialized wire endpoints are preserved.

The display was placed with a half-turn in the saved world. Extraction normalizes that placement into the existing client's local frame using Brickadia's discrete orientation matrices, without mirroring the design. The existing row, detail and button connections map to corresponding display slots. The new `Loadboard.` title stays as supplied and receives the existing bound-player visibility condition. The spare detail slot remains Unused.

The placeholder empty chip attached to the display reference is not included in the spawned case. The actual working logic chip remains at the confirmed clear position (40,0,0), preventing the previous close-packed layout from being reintroduced. The embedded cargo prefabs are retained byte-for-byte, and the old embedded client is replaced rather than left as an unused dependency.

## Use

Replace the old central assembly with **one** updated copy and run `/loadboard` to create a fresh display. Already spawned old screens are not hot-swapped; remove/dismiss them or let their idle lifetime expire. Normal acceptance, abandonment, pickup, delivery and payment behavior is preserved.

## Rebuild

```sh
node tools/prefabs/reskin-loadboard.cjs 'Loadboard needs updating.brz' prefabs/loadboard-system.brz
```

Generation runs `test-reskin-loadboard.cjs`. It validates:

- Main scene geometry, component data/state, entity transforms/colors and every wire remain identical, allowing only the new command-spawner path.
- Other embedded assets remain byte-identical.
- All prior client logic components, data and wire connections remain intact; only title visibility adds a new connection.
- New geometry, materials, colors, text styling and orientation match the supplied display after placement normalization.
- Exactly one clear-position logic chip is included; the close placeholder chip is excluded.

These are saved-file preservation checks. The new appearance still requires the user's in-game check; no geometry preview was generated.
