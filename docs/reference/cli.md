---
description: "Every kiln command and option."
---

# CLI

```
kiln <command> [options]
```

The CLI is built for tool calls: short, parseable output, `--json` on every command, and errors
printed as `error <code>: <message>` with the fix in the message. Every command takes `--cwd DIR` to
run against a game in another folder (default: the current directory). Commands that load the game
build it from `src/main.ts` (or `entry` in `kiln.config.ts`) headless.

## describe

```bash
kiln describe [--json] [--no-run]
```

The built schedule: config, plugins, every phase's systems in run order with the traits they write
and read, their resource access, order constraints and run conditions; then every trait with its
storage and defaults, and the resources.

It runs one headless step first so resource access is known; `--no-run` skips the step (and leaves
resource access empty). Schedule errors (write conflicts, cycles, bad order targets) show here.

```
phase Fixed
  3. PlayerMove | writes Velocity | reads IsPlayer | res-reads Input,Screen | if inState(Screen,playing)
  4. Movement | writes Transform | reads Velocity | res-reads Screen | after PlayerMove | if inState(Screen,playing)
```

## test

```bash
kiln test [bun test args]
```

Runs `bun test` in the game folder, over `scenarios/` by default. Other arguments pass through:
`kiln test scenarios/combat.test.ts`, `kiln test --watch`. See [Scenario tests](../testing/scenarios).

## run

```bash
kiln run --steps N [--seed S] [--snapshot Trait,..] [--resources Res,..] [--events E,..]
         [--script input.json] [--every N] [--precision P] [--full] [--pretty]
```

Builds the game headless, runs Startup and `N` fixed steps (default 60), and prints the world as one
JSON line.

| Option | |
|---|---|
| `--steps N` | Fixed steps to run |
| `--seed S` | Override the seed |
| `--snapshot A,B` | Only these traits, and entities with at least one of them |
| `--resources A,B` | Include these resources |
| `--events A,B` | Include every event of these types from the last step call |
| `--script file` | Play an input script (a JSON array of script events) |
| `--every N` | Print one JSON line every N steps instead of one at the end |
| `--precision P` | Decimals (default 4) |
| `--full` | Keep struct fields at their default value |
| `--pretty` | Indent the JSON |

See [Snapshots](../testing/snapshots).

## replay

```bash
kiln replay <recording.json> [--until N] [--every N] [--snapshot Trait,..] [--resources Res,..]
            [--events E,..] [--precision P] [--full] [--pretty]
```

Replays a recorded play session headless on the current code and prints `{ replay, snapshot }`: how
far it played, the first checkpoint that stopped matching (`divergedAt`), whether the end state
matches, and the error if it threw. `--until N` stops after frame `N`; `--every N` prints one line per
`N` frames. Exits 1 if the replay threw. See [Recordings and replay](../testing/recordings).

## check

```bash
kiln check [--json]
```

A determinism lint over `src/`: `Math.random()`, `Date.now()`, `performance.now()` and `new Date()`.
Prints `file:line:col rule message` per finding and exits 1 if there are any. A line containing
`kiln-allow` is skipped. See [Determinism](../concepts/determinism).

## shot

```bash
kiln shot [--steps N] [--seed S] [--setup file.ts] [--input script.json] [--recording rec.json [--until N]]
          [--width W] [--height H] [--webgl] [--timeout ms] [out.png]
```

Serves the game with Vite, opens it in headless Chromium, waits for Startup's asset loads, runs `N`
fixed steps (default 60), renders one frame and saves it (default `shot.png`, 800×600). The image is
clipped to the canvas from the page, so the HUD is included.

To shoot something other than the opening screen, in the order they run:

| Flag | |
|---|---|
| `--recording rec.json` | Replays a [recording](../testing/recordings) from boot, up to frame `--until N` (default: its end). `--steps` defaults to 0 after it, so the shot is the recorded frame |
| `--setup file.ts` | A module whose default export runs on the started app: `(app) => void \| Promise<void>` (type `ShotSetup` from `kiln/browser`). Spawn things, set states and resources, script input, `app.step(n)` |
| `--input script` | An [input script](../plugins/input#scripted-input), as a JSON file or inline (`'[{"frame":1,"tap":"jump"}]'`), queued before the steps |

```ts
// shots/boss.ts
import type { ShotSetup } from 'kiln/browser'
import { Score } from '../src/data.ts'

const setup: ShotSetup = (app) => {
  app.resource(Score).value = 9000
  app.input.tap('pause')      // or app.spawn(...), app.step(30)
}
export default setup
```

```bash
kiln shot --setup shots/boss.ts --input '[{"frame":1,"hold":"right","frames":40}]' boss.png
kiln shot --recording recordings/x.json --until 300 bug.png
```

Prints `ok out.png tick=60 backend=webgpu`, followed by any `console-error` and `console-warning`
lines from the page. `--webgl` forces the WebGL2 backend.

Chromium comes from Playwright's registry, `KILN_CHROMIUM` or `CHROME_PATH`, `PLAYWRIGHT_BROWSERS_PATH`,
or a system Chrome. Install one with `bunx playwright install chromium`.

## docs

```bash
kiln docs [--check] [--guide] [--json]
```

Writes `AGENTS.md`: the Kiln guide at the top, then a generated section for this game (config,
plugins, the schedule as a table, every export with its JSDoc, the scenario names). Anything above
the generated marker is kept; `--guide` replaces it with the current guide. `--check` exits 1 if the
file is out of date. Exports without JSDoc are listed as `note` lines. See
[Working with agents](../guide/agents#agents-md).

## add

```bash
kiln add <plugin> [--force]
kiln add --list
```

Copies a community plugin's source into `src/plugins/<name>/` and prints the line to add to
`src/main.ts`. `--force` overwrites an existing copy. See [Community plugins](../plugins/community).

## new

```bash
kiln new <dir> [--force]
```

Creates a game from the template: config, entry, data/prefabs/systems files, a scenario test, Vite
and Bun setup, and `AGENTS.md`. See [Getting started](../guide/getting-started).
