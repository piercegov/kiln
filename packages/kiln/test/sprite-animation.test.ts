import { afterEach, describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  AnimateSprites,
  AnimationEvent,
  AnimationFinished,
  AnimationStateChanged,
  animationGraph,
  App,
  Assets,
  createApp,
  CorePlugins,
  Fixed,
  MeshRef,
  Mut,
  SpriteAnimationPlugin,
  SpriteAnimator,
  spriteAnimator,
  SpriteSheets,
  spriteSheet,
  system,
  Transform,
} from '../src/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
const root = `${import.meta.dir}/fixtures/game`

const Sheet = spriteSheet({
  texture: null,
  columns: 4,
  rows: 2,
  size: [2, 2],
  pivot: [0.5, 0],
  clips: {
    idle: { range: [0, 3], fps: 10 },
    run: { range: [4, 7], fps: 15 },
    attack: { frames: [7, 6, 5], fps: 20, loop: 'once' },
  },
})

const HeroAnim = animationGraph({
  initial: 'idle',
  params: { speed: 0 },
  triggers: ['attack'],
  states: { idle: {}, run: { events: [{ frame: 2, name: 'footstep' }] }, attack: { loop: 'once', events: [{ frame: 1, name: 'hitFrame' }] } },
  transitions: [
    { from: '*', to: 'attack', trigger: 'attack' },
    { from: 'idle', to: 'run', when: { speed: { gt: 0.1 } } },
    { from: 'run', to: 'idle', when: { speed: { lte: 0.1 } } },
    { from: 'attack', to: 'idle', exitTime: 1 },
  ],
})

function mk2d() {
  const a = createApp({ mode: '2d' }).use(CorePlugins, SpriteAnimationPlugin)
  apps.push(a)
  return a
}

function uvs(app: App, e: number) {
  const mesh = app.get(e as never, MeshRef) as THREE.Mesh
  return Array.from((mesh.geometry.getAttribute('uv') as THREE.BufferAttribute).array).map((v) => Math.round(v * 1000) / 1000)
}

describe('sprite animation', () => {
  test('gives the entity a quad and shows the clip frames as UVs', () => {
    const app = mk2d()
    const e = app.spawn(Transform({ z: 2 }), spriteAnimator(Sheet, { graph: HeroAnim }))
    app.step(1)
    const mesh = app.get(e, MeshRef) as THREE.Mesh
    expect(mesh).toBeInstanceOf(THREE.Mesh)
    // Frame 0 is the top-left cell of a 4x2 grid. Order: TL, TR, BL, BR.
    expect(uvs(app, e)).toEqual([0, 1, 0.25, 1, 0, 0.5, 0.25, 0.5])
    // Pivot at the feet: the quad spans y 0..2.
    mesh.geometry.computeBoundingBox()
    expect([mesh.geometry.boundingBox!.min.y, mesh.geometry.boundingBox!.max.y]).toEqual([0, 2])
    app.step(6)
    expect(app.get(e, SpriteAnimator)!.frame).toBe(1)
    expect(uvs(app, e)).toEqual([0.25, 1, 0.5, 1, 0.25, 0.5, 0.5, 0.5])
    expect(mesh.position.z).toBe(2) // z stays the draw order
  })

  test('flipX mirrors the UVs', () => {
    const app = mk2d()
    const e = app.spawn(Transform, spriteAnimator(Sheet, { flipX: true }))
    app.step(1)
    expect(uvs(app, e)).toEqual([0.25, 1, 0, 1, 0.25, 0.5, 0, 0.5])
  })

  test('a system setting params .before(AnimateSprites) switches state the same step, and events reach readers once', () => {
    const app = mk2d()
    const Run = system([Mut(SpriteAnimator)], ([a], { time }) => {
      a.set('speed', time.tick >= 10 ? 4 : 0)
    })
    let footsteps = 0
    const Listen = system(({ events }) => {
      for (const ev of events.read(AnimationEvent)) if (ev.name === 'footstep') footsteps++
    })
    app.add(Fixed, Run.before(AnimateSprites), Listen.after(AnimateSprites))
    const e = app.spawn(Transform, spriteAnimator(Sheet, { graph: HeroAnim }))
    app.step(10)
    expect(app.get(e, SpriteAnimator)!.state).toBe('idle')
    app.step(1)
    expect(app.get(e, SpriteAnimator)!.state).toBe('run')
    expect(app.events(AnimationStateChanged)).toEqual([{ entity: e, from: 'idle', to: 'run' }])
    expect(app.get(e, SpriteAnimator)!.frame).toBe(4)
    // run: 4 frames at 15 fps = 16 steps per loop; one footstep each. Step in chunks to count.
    let fromEvents = 0
    for (let i = 0; i < 8; i++) {
      app.step(8)
      fromEvents += app.events(AnimationEvent).length
    }
    expect(fromEvents).toBe(4)
    expect(footsteps).toBe(4)
  })

  test('a once clip fires its hit frame and AnimationFinished once, then returns by exitTime', () => {
    const app = mk2d()
    const e = app.spawn(Transform, spriteAnimator(Sheet, { graph: HeroAnim }))
    app.step(1)
    app.get(e, SpriteAnimator)!.trigger('attack')
    let hits = 0
    let finished = 0
    let back = -1
    for (let i = 0; i < 20; i++) {
      app.step(1)
      hits += app.events(AnimationEvent).filter((x) => x.name === 'hitFrame').length
      finished += app.events(AnimationFinished).length
      if (back < 0 && app.get(e, SpriteAnimator)!.is('idle') && i > 0) back = i
    }
    expect(hits).toBe(1)
    expect(finished).toBe(1)
    // 3 frames at 20 fps = 9 steps; the exit transition fires on the step after the end.
    expect(back).toBe(9)
  })

  test('play() without a graph switches clips; the snapshot shows the animator', () => {
    const app = mk2d()
    const e = app.spawn(Transform, spriteAnimator(Sheet, { play: 'run' }))
    app.step(1)
    expect(app.get(e, SpriteAnimator)!.state).toBe('run')
    app.get(e, SpriteAnimator)!.play('idle')
    app.step(1)
    const snap = app.snapshot({ traits: [SpriteAnimator] })
    expect(snap.entities[0]!.traits.SpriteAnimator).toMatchObject({ state: 'idle', frame: 0 })
  })

  test('despawning disposes the quad geometry and keeps the shared material', () => {
    const app = mk2d()
    const a = app.spawn(Transform, spriteAnimator(Sheet))
    const b = app.spawn(Transform, spriteAnimator(Sheet))
    app.step(1)
    const ma = app.get(a, MeshRef) as THREE.Mesh
    const mb = app.get(b, MeshRef) as THREE.Mesh
    expect(ma.material).toBe(mb.material)
    let disposedGeo = 0
    let disposedMat = 0
    ma.geometry.addEventListener('dispose', () => disposedGeo++)
    ;(ma.material as THREE.Material).addEventListener('dispose', () => disposedMat++)
    app.despawn(a)
    app.step(1)
    expect(disposedGeo).toBe(1)
    expect(disposedMat).toBe(0)
    expect(app.res(SpriteSheets).quads.size).toBe(1)
    expect(ma.parent).toBeNull()
  })

  test('texture paths load through Assets and reach the shared material', async () => {
    const app = mk2d()
    ;(globalThis as any).__KILN_ROOT__ = root
    const sheet = spriteSheet({ texture: 'sprites/hero.png', columns: 2, clips: { idle: { range: [0, 1] } } })
    const e = app.spawn(Transform, spriteAnimator(sheet))
    app.step(1)
    await app.idle()
    app.step(1)
    const mat = (app.get(e, MeshRef) as THREE.Mesh).material as THREE.MeshBasicMaterial
    expect(mat.map?.name).toBe('sprites/hero.png')
    expect(mat.map?.magFilter).toBe(THREE.NearestFilter)
    expect(app.res(Assets).get('sprites/hero.png')?.ready).toBe(true)
  })

  test('bad sheets and bare SpriteAnimators name the fix', () => {
    expect(() => spriteSheet({ texture: null, columns: 2, clips: { run: { range: [0, 5] } } })).toThrow('the sheet has frames 0..1')
    const app = mk2d()
    app.spawn(Transform, SpriteAnimator)
    expect(() => app.step(1)).toThrow('Spawn it with spriteAnimator(MySheet')
  })
})
