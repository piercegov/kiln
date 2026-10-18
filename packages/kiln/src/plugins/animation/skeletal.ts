import * as THREE from 'three'
import { Not, type Entity } from 'koota'
import { KilnError } from '../../core/errors.ts'
import { trait } from '../../core/koota.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed } from '../../core/schedule.ts'
import { Mut } from '../../core/access.ts'
import { system } from '../../core/system.ts'
import { Model, type AssetHandle, type GLTF } from '../assets/index.ts'
import { MeshRef } from '../render/traits.ts'
import {
  AnimationController,
  AnimationEvent,
  AnimationFinished,
  AnimationStateChanged,
  clipOf,
  localTime,
  type AnimationGraph,
  EventSink,
  type ClipInfo,
} from './graph.ts'

const sink = new EventSink()

export interface AnimatorOptions {
  /** The state graph. Default: one state per glTF clip, switched with play(). */
  graph?: AnimationGraph
  /** State to start in instead of the graph's initial state (or the first clip). */
  play?: string
  /** Playback rate multiplier. Default 1. */
  speed?: number
  /** Where the clips come from. Default: the entity's Model asset. Pass clips for a hand-built MeshRef. */
  clips?: AssetHandle<GLTF> | readonly THREE.AnimationClip[]
}

/**
 * A 3D entity's animation: the shared controller (`set`, `trigger`, `play`, `state`, `time`,
 * `weight`) driving a Three.js AnimationMixer on the entity's MeshRef. `mixer` and `action(clip)`
 * are there for inspection; the plugin sets every action's time and weight each fixed step.
 */
export class ModelAnimation extends AnimationController {
  /** Clips given in options, instead of the Model's. */
  source: AssetHandle<GLTF> | readonly THREE.AnimationClip[] | null
  mixer: THREE.AnimationMixer | null = null
  /** The object the mixer animates (the MeshRef). */
  root: THREE.Object3D | null = null
  readonly clipsByName = new Map<string, THREE.AnimationClip>()
  private actions = new Map<string, THREE.AnimationAction>()

  constructor(options: AnimatorOptions = {}) {
    super(options.graph ?? null, options.play)
    this.speed = options.speed ?? 1
    this.source = options.clips ?? null
  }

  /** The mixer action for a clip (created on first use), or undefined before the model is bound. */
  action(clip: string): THREE.AnimationAction | undefined {
    if (!this.mixer) return undefined
    let a = this.actions.get(clip)
    if (!a) {
      const c = this.clipsByName.get(clip)
      if (!c) return undefined
      a = this.mixer.clipAction(c)
      a.clampWhenFinished = true
      this.actions.set(clip, a)
    }
    return a
  }

  /** Binds to a root object and its clips: makes the mixer, checks the graph's clips exist. */
  attach(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], what: string): void {
    this.detach()
    const infos = new Map<string, ClipInfo>()
    for (const c of clips) infos.set(c.name, { duration: c.duration })
    // Bind first: a missing clip throws here every step, before anything is half set up.
    if (!this.bound) this.bind(infos, what)
    this.clipsByName.clear()
    for (const c of clips) this.clipsByName.set(c.name, c)
    this.root = root
    this.mixer = new THREE.AnimationMixer(root)
  }

  /** Stops the mixer and frees its cached bindings. */
  detach(): void {
    if (!this.mixer) return
    this.mixer.stopAllAction()
    if (this.root) this.mixer.uncacheRoot(this.root)
    this.mixer = null
    this.root = null
    this.actions.clear()
  }

  /** Writes the playhead and crossfade into the mixer's actions and samples the pose. */
  apply(): void {
    const mixer = this.mixer
    if (!mixer || !this.graph) return
    const used = new Map<string, { time: number; weight: number }>()
    const f = this.fade
    const w = this.weight
    if (f && w < 1) {
      const fromClip = clipOf(this.graph, f.from)
      const info = this.clipInfo(fromClip)
      const loop = this.graph.states[f.from]?.loop ?? 'loop'
      if (info) used.set(fromClip, { time: localTime(info, loop, f.fromTime), weight: 1 - w })
    }
    const cur = this.clip
    const info = this.clipInfo(cur)!
    const prev = used.get(cur)
    // Fading between two states that share a clip: the newer playhead wins.
    used.set(cur, { time: localTime(info, this.loop, this.time), weight: prev ? 1 : w })
    for (const [clip, a] of this.actions) {
      if (!used.has(clip) && a.isRunning()) a.stop()
    }
    for (const [clip, u] of used) {
      const a = this.action(clip)!
      if (!a.isRunning()) a.play()
      a.paused = false
      a.enabled = true
      a.time = u.time
      a.weight = u.weight
    }
    // deltaTime 0 samples each action at exactly the time set above.
    mixer.update(0)
  }

}

/**
 * Plays glTF animation clips through an animation graph on a per-entity AnimationMixer:
 * `commands.spawn(Transform, Model(assets.gltf('models/hero.glb')), animator({ graph: HeroAnim }))`.
 * Rows from `Mut(Animator)` take `set(param, v)`, `trigger(name)`, `play(state, { fade })`.
 */
export const Animator = trait(() => new ModelAnimation())

/** The Animator for a model: `animator({ graph: HeroAnim })`, `animator({ play: 'Idle' })`. */
export function animator(options: AnimatorOptions = {}) {
  return Animator(new ModelAnimation(options))
}

/** Live mixers by entity, so despawn can stop them and free their bindings. */
export class MixerStore {
  readonly live = new Map<Entity, ModelAnimation>()
  /** Mixers alive now. */
  get count(): number {
    return this.live.size
  }
  release(e: Entity): void {
    const a = this.live.get(e)
    if (!a) return
    this.live.delete(e)
    a.detach()
  }
  dispose(): void {
    for (const a of this.live.values()) a.detach()
    this.live.clear()
  }
}

/** Animation mixers alive in this app (`count`). */
export const Mixers = resource((app): MixerStore => {
  const store = new MixerStore()
  app.hooks.dispose.push(() => store.dispose())
  return store
}, { readonlyProxy: false }).named('Mixers')

function clipsOf(src: AssetHandle<GLTF> | readonly THREE.AnimationClip[] | null): readonly THREE.AnimationClip[] | null {
  if (!src) return null
  if (Array.isArray(src)) return src
  const h = src as AssetHandle<GLTF>
  if (h.failed) throw new KilnError('anim-model-failed', `Animator clips from '${h.path}' failed to load: ${h.error}`)
  return h.ready && h.value ? h.value.animations : null
}

/**
 * Advances every Animator one fixed step once its model is in the scene: binds a mixer to the
 * MeshRef, runs the graph (play() requests, transitions, events) and samples the pose. Systems that
 * set params or triggers in Fixed go `.before(AnimateModels)`.
 */
export const AnimateModels = system(
  { models: [Mut(Animator), MeshRef, Model], plain: [Mut(Animator), MeshRef, Not(Model)] },
  ({ models, plain }, { time, events, res }) => {
    if (models.length === 0 && plain.length === 0) return
    const store = res.mut(Mixers)
    const run = (anim: ModelAnimation, obj: THREE.Object3D | null, handle: AssetHandle<GLTF> | null, entity: Entity) => {
      if (!obj) return
      if (anim.root !== obj) {
        const clips = clipsOf(anim.source) ?? clipsOf(handle)
        if (!clips) {
          if (!anim.source && !handle) {
            throw new KilnError('anim-no-clips', 'An Animator entity has a MeshRef but no Model and no clips. Spawn it with Model(assets.gltf(path)), or animator({ clips }).')
          }
          return
        }
        anim.attach(obj, clips, anim.source && !Array.isArray(anim.source) ? `'${(anim.source as AssetHandle).path}'` : handle ? `'${handle.path}'` : 'the clips given')
        store.live.set(entity, anim)
      }
      anim.step(time.step, sink.for(entity, events))
      anim.apply()
    }
    models.each(([anim, obj, handle], e) => run(anim, obj, handle, e))
    plain.each(([anim, obj], e) => run(anim, obj, null, e))
  },
)

/**
 * glTF skeletal (and node) animation for 3D: `animator({ graph })` next to `Model(...)`, one
 * AnimationMixer per entity, crossfades from the shared animation graph, time events. Ticks in
 * Fixed; mixers are stopped and uncached on despawn. Needs CorePlugins.
 */
export const SkeletalAnimationPlugin = plugin((app) => {
  app.init(Mixers, AnimationEvent, AnimationStateChanged, AnimationFinished)
  app.add(Fixed, AnimateModels)
  const store = app.resource(Mixers)
  const unsubs = [app.world.onRemove(Animator, (e) => store.release(e)), app.world.onRemove(MeshRef, (e) => store.release(e))]
  app.hooks.dispose.push(() => {
    for (const u of unsubs) u()
  })
}, 'SkeletalAnimationPlugin')
