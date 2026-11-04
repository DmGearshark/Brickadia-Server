# Client-construction crash isolation

The user identified `/lbclient` as the crashing command in the startup isolation test. That command spawns the full client without initializing it. Rotation, BoardInit and the ensuing request/reply are not needed to trigger this observed failure. The exact native component or connection responsible is still unknown.

Use one fresh `prefabs/loadboard-client-isolation.brz`. Run only these new commands, one at a time, stopping at a crash:

| Command | Spawned variant |
| --- | --- |
| `/lbchip` | Screen geometry plus its chip containing one ordinary variable. No button components or wires. |
| `/lbgates` | All original client components, including buttons and four Queue Ticks gates, with every wire removed. |
| `/lbnoqueue` | Original client with exactly the four Queue Ticks bricks and their incident wires removed. All other components and connections retained. |

These variants are construction diagnostics, not usable load boards. Do not click controls or initialize them. They do not send server requests, rotate themselves, accept loads or pay money. The existing central server can remain, but is not required for this round. Do not run `/loadboard` or `/lbclient` again while diagnosing.

Report which commands spawned a body without crashing and the first that crashed. If a command crashes, stop; do not proceed through the remaining commands just to force more crashes. Each diagnostic spawner has a limit of one and a 180-second lifetime. Use one diagnostic copy to avoid duplicate command listeners.

Interpretation remains conditional:

- Chip baseline fails: investigate nested-chip construction/attachment or retained geometry rather than the full controller.
- Full disconnected client fails: a component/asset, serialized property or component interaction can fail without signal propagation.
- Disconnected client works but connected no-queue client fails: investigate retained connections/dataflow; Queue Ticks is not required for that failure.
- No-queue client works while the original connected client fails: Queue Ticks or its connected paths become the leading suspect, not a proven engine-level cause.

The builder clones the original full client, removing saved variable-reference caches and rebuilding retained wires through the existing BRZ writer. The shell and ordinary variable baseline preserve the chip link. Offline checks compare component inventories and every retained endpoint against the original: chip 15 components/0 wires; all gates 172 components/0 wires; no queue 168 components/238 wires. The no-queue asset table also excludes the Queue Ticks brick asset.

The command controller uses the existing wallet-style helper and has no queue/map dispatcher, initialization sender or rotation gate. The wallet builder now exports its existing helper functions; its behavior is unchanged.

```sh
node tools/prefabs/build-loadboard-client-isolation.cjs 'Loadboard v5.brz' prefabs/loadboard-client-isolation.brz
```

No in-game outcome for these three variants has yet been reported. These serialization checks cannot establish runtime safety or a completed fix.
