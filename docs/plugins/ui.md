---
description: "The HUD as retained data: text, bars, buttons, UiClick, and testing it headless."
---

# HUD and UI

The HUD is retained data in the `Ui` resource: text, bars and buttons keyed by id. In the browser it
is drawn as DOM over the canvas; headless the same data exists, so tests can assert on it and press
its buttons.

```ts
/** Score and health in the corners. */
export const UpdateHud = system(({ res }) => {
  const ui = res.mut(Ui)
  ui.text('score', `Score ${res.get(Score).value}`)                       // top-left by default
  ui.bar('hp', hp / maxHp, { anchor: 'bottom-left', label: 'HP', color: '#f55' })
})
```

Setting an element to the value it already has costs nothing, so it's fine to set them every frame.
Put HUD systems in `Update`.

## Elements

| Call | |
|---|---|
| `ui.text(id, text, options?)` | A text element |
| `ui.bar(id, value, options?)` | A progress bar, `value` 0..1 (clamped) |
| `ui.button(id, label, options?)` | A button; clicking it emits `UiClick { id }` |
| `ui.show(id, visible)` | Hide or show without removing |
| `ui.remove(id)` | Remove one element |
| `ui.clear(prefix?)` | Remove every element whose id starts with `prefix` (all, with none) |
| `ui.get(id)` | The element as data (`UiNode`), or undefined |

Options:

| Option | Default | |
|---|---|---|
| `anchor` | `'top-left'` | `top-left top top-right left center right bottom-left bottom bottom-right` |
| `size` | `20` (buttons `22`) | Font size in CSS pixels |
| `color` | `'#fff'` (bars `'#4ade80'`) | Text colour, or a bar's fill |
| `order` | creation order | Stacking order inside the anchor |
| `visible` | `true` | |
| `label`, `width` | | Bars: text beside the bar, width in pixels (200) |
| `action` | | Buttons: an input action that also clicks it while visible |

## Menus

```ts
/** The title screen. */
export const Menu = system(({ res, events }) => {
  const ui = res.mut(Ui)
  ui.text('menu.title', 'Coin Rush', { anchor: 'center', size: 56 })
  ui.button('menu.start', 'Start', { anchor: 'center', action: 'jump' })
  for (const c of events.read(UiClick)) if (c.id === 'menu.start') res.mut(Screen).set('playing')
})
```

Prefix ids by screen (`menu.`, `pause.`) so `ui.clear('menu.')` removes one screen. The `action`
option makes the button work from the keyboard or a gamepad. Pair menus with
[States](../concepts/states).

## In tests

```ts
expect(app.res(Ui).get('score')?.text).toBe('Score 3')
app.res(Ui).click('menu.start')    // UiClick arrives on the next step
app.step(1)
```

Clicking an id that isn't a button (not set yet, or misspelled) throws with the fix. `kiln shot`
clips the page rather than the canvas, so the HUD is in the screenshot. Real clicks in the browser
are recorded, so [replays](../testing/recordings) reproduce them.
