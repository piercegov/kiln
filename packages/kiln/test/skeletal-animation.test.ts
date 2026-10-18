import { afterEach, describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  AnimateModels,
  AnimationEvent,
  animationGraph,
  animator,
  Animator,
  App,
  Assets,
  createApp,
  CorePlugins,
  Fixed,
  MeshRef,
  Mixers,
  Model,
  Mut,
  SkeletalAnimationPlugin,
  system,
  Transform,
} from '../src/index.ts'
import type { AnimatorOptions } from '../src/plugins/animation/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
const root = `${import.meta.dir}/fixtures/game`

const WalkerAnim = animationGraph({
  initial: 'idle',
  fade: 0.2,
  params: { speed: 0 },
  states: { idle: { clip: 'Idle' }, walk: { clip: 'Walk', events: [{ at: 0.25, name: 'footstep' }] } },
  transitions: [
    { from: 'idle', to: 'walk', when: { speed: { gt: 0 } } },
    { from: 'walk', to: 'idle', when: { speed: 0 } },
  ],
})

async function mk3d(build?: (app: App) => void) {
  const app = createApp().use(CorePlugins, SkeletalAnimationPlugin)
  apps.push(app)
  ;(globalThis as any).__KILN_ROOT__ = root
  build?.(app)
  return app
}

const WalkOnly = animationGraph({ initial: 'walk', states: { walk: { clip: 'Walk', events: [{ at: 0.25, name: 'footstep' }] } } })

async function spawnWalker(app: App, options: AnimatorOptions = { graph: WalkerAnim }) {
  const e = app.spawn(Transform, Model(app.res(Assets).gltf('models/walker.gltf')), animator(options))
  await app.idle()
  app.step(1) // SpawnModels gives it a MeshRef at the end of this frame
  const body = (app.get(e, MeshRef) as THREE.Object3D).getObjectByName('Body')!
  return { e, body, anim: app.get(e, Animator)! }
}

describe('skeletal animation', () => {
  test('binds a mixer to the model and samples the clip at the playhead', async () => {
    const app = await mk3d()
    const { e, body, anim } = await spawnWalker(app, { graph: WalkOnly })
    expect(anim.mixer).toBeNull()
    app.step(15) // 0.25 s of Walk: x = 1
    expect(anim.mixer).toBeInstanceOf(THREE.AnimationMixer)
    expect(anim.state).toBe('walk')
    expect(body.position.x).toBeCloseTo(1, 4)
    app.step(15) // 0.5 s: the loop wraps to 0
    expect(body.position.x).toBeCloseTo(0, 4)
    expect(app.res(Mixers).count).toBe(1)
    expect(app.get(e, Animator)).toBe(anim)
  })

  test('crossfades blend the two clips by the graph weight', async () => {
    const app = await mk3d()
    const { body, anim } = await spawnWalker(app)
    app.step(30) // Idle at 0.5 s: y = 0.5
    expect(body.position.y).toBeCloseTo(0.5, 4)
    anim.set('speed', 1)
    app.step(6) // 0.1 s into a 0.2 s fade
    expect(anim.state).toBe('walk')
    expect(anim.weight).toBeCloseTo(0.5, 6)
    expect(anim.action('Walk')!.weight).toBeCloseTo(0.5, 6)
    expect(anim.action('Idle')!.weight).toBeCloseTo(0.5, 6)
    // Half of Walk at 0.1 s (x 0.4) plus half of Idle at 0.6 s (y 0.6).
    expect(body.position.x).toBeCloseTo(0.2, 4)
    expect(body.position.y).toBeCloseTo(0.3, 4)
    app.step(6)
    expect(anim.fade).toBeNull()
    expect(anim.action('Idle')!.isRunning()).toBe(false)
    expect(body.position.y).toBeCloseTo(0, 4)
  })

  test('time events fire once per loop', async () => {
    const app = await mk3d()
    const { e } = await spawnWalker(app, { graph: WalkOnly })
    let n = 0
    for (let i = 0; i < 6; i++) {
      app.step(10)
      n += app.events(AnimationEvent).filter((x) => x.entity === e && x.name === 'footstep').length
    }
    // 60 steps = 1 s = two loops of the 0.5 s Walk clip.
    expect(n).toBe(2)
  })

  test('despawn stops the mixer and frees it', async () => {
    const app = await mk3d()
    const { e, anim } = await spawnWalker(app)
    app.step(2)
    const mixer = anim.mixer!
    expect(app.res(Mixers).count).toBe(1)
    app.despawn(e)
    app.step(1)
    expect(app.res(Mixers).count).toBe(0)
    expect(anim.mixer).toBeNull()
    expect((mixer as any)._actions.length).toBe(0)
  })

  test('hand-built MeshRefs take clips; unknown clips list the ones the model has', async () => {
    const app = await mk3d()
    const obj = new THREE.Object3D()
    const child = new THREE.Object3D()
    child.name = 'Lid'
    obj.add(child)
    const track = new THREE.VectorKeyframeTrack('Lid.position', [0, 1], [0, 0, 0, 0, 4, 0])
    const e = app.spawn(Transform, MeshRef(obj), animator({ clips: [new THREE.AnimationClip('Open', 1, [track])] }))
    app.step(30)
    expect(app.get(e, Animator)!.state).toBe('Open')
    expect(child.position.y).toBeCloseTo(2, 4)

    const bad = animationGraph({ initial: 'run', states: { run: { clip: 'Run' } } })
    app.spawn(Transform, Model(app.res(Assets).gltf('models/walker.gltf')), animator({ graph: bad }))
    await app.idle()
    app.step(1)
    expect(() => app.step(1)).toThrow("plays clip 'Run', which 'models/walker.gltf' doesn't have. Clips: 'Idle', 'Walk'")
    expect(() => app.step(1)).toThrow("plays clip 'Run'") // the same fix, not a crash, on later steps
  })

  test('a system writing params goes .before(AnimateModels); unordered writers are a schedule error', async () => {
    const SetSpeed = system([Mut(Animator)], ([a]) => void a.set('speed', 1))
    const app = await mk3d((a) => a.add(Fixed, SetSpeed))
    expect(() => app.step(1)).toThrow(/AnimateModels|SetSpeed/)
    const ok = await mk3d((a) => a.add(Fixed, SetSpeed.before(AnimateModels)))
    const { anim } = await spawnWalker(ok)
    ok.step(1)
    expect(anim.state).toBe('walk')
  })
})
