---
description: "Sprite-sheet and skeletal animation with one graph model, animators and frame events."
---

# Animation

Kiln has two opt-in animation plugins that share one model: an **animation graph** as data, an
**animator** component per entity, and **events** on frames or times.

| Plugin | For | Animator trait | Animation step |
|---|---|---|---|
| `SpriteAnimationPlugin` | 2D sprite sheets | `SpriteAnimator` | `AnimateSprites` |
| `SkeletalAnimationPlugin` | 3D glTF skeletal clips | `Animator` | `AnimateModels` |

Both tick in `Fixed`, like timers and tweens. A `hitFrame` event can therefore drive gameplay
deterministically, and animation state is checkable headless.

## Sprite sheets

```ts
/** The hero's frames: 4x4 grid, numbered left to right, top to bottom. */
export const HeroSheet = spriteSheet({
  texture: 'sprites/hero.png',
  columns: 4, rows: 4,
  size: [2, 2],          // world units of one frame
  pivot: [0.5, 0],       // the Transform sits at the feet
  clips: {
    idle: { range: [0, 3], fps: 4 },
    run: { range: [4, 7], fps: 10 },
    attack: { range: [8, 11], fps: 14, loop: 'once' },
  },
})
```

| Field | Default | |
|---|---|---|
| `texture` | | A path in `public/`, a `THREE.Texture`, or `null` for an untextured quad |
| `columns`, `rows` | | Grid sheets |
| `atlas` | | Atlas sheets: `{ width, height, frames: [{ x, y, w, h }] }` in pixels; frame numbers index `frames` |
| `size` | `[1, 1]` | World units of one frame |
| `pivot` | `[0.5, 0.5]` | Where the Transform sits on the quad, 0..1 from bottom-left |
| `filter` | `'nearest'` | `'linear'` for non-pixel art |
| `color` | white | Tint |

Clips take `range: [first, last]` or `frames: [...]`, `fps` (default 10) and `loop`: `'loop'`
(default), `'once'` or `'pingpong'`.

```ts
app.use(CorePlugins, SpriteAnimationPlugin)
commands.spawn(Transform, spriteAnimator(HeroSheet, { graph: HeroAnim }))
```

The entity gets its quad (`MeshRef`) automatically. Quads own their geometry (UVs per frame) and share
one material per sheet.

## Skeletal (glTF)

```ts
app.use(CorePlugins, SkeletalAnimationPlugin)
commands.spawn(Transform, Model(assets.gltf('models/hero.glb')), animator({ graph: HeroAnim }))
```

Clips come from the entity's `Model`. For a hand-built `MeshRef`, pass `clips` (a glTF handle or an
array of `THREE.AnimationClip`). Each entity gets its own `AnimationMixer`, stopped and uncached on
despawn.

The graph computes crossfade weights and playheads itself, and the plugin writes them into each mixer
action and samples with `mixer.update(0)`, rather than using Three's own fades. So weights are
testable headless and match the graph exactly. Poses are sampled at the fixed rate.

## Animation graphs

```ts
/** States, transitions and events of the hero's animation. */
export const HeroAnim = animationGraph({
  initial: 'idle',
  params: { speed: 0, grounded: true },        // numbers or booleans, with defaults
  triggers: ['attack'],
  fade: 0.15,                                  // default crossfade seconds (3D; sprites switch at once)
  states: {
    idle: {},                                  // plays the clip with the state's name; or { clip: 'Idle_Loop' }
    run: { events: [{ frame: 0, name: 'footstep' }, { frame: 2, name: 'footstep' }] },  // glTF: { at: 0.4, name }
    attack: { loop: 'once', events: [{ frame: 2, name: 'hitFrame' }] },
  },
  transitions: [                               // checked in order each step; the first that holds fires
    { from: ['idle', 'run'], to: 'attack', trigger: 'attack' },
    { from: 'attack', to: 'idle', exitTime: 1 },                   // when the clip has played once
    { from: 'idle', to: 'run', when: { speed: { gt: 0.1 } } },     // gt gte lt lte eq ne, or a value
    { from: 'run', to: 'idle', when: { speed: { lte: 0.1 } } },
  ],
})
```

- A transition can test params (`when`), a trigger, an exit time, or a combination. `'*'` as `from`
  means any state except `to`.
- Triggers last one animation step unless a transition consumes them.
- Without a graph, an animator has one state per clip, switched with `play('run')`.

## Driving it from gameplay

Take the animator with `Mut()` and order the system before the animation step:

```ts
/** Feeds the hero's velocity and attack button into its animation. */
export const HeroControl = system([Mut(SpriteAnimator), Velocity, IsHero], ([anim, v], { res }) => {
  anim.set('speed', Math.abs(v.x))
  if (res.get(Input).pressed('fire')) anim.trigger('attack')
  anim.flipX = v.x < 0                         // sprites only
})

// src/main.ts
  .add(Fixed, HeroControl.before(AnimateSprites))     // 3D: .before(AnimateModels)
```

Animator rows have:

| | |
|---|---|
| `set(param, v)`, `get(param)` | Params |
| `trigger(name)` | Fire a trigger |
| `play(state, { fade, restart })` | Jump to a state at the next step, skipping transitions |
| `speed`, `paused` | Playback |
| `state`, `is(s)` | The current state |
| `time`, `normalizedTime` | Seconds into the state, and plays so far |
| `finished` | A `once` clip has ended |
| `weight` | Crossfade weight |
| `frame`, `clipFrame`, `flipX` | Sprites: sheet frame, frame within the clip, mirroring |
| `mixer`, `action(clip)` | 3D: for inspection |

## Events

```ts
for (const ev of events.read(AnimationEvent)) {
  if (ev.name === 'hitFrame') { /* ev.entity, ev.state */ }
}
```

| Event | Payload | When |
|---|---|---|
| `AnimationEvent` | `{ entity, name, state }` | A frame first shows (or a time is reached), every loop |
| `AnimationStateChanged` | `{ entity, from, to }` | A transition or `play()` |
| `AnimationFinished` | `{ entity, state }` | A `once` clip ends |

They are emitted in `Fixed`, so a system reacting to `hitFrame` in `Fixed` is deterministic.

## Snapshots and saves

Animators show in `kiln run --snapshot SpriteAnimator` (state, time, params), but aren't part of
saves. Re-add them when `Loaded` arrives.
