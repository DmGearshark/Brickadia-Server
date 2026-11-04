# Load-board command crash isolation

The user reports a game crash immediately after `/loadboard` in the first assembled system. No crash log or confirmed failing native gate is available. The earlier identity/property and receiving-zone probes passed, but they did not exercise the new command dispatcher, client payload or initialization path.

Use **one fresh** `prefabs/loadboard-command-isolation.brz`. Do not call the original `/loadboard`. Run commands one at a time; stop at a crash/failure and report the last command and whether an object appeared. Avoid clicking the spawned screen's controls during this startup test.

| Command | Stage | Expected result |
| --- | --- | --- |
| `/lbcheck` | Direct command PlayerState -> Get User ID -> private chat | Player lookup passed and the user's ID |
| `/lbshell` | Spawn only the reference screen geometry | A static labeled screen by the diagnostic rig, no controller/buttons |
| `/lbclient` | Spawn the complete portable client without initialization | A separate client body; its screens remain disabled |
| `/lbrotate` | Rotate that client to the caller's horizontal yaw | Rotation returned; still no initialization |
| `/lbinit` | Send object-scoped BoardInit to that client | It binds and requests listings from an existing central server |

The first four commands can run without the central load server. For `/lbinit`, keep one existing full-system copy present to test the server exchange too. If no server is present, the client should eventually show its timeout state; report that circumstance with the result. The full system's original command remains installed but must not be invoked during this diagnostic.

The shell and client spawners each permit one object and expire their objects after 180 seconds. Use a new isolated copy if repeating after failure, removing the old diagnostic rig to avoid duplicate command listeners. These fixed spawn pads deliberately bypass the original in-front-of-player coordinate calculation and map-based previous-board replacement.

Interpretation:

- Shell spawning fails/crashes: investigate the reference geometry/assets or spawn operation.
- Shell works but uninitialized client fails/crashes: investigate client components, graph construction and instantiation.
- Only rotation fails/crashes: investigate Set Entity Rotation and its input/native entity support.
- Only initialization fails/crashes: investigate BoardInit, client queues and the ensuing server request/reply.
- All commands succeed: investigate the omitted original queue/map dispatcher, replacement logic or position calculation. This alone would not prove a production fix.

The diagnostic command controller uses the older wallet-style circuit helper, with no QueueTicks, maps, heartbeat, automatic rotation or automatic initialization. The unmodified full client still contains its normal queue gates, which are part of what this test isolates. The diagnostic itself writes no leaderboard values; an initialized live client can submit real actions if clicked, so do not accept/abandon jobs during this boot test.

Generate and validate:

```sh
node tools/prefabs/build-loadboard-command-isolation.cjs 'Loadboard v5.brz' prefabs/loadboard-command-isolation.brz
```

Offline checks verify exact serialized endpoints, shell contents, embedded client preservation, and independent execution reachability of the stages. They do not determine the native crash cause or establish that another command cannot crash.
