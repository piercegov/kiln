---
description: "Record play sessions in the browser, replay them headless, and keep them as tests."
---

# Recordings and replay

In dev, every browser session records from boot. When something goes wrong while playing, press
**F8** and the session is saved to `recordings/<name>.json` in the game folder. A crash saves
`recordings/crash-<time>.json` on its own. The recording replays headless, frame for frame, so the
bug can be investigated with the CLI and kept as a test.

## What a recording holds

A recording is everything that reached the simulation from outside, so a replay needs no world
snapshot:

- the seed and loop config (`fixedHz`, `maxFrameDt`, `maxFixedSteps`, `mode`);
- every frame's delta, replayed with `tick(dt)` so the fixed-step accumulator splits frames exactly as
  it did live;
- the input as the game saw it: action values, the stick axis, the pointer. Not raw keys, so devices
  and bindings don't matter;
- side channels plugins noted between frames: DOM HUD clicks, and the frame each asset load
  finished on (a replay holds loads back until that frame);
- the stored saves the session started with;
- a state hash (entities and `Rng`, rounded) every 60 frames, to locate drift;
- the final state, and the error that stopped the session, if one did.

Saving from code: `__kiln_save_recording(name)` in the browser console (or from Playwright) does what
F8 does and resolves to the path. Without a dev server (a production build) the browser downloads the
file instead. Turn recording off with `record: false` in `kiln.config.ts`.

## Replaying it

When a user says "I recorded it", replay it before reading code:

```bash
kiln replay recordings/x.json --snapshot IsPlayer,Transform --resources Score   # end state + summary
kiln replay recordings/x.json --until 300 --events Hit                      # stop where it went wrong
kiln replay recordings/x.json --every 60 --snapshot Health                  # one JSON line per 60 frames
```

The output is one JSON object, `{ replay, snapshot }`:

| `replay` field | |
|---|---|
| `frames`, `of` | Frames played, and in the recording |
| `checked` | Checkpoints compared |
| `divergedAt` | The first checkpoint frame whose state differs from the session, or `null` |
| `endMatches`, `endDiff` | Whether the final state matches the session's, and how it differs |
| `recordedError` | The error the session ended with |
| `threw`, `reproduced` | The replay's own error, and whether it is the recorded one at the same frame |
| `notes` | Anything worth knowing (hot swaps during the session) |

`divergedAt: null` on unchanged code means the headless replay *is* the session. Investigate it with
`--until` (stop just before the problem) and `--events` (see what fired). The command exits 1 if the
replay threw.

## Keep it as a test

Once the bug is understood, keep the recording as a regression test that fails until the fix lands:

```ts
import { expect, replay } from 'kiln-ecs/test'

replay('coin pickup no longer double-counts', 'recordings/double-coin.json', ({ app, result }) => {
  expect(app.res(Score).value).toBe(3)      // the app is live after the last frame: step it, query it
})                                           // a recorded crash re-throws at the same frame
```

After a fix, `divergedAt` is expected: the fixed code produces different state. Input still replays
frame for frame, so assert on the outcome, not on matching the old session. Pass `{ strict: true }` to
fail when a checkpoint differs (for recordings of behaviour that shouldn't change), and `{ until: n }`
to stop early.

`replayApp(recording, { until })` returns `{ app, result, replayer }` to play in pieces:

```ts
const { app, replayer } = await replayApp('recordings/x.json', { until: 300 })
// inspect app at frame 300 ...
await replayer.play(900)
app.dispose()
```

## Drift

These make a replay drift from the browser. Drift shows as an early `divergedAt` on unchanged code:

- reading anything outside `ctx.time`, `Rng` and the input plugin (`Math.random`, `Date.now`, DOM
  state). `kiln check` flags these;
- hot reloads during the session. A system swap is listed in the recording's notes, and the replay
  runs today's code throughout. Saving after a full rebuild isn't possible; reload the page to start
  a fresh recording;
- **physics.** Rapier runs the same WASM in the browser and under Bun, which usually matches, but
  cross-machine determinism is not guaranteed, and `Math.sin`, `cos` and `pow` can differ in the last
  bit between Chrome's V8 and Bun's JavaScriptCore. Long physics-heavy replays can drift.

Read frames before `divergedAt` as exact and frames after it as approximate.

## Plugins with outside input

A plugin that feeds the simulation from outside (not through the input plugin) records that input
itself so replays match. See [Prefabs and plugins](../concepts/prefabs-plugins#plugins-with-outside-input).
