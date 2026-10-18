---
description: "KilnError, the common errors and their fixes, and every error code."
---

# Errors

Every error Kiln throws is a `KilnError` with a stable `code` and a message that reads "what
happened. What to do." The CLI prints them as `error <code>: <message>`, and `--json` output carries
the code. Most of the time the right move is to do what the message says.

```ts
import { KilnError } from 'kiln'

try { app.step() } catch (err) {
  if (err instanceof KilnError && err.code === 'not-ready') await app.ready()
}
```

An exception thrown inside a system that isn't a `KilnError` is wrapped as `system-threw`, with the
system's name and phase in the message and the original as `cause`.

## The common ones

| Error | Fix |
|---|---|
| `A and B both take Mut(T) in Fixed with no order` | `chain(A, B)` or `B.after(A)` |
| `X wrote T.f, but its query takes T read-only` | `Mut(T)` in X's query |
| `X called entity.destroy() during Fixed` | `commands.despawn(entity)` |
| `X wrote Score.value through res.get(Score)` | `res.mut(Score)` |
| `X wrote T.f on the copy entity.get() returns` | Write through the row, or `entity.set(T, {...})` with `Mut(T)` |
| `app.step() ran while an async plugin is still loading` | `await app.ready()` (scenarios do it) |
| `No trait named "X"` (kiln run) | Check `kiln describe`; names come from exports |
| `TickTimers and X both take Mut(Timer)` | `X.after(TickTimers)` |
| `'x' is not a value of this state` | Use one of the listed values, or add it to `state([...])` |
| `Saves needs the save plugin` | `.use(savePlugin({ resources, traits, persist }))` |
| `Ui.click('x'): there is no button 'x'` | The button isn't set yet (step first) or the id differs |
| `AnimateSprites and X both take Mut(SpriteAnimator)` | `X.before(AnimateSprites)` (3D: `.before(AnimateModels)`) |
| `No animation param 'x'` / trigger / state | Declare it in the graph's `params` / `triggers` / `states` |
| `Animation state 's' plays clip 'c', which ... doesn't have` | Set the state's `clip` to one of the listed clips |

## All codes

### Schedule

| Code | When |
|---|---|
| `write-conflict` | Two systems in one phase take `Mut(T)` with no order between them |
| `unknown-order-target` | `.after(X)` / `.before(X)` where `X` isn't in the same phase |
| `cycle` | Ordering constraints form a cycle (the message prints it) |
| `duplicate-system` | A system was added to a phase twice |
| `not-a-phase` | `app.add()` without a phase first |
| `not-schedulable` | `app.add()` got something that isn't a system, chain or entry |
| `not-a-plugin` | `app.use()` got something that isn't a plugin or function |
| `not-initable` | `app.init()` got something that isn't a resource or event |

### Access (dev builds)

| Code | When |
|---|---|
| `readonly-write` | A system wrote a trait its query takes read-only |
| `undeclared-write` | `entity.set(T, ...)` without `Mut(T)` in the system's queries |
| `write-to-copy` | A write to the copy `entity.get(T)` returns |
| `readonly-resource` | A write through `res.get(R)` |
| `structural-in-system` | `entity.add`, `entity.remove` or `entity.destroy` inside a system |
| `world-write` | A write through the read-only `ctx.world` |
| `app-in-system` | `app.spawn`, `app.set` and friends called inside a system |

### App lifecycle

| Code | When |
|---|---|
| `not-ready` | Stepping before async plugins finished |
| `disposed` | Using an app after `dispose()` |
| `too-many-apps` | More than 16 live apps (dispose the ones you're done with) |
| `headless-render` | `app.render()` on an app that hasn't started on a canvas |
| `system-threw` | A system threw a non-Kiln error |
| `pending-entity` | `PendingEntity.get()` before commands applied |
| `no-input-plugin` | `app.input` without the input plugin |

### States, timers, tweens, UI, saves

| Code | When |
|---|---|
| `unknown-state`, `empty-state` | A state value not in the list, or a state with no values |
| `not-an-event` | `Delayed.emit` without an event |
| `tween-args`, `tween-field`, `unknown-ease` | Bad `Tweens.to` arguments |
| `ui-id`, `ui-anchor`, `no-button` | Bad HUD ids or anchors; clicking a missing button |
| `no-save-plugin`, `save-slot`, `save-corrupt` | Saves without the plugin; a bad slot name; unreadable slot data |

### Assets, rendering, physics

| Code | When |
|---|---|
| `asset-missing` | A path that isn't in `public/` |
| `unknown-instanced` | `Instanced(key)` with no `defineInstanced(key, ...)` |
| `no-render-plugin` | `RenderSync` scheduled in an app without the render plugin |
| `physics-not-ready` | Physics used before the plugin loaded |
| `no-body` | A `Physics` call on an entity without a body (bodies appear the step after `RigidBody` is added) |

### Animation

| Code | When |
|---|---|
| `graph-empty`, `graph-param`, `graph-event` | A malformed `animationGraph` |
| `graph-unknown-state`, `graph-unknown-param`, `graph-unknown-trigger` | The graph names something it doesn't declare |
| `anim-unknown-state`, `anim-unknown-param`, `anim-unknown-trigger` | An animator call names something the graph doesn't declare |
| `anim-unknown-clip` | A state plays a clip the sheet or model doesn't have |
| `anim-frame-event` | A frame event on a glTF clip (use `{ at: seconds }`) |
| `anim-no-clips`, `anim-model-failed` | A 3D animator with nowhere to get clips, or a failed model |
| `sprite-clip`, `sprite-frame`, `sprite-grid`, `sprite-no-sheet`, `not-a-sheet` | Malformed sprite sheets and animators |

### Recordings

| Code | When |
|---|---|
| `not-a-recording`, `recording-version` | The file isn't a Kiln recording, or is from another version |
| `record-after-boot`, `replay-after-boot` | A `Recorder` or `Replayer` created after Startup ran |
| `replay-config` | Replaying on an app with a different loop config |
| `replay-diverged` | A `strict` replay's state stopped matching |
| `recorder-stopped` | `stop()` called twice |

### CLI

| Code | When |
|---|---|
| `no-entry`, `bad-entry` | `src/main.ts` missing, or not default-exporting a function that returns the app |
| `unknown-trait`, `unknown-resource`, `unknown-event` | A name passed to `--snapshot`, `--resources` or `--events` doesn't exist |
| `bad-script` | A malformed input script event |
| `no-recording` | `kiln replay` without a file, or with a missing one |
| `no-chromium` | `kiln shot` can't find a browser |
| `shot-file`, `shot-setup`, `shot-seed` | `kiln shot` with a missing `--setup`/`--input`/`--recording` file, a setup module without a default export, or `--seed` alongside `--recording` |
| `unknown-plugin`, `plugin-exists` | `kiln add` with an unknown name, or over an existing folder |
| `missing-dir`, `not-empty` | `kiln new` without a folder, or into a non-empty one |
