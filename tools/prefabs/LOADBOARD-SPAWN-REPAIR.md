# Spawn connection repair and event-driven request queues

Built from the user's **needs fixing.brz**, exported after the optimized build reported one unconnectable wire. The returned file retained every component but lacked the command's direct `remember previous entity → Prefab Spawner.Exec` connection. The remember gate reads that spawner's Entity output; connecting its ExecOut directly back to the spawner creates an instantaneous wire feedback cycle. Removing the intervening buffer in the earlier optimization was a mistake. Save/endpoint checks did not detect the engine's cycle rejection.

The repair restores the two-tick Buffer between those gates, matching the previously working command sequence. The source command builder now keeps that boundary in both modes. A new graph check rejects instantaneous component-wire cycles, including a regression case for this exact pair. Typed buffer/queue/timer boundaries are excluded from that instantaneous graph; this check does not claim to duplicate every engine validation rule.

## The 0.1-second pulses

The four old inboxes polled every 0.1 seconds: authority requests, `/loadboard` commands, pickup replies and pickup zone entry/exit. The repaired assembly replaces all four polling handlers while preserving their actual queued payload arrays and processing bodies:

1. Each complete enqueue increments a pending counter and tries the existing busy guard.
2. An idle handler locks before it starts the buffered payload reads.
3. Later enqueues append data and increment the counter while that lock remains held.
4. Completion removes the head record and decrements the counter. If more work remains, a one-tick continuation starts the next record without releasing the lock. Otherwise it unlocks and stops.

The pickup zone's separate enter and exit enqueue paths both update the same counter. The transaction/ownership logic and previously verified first-entry snapshot delays remain unchanged. No 0.1-second Stopwatch remains in the assembly. There is no queue work when idle; listing rotation, active-screen refresh, confirmation and inactivity timers retain their separate purposes.

The counters and busy checks use the immediate ordinary Var updates observed in GP2, while payload queries keep their buffers. The continuation and spawner boundaries also prevent instantaneous execution feedback. Transient inbox arrays/locks are cleared consistently at construction; player stats, configuration, accepted offer records and all other stored fields remain intact.

## Lifetime and preserved assets

The command spawner's **Lifetime = 0** means no fixed spawner expiry. It does not disable spawning. The unchanged embedded client deletes its screen after **three minutes without valid player input**. A fixed Lifetime of 180 would delete a screen after three minutes even if it were still being used, so the spawner's zero is intentional.

Every embedded prefab, including the current portable display and both cargo prefabs, is retained byte-for-byte. Main geometry, client placement/physics/colliders/Fine settings, configuration and unrelated wires/components are preserved. Only queue plumbing, its transient state and the spawn execution boundary are changed. No entity/chip or event protocol is added.

## Validation

The repaired file is reread and every brick/component value, wire endpoint, single input driver and chip link is checked. The tests import the **actual repaired native graph and actual embedded client**, rather than substituting only a fresh compiler model. The versioned `loadboard-0779-layout.json` identifies its known circuit roles by grid role/type/local position; it contains no player data. The model context refuses unknown layouts instead of inventing mappings.

Tests cover immediate/one-tick query publication; normal eligibility, stale/duplicate protection, one active job, replacement, abandonment/re-listing and one payout; real request/reply paths; first-entry pickup ownership and waiting-player handoff; owner-only controls; command spawning/replacement/placement; and the three-minute expiry path. Queue scheduling checks use 40 simultaneous acceptance requests and 36 staggered arrival scenarios around processing/idle transitions. All pending counters, payload arrays and busy flags must drain, and 100 modeled idle ticks must execute no queue work.

These checks pass offline. The exact repaired assembly still needs an engine paste/interaction check, including whether the spawner connection is accepted. GP1–GP3 established useful primitive behavior, not universal guarantees for every rewritten graph.

## Use and reproduction

Replace the old central assembly with **one** repaired copy and remove previously spawned loadboards, then run `/loadboard`. No new display or cargo file installation is needed.

```sh
node --max-old-space-size=512 tools/prefabs/repair-loadboard-spawn.cjs 'needs fixing.brz' prefabs/loadboard-system.brz
```

The repair targets the known 0779 circuit layout as re-exported by the user, verifies the four known queue patterns and restores either a missing spawn connection or its invalid direct counterpart. It also recognizes an already buffered spawn boundary. It is not an arbitrary-prefab migration tool; use it once on the appropriate source. Older optimizer benchmarks do not constitute validation of the rejected direct-spawn wire.
