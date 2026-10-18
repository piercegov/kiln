---
description: "What Kiln is, what agent-first means, and how the pieces fit."
---

# Introduction

Kiln is a thin game runtime for TypeScript: a fixed-step loop, an ECS built on
[Koota](https://github.com/pmndrs/koota), and a bridge that draws the ECS with
[Three.js](https://threejs.org). Its users are coding agents first and people second. Every design
choice is aimed at one loop: an agent changes a few files, asks Kiln whether the change is right,
and gets a precise answer without opening a browser.

## What "agent-first" means here

**A feature is a handful of exports.** Data is a `trait`, behaviour is a `system`, and the whole
schedule lives in one file, `src/main.ts`. Adding a feature means adding exports and one line in
the schedule. There is no class hierarchy to extend and no registration scattered across files.

**Names come from exports.** `export const Movement = system(...)` is called `Movement` in errors,
in `kiln describe`, in snapshots and in the generated docs. Moving code between files changes
nothing. See [Project layout](./project-layout#names-come-from-exports).

**Access is declared and checked.** A system says which traits it writes with `Mut(T)`. Everything
else in its query is read-only, so writing it is a compile error, and in dev builds a runtime error
that names the fix. The scheduler uses the same declarations to reject two systems that write one
trait with no order between them. See [Systems](../concepts/systems) and
[The schedule](../concepts/schedule).

**Errors name the fix.** Every error Kiln throws is a `KilnError` with a stable `code` and a message
that reads "what happened. What to do." For example:

```
error write-conflict: PlayerMove and Knockback both take Mut(Velocity) in Fixed with no order. Put them in chain() or add .after().
```

**Everything runs headless.** Core never imports Three.js. Tests step an exact number of fixed
frames under `bun test` with scripted input, and the same seed plus the same input gives the same
world. An agent "sees" the game as JSON (`kiln run --snapshot`), and only takes a screenshot
(`kiln shot`) when the change is visual.

**The CLI is built for tool calls.** Short, parseable output, `--json` on every command, and errors
printed as `error <code>: <message>`. See [CLI](../reference/cli).

## The pieces

| Layer | Where | Imports Three.js? |
|---|---|---|
| Core: app, loop, ECS wrapper, schedule, events, states, snapshots, recordings | `packages/kiln/src/core` | No (enforced by a test) |
| Plugins: render, input, assets, timers, tweens, UI, camera, save, animation, physics, debug | `packages/kiln/src/plugins` | Some |
| Tooling: CLI, Vite plugin, Bun preload, scenario runner | `packages/kiln/src/{cli,tooling,test}` | No |
| Community plugins, copied into a game by `kiln add` | `packages/kiln/community` | Yes |

The runtime is Bun for the CLI, tests and scripts, and Vite for the browser. Three.js is pinned to
0.186.1 and rendering uses `WebGPURenderer` with a WebGL2 fallback.

## How it compares

If you know [Bevy](https://bevyengine.org), Kiln will feel familiar: plugins, resources, events,
phases, `run_if`-style conditions, states and commands all work much the same way, in TypeScript.
Kiln is smaller and stricter. It has no parallel executor, and it spends that simplicity on startup
validation, headless determinism and tooling an agent can call.

## Next

- [Getting started](./getting-started): create a game and run it.
- [Working with agents](./agents): the loop an agent follows and the files it reads.
- [Design notes](../design): how the implementation maps to the design doc, and why.
