---
description: "State machines for menus, pause and game over: inState, onEnter, onExit, despawnOnExit."
---

# States

Menus, pause, game over and level transitions are a **state**: a resource that holds one value from
a fixed list, with run conditions for gating systems on it.

```ts
// src/data.ts
/** Which screen the game is on. */
export const Screen = state(['menu', 'playing', 'paused', 'gameover'], 'menu')

// src/main.ts
  .init(Screen)
  .add(Fixed, runIf(inState(Screen, 'playing'), chain(PlayerMove, Movement, Collide)))
  .add(Update, runIf(onEnter(Screen, 'menu'), ShowMenu), runIf(onExit(Screen, 'menu'), HideMenu))
```

The initial value defaults to the first in the list.

## Reading and changing it

```ts
res.get(Screen).current          // 'menu'
res.get(Screen).previous         // the value before the last transition, or null
res.get(Screen).is('paused')
res.mut(Screen).set('playing')   // applies at the start of the next frame; the last set() wins
```

Setting a value that isn't in the list throws with the list. Setting the current value cancels a
pending transition.

## Conditions

| Condition | True |
|---|---|
| `inState(S, v)` | While the state is `v` |
| `onEnter(S, v)` | On the first frame after `v` is entered |
| `onExit(S, v)` | On the first frame after `v` is left |
| `stateChanged(S)` | On the first frame after any transition |

"First frame" means one fixed step when the condition is checked in `Fixed`, with the same edge rule
as `Input.pressed`, so an `onEnter` system in `Fixed` runs exactly once even on frames with several
steps. The initial value counts as entered on frame 1. Use these conditions in `Update`, `Fixed` or
`Late`; `Startup` runs before frame 1.

Combine them with any other condition: `runIf(inState(Screen, 'playing'), runIf(not(onEnter(Screen,
'playing')), Spawner))`.

## Despawn on exit

Entities that belong to one state are spawned with `despawnOnExit`, and are despawned when that value
is left:

```ts
/** Builds the level whenever play starts. */
export const SpawnLevel = system(({ commands }) => {
  const player = commands.spawn(Player, { at: origin })
  commands.add(player, despawnOnExit(Screen, 'playing'))
  for (const at of coinSpots) commands.spawn(Transform({ ...at }), IsCoin, despawnOnExit(Screen, 'playing'))
})

// src/main.ts
  .add(Update, runIf(onEnter(Screen, 'playing'), SpawnLevel))
```

With level entities spawned this way, a restart is just `gameover` → `playing`: leaving `playing`
cleared the old level and entering it again builds a new one.

## A menu, end to end

```ts
export const Menu = system(({ res, events }) => {
  const ui = res.mut(Ui)
  ui.text('menu.title', 'Coin Rush', { anchor: 'center', size: 56 })
  ui.button('menu.start', 'Start', { anchor: 'center', action: 'jump' })
  for (const c of events.read(UiClick)) if (c.id === 'menu.start') res.mut(Screen).set('playing')
})

export const HideMenu = system(({ res }) => res.mut(Ui).clear('menu.'))

// src/main.ts
  .add(Update, runIf(inState(Screen, 'menu'), Menu), runIf(onExit(Screen, 'menu'), HideMenu))
```

See [HUD and UI](../plugins/ui) for buttons and `UiClick`.
