---
description: "Timer, Lifetime, Delayed events and Tweens, all counted in fixed steps."
---

# Timers and tweens

Both are in `CorePlugins`, and both count fixed steps, so they are deterministic and behave the same
headless and in the browser.

## Timers

```ts
commands.spawn(Timer({ duration: 2 }), IsBomb)                   // one-shot
commands.spawn(Timer({ duration: 0.5, repeat: true }), IsSpawner) // repeating
commands.spawn(Transform, Bullet, Lifetime({ seconds: 1.5 }))     // despawns itself

/** Bombs go off when their timer runs out. */
export const Explode = system([Timer, IsBomb], ([t], { commands, entity }) => {
  if (t.justFinished) commands.despawn(entity)
})
```

`Timer` fields:

| Field | Set or read | |
|---|---|---|
| `duration` | set | Seconds |
| `repeat` | set | Restart on completion |
| `paused` | set | Hold the timer |
| `ticks`, `elapsed`, `remaining` | read | Progress, in steps and seconds |
| `finished` | read | Stays true once a one-shot completes |
| `justFinished` | read | True for exactly one fixed step per completion |
| `count` | read | Completions so far |

`justFinished` is a `Fixed`-step edge. `Update` systems should read the `TimerFinished` event
(`{ entity, count }`) instead, which every reader sees once.

To restart a timer, take `Mut(Timer)` and call `restartTimer(row)`. Any system that takes `Mut(Timer)`
must be ordered after the plugin's `TickTimers`:

```ts
.add(Fixed, Rearm.after(TickTimers))
```

`Lifetime({ seconds })` despawns the entity that many seconds after it spawned. Bullets, effects
and popups are the usual users.

## Delayed events

```ts
res.mut(Delayed).emit(3, RoundStart, { round: 2 })   // emitted in Fixed, 3 s of steps from now
res.mut(Delayed).cancel(RoundStart)                  // drop pending ones (or all, with no argument)
res.get(Delayed).timeLeft(RoundStart)                // seconds until the next one, or null
```

Pending delayed events survive snapshots when the event is a named export.

## Tweens

```ts
const tw = res.mut(Tweens)
tw.to(entity, Transform, { y: 2, sx: 1.5 }, { duration: 0.4, ease: 'outBack' })
tw.to(pending, Transform, { sx: 1, sy: 1, sz: 1 }, { from: { sx: 0, sy: 0, sz: 0 }, delay: 0.1 })  // right after commands.spawn
tw.to(e, Transform, { y: 1 }, { duration: 0.3, yoyo: true, repeat: -1 })   // bob forever
tw.to(e, Transform, { sx: 1.3 }, { duration: 0.1 }).then(e, Transform, { sx: 0 }, { duration: 0.2, despawn: true })
tw.to(res.mut(Fade), { alpha: 1 })                                          // plain objects (resources) too
```

Any trait's number fields work, on entities and on `PendingEntity` values from `commands.spawn`.
Tweens tick in `Fixed`; rendering interpolates `Transform` between steps, so they still look smooth.

| Option | Default | |
|---|---|---|
| `duration` | `0.3` | Seconds per run |
| `ease` | `'outQuad'` | An `ease` name or a function of 0..1 |
| `delay` | `0` | Seconds before it starts; start values are read when it starts |
| `repeat` | `0` | Extra runs; `-1` forever |
| `yoyo` | `false` | Alternate direction on each repeat |
| `from` | | Start values, written at once (even during the delay) |
| `tag` | `''` | Carried by `TweenDone` so readers can tell tweens apart |
| `despawn` | `false` | Despawn the entity when the tween (and its `.then` chain) finishes |

Eases: `linear`, and `in`, `out` or `inOut` with `Quad Cubic Quart Sine Expo Back Elastic Bounce`
(`'inOutSine'`, `'outBounce'`, ...). The functions are exported too: `ease.outBack(t)`.

A newer tween on the same fields takes them over. `tw.cancel(target, trait?)` stops tweens and leaves
values where they are; `tw.isTweening(target, trait?)` checks. `TweenDone` (`{ id, tag, entity }`)
fires when a tween finishes all its repeats.
