---
description: "Systems swap in place; other changes rebuild or reload, per the hotReload setting."
---

# Hot reload

In the dev server (`bunx vite` with the `kiln()` plugin), saving a file updates the running game. What
happens depends on what the file defines and on `hotReload` in `kiln.config.ts`.

## Systems-only files: swapped in place

A module whose top-level Kiln definitions are all systems (plain constants and helper functions are
fine) accepts its own updates. Each changed system is swapped into the running schedule and **the
world is kept**: the player stays where they were, the score stays, timers keep counting.

The new schedule is validated first. If the swap would create a write conflict or a cycle, the old
system stays and the error shows in the overlay.

This is why the starter keeps systems in their own file. Split `src/systems.ts` as it grows, but keep
each piece systems-only.

## Everything else: rebuild or reload

A change to any other module (traits, resources, events, prefabs, plugins, or `src/main.ts`) reaches
the entry, and `hotReload` decides:

| `hotReload` | What happens |
|---|---|
| `'keep'` (default) | Systems-only files swap in place; anything else reloads the page |
| `'snapshot'` | Systems-only files swap in place; anything else rebuilds the app from the new code and restores a snapshot of the world into it, without running Startup again |
| `false` | Every change reloads the page |

`'snapshot'` matches traits by name, so renamed or deleted traits are reported in the console
(`snapshot traits no longer exist: ...`) instead of silently lost. Three.js objects come across by
reference.

## Errors

A system that throws pauses the loop and shows the error over the canvas; the next successful hot
swap clears it and resumes. In dev, the session that led to a crash is saved as a recording (see
[Recordings and replay](../testing/recordings)).

Hot reload never runs headless. Tests and the CLI build a fresh app every time.
