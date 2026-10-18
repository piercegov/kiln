---
description: "Actions and the Input resource, bindings, and scripted input for tests."
---

# Input

Systems read **actions**, not keys. The `ActionMap` resource maps each action to keys, mouse buttons
and gamepad inputs, and the input plugin polls them into the `Input` resource once per frame.

## Reading input

```ts
export const PlayerMove = system([Mut(Velocity), IsPlayer], ([v], { res }) => {
  const input = res.get(Input)
  v.x = input.axis.x * 5
  v.z = -input.axis.y * 5
  if (input.pressed('jump')) v.y = 6
})
```

| | |
|---|---|
| `axis` | `{ x, y }`: right − left and up − down (or the left stick), length at most 1 |
| `down(a)` | True while the action is held |
| `pressed(a)` | True on the step (in `Fixed`) or frame (elsewhere) it went down |
| `released(a)` | True on the step or frame it went up |
| `value(a)` | Analog value 0..1 (triggers, stick directions); 0 or 1 for keys |
| `pointer` | `x, y` (canvas pixels), `ndcX, ndcY` (−1..1, y up), `dx, dy`, `wheel`, `down` |

`pressed` and `released` are edge-triggered exactly once: once per press in `Fixed`, however many
steps a frame runs, and once per frame elsewhere. A press and release inside one frame still counts.

## Actions

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| `left` `right` `up` `down` | WASD, arrow keys | D-pad, left stick |
| `jump` | Space | A |
| `fire` | Left mouse | RT |
| `alt` | Right mouse | LT |
| `interact` | E | X |
| `sprint` | Left Shift | B |
| `pause` | Escape | Start |

A binding is a `KeyboardEvent.code` (`'KeyW'`, `'Space'`, `'ArrowLeft'`), `'Mouse0'`..`'Mouse2'`, a
gamepad button (`'Pad:A'`, `'Pad:Start'`, `'Pad:Up'`, `'Pad:RT'`, ...) or a stick direction
(`'Pad:LX+'`, `'Pad:LY-'`, `'Pad:RX+'`, ...). Stick input has a 0.15 deadzone.

Add or change actions with `inputPlugin({ actions })` in place of `InputPlugin`, or at runtime
through `res.mut(ActionMap)` (for a rebinding menu):

```ts
inputPlugin({ actions: { ...DEFAULT_ACTIONS, dash: ['KeyQ', 'Pad:RB'] } })
```

## Scripted input

Tests and tools drive input through `app.input`:

```ts
app.input.script([
  { frame: 1, hold: 'right', frames: 30 },   // frames count from the script call; 1 = next frame
  { frame: 10, tap: 'jump' },                // down for one frame
  { frame: 40, press: 'fire' }, { frame: 50, release: 'fire' },
  { frame: 45, press: 'alt', value: 0.5 },   // analog
  { frame: 60, axis: { x: 0, y: 1 } },       // override the move axis; null hands it back
  { frame: 70, key: 'KeyE' },                // a raw key through the action map ({ key, up: true } releases)
  { frame: 80, pointer: { x: 400, y: 300, down: true } },
])
```

Shortcuts take effect on the next step: `app.input.press(a)`, `.release(a)`, `.tap(a)`,
`.setAxis(x, y)`, `.clearAxis()`, `.reset()`.

`kiln run --script input.json` plays a script from a JSON file.

`app.input.record()` records what the game sees as a script (`stop()` returns it, `peek()` copies it
so far), which `script()` replays. Session [recordings](../testing/recordings) use the same idea for
whole play sessions.
