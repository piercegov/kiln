import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  App,
  Camera,
  ChildOf,
  createApp,
  CorePlugins,
  Fixed,
  MeshRef,
  Mut,
  Scene,
  setEuler,
  SharedMesh,
  system,
  Teleported,
  trait,
  Transform,
} from '../src/index.ts'

const Velocity = trait({ x: 0, y: 0, z: 0 })
const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
})

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(config = {}) {
  const a = createApp(config).use(CorePlugins)
  apps.push(a)
  return a
}
const box = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())

describe('MeshRef lifecycle', () => {
  test('adding MeshRef puts the object in the scene; despawn removes and disposes it', () => {
    const app = mk()
    const mesh = box()
    let disposed = 0
    mesh.geometry.addEventListener('dispose', () => void disposed++)
    const e = app.spawn(Transform({ x: 3 }), MeshRef(mesh))
    const scene = app.res(Scene)
    expect(mesh.parent).toBe(scene)
    expect(mesh.position.x).toBe(3)
    app.despawn(e)
    expect(mesh.parent).toBe(null)
    expect(disposed).toBe(1)
  })

  test('SharedMesh keeps geometry alive', () => {
    const app = mk()
    const mesh = box()
    let disposed = 0
    mesh.geometry.addEventListener('dispose', () => void disposed++)
    app.despawn(app.spawn(Transform, MeshRef(mesh), SharedMesh))
    expect(disposed).toBe(0)
  })

  test('commands.spawn with MeshRef works from a system', () => {
    const mesh = box()
    const Spawn = system(({ commands }) => void commands.spawn(Transform, MeshRef(mesh)))
    const app = mk().add(Fixed, Spawn)
    app.step(1)
    expect(mesh.parent).toBe(app.res(Scene))
  })
})

describe('RenderSync', () => {
  test('interpolates between the last two fixed steps by alpha', async () => {
    const app = mk({ fixedHz: 10 }).add(Fixed, Movement)
    const mesh = box()
    app.spawn(Transform, Velocity({ x: 10 }), MeshRef(mesh)) // 1 unit per step
    await app.start(undefined, { loop: false })
    app.tick(0.1) // one step: x 0 → 1, alpha ≈ 0
    expect(app.time.tick).toBe(1)
    expect(mesh.position.x).toBeCloseTo(0, 5)
    app.tick(0.05) // no step, alpha 0.5
    expect(mesh.position.x).toBeCloseTo(0.5, 5)
    app.tick(0.03)
    expect(mesh.position.x).toBeCloseTo(0.8, 5)
  })

  test('Teleported snaps instead of interpolating', async () => {
    const app = mk({ fixedHz: 10 })
    const mesh = box()
    const e = app.spawn(Transform, MeshRef(mesh))
    await app.start(undefined, { loop: false })
    app.tick(0.1)
    app.set(e, Transform, { x: 50 })
    e.add(Teleported)
    app.tick(0.15) // one step + half
    expect(mesh.position.x).toBeCloseTo(50, 5)
  })

  test('ChildOf composes world matrices', async () => {
    const app = mk()
    const parentMesh = box()
    const childMesh = box()
    const parent = app.spawn(Transform({ x: 2 }), MeshRef(parentMesh))
    const pt = { qx: 0, qy: 0, qz: 0, qw: 1 }
    setEuler(pt, 0, Math.PI / 2, 0)
    app.set(parent, Transform, pt)
    app.spawn(Transform({ x: 1 }), MeshRef(childMesh), ChildOf(parent))
    await app.start(undefined, { loop: false })
    app.render()
    expect(childMesh.position.x).toBeCloseTo(2, 5)
    expect(childMesh.position.z).toBeCloseTo(-1, 5)
  })

  test('2D mode uses an orthographic camera and Z-only rotation', async () => {
    const app = mk({ mode: '2d' })
    expect((app.res(Camera) as THREE.OrthographicCamera).isOrthographicCamera).toBe(true)
    const mesh = box()
    const e = app.spawn(Transform, MeshRef(mesh))
    const t = { qx: 0, qy: 0, qz: 0, qw: 1 }
    setEuler(t, 0.5, 0.3, 1)
    app.set(e, Transform, t)
    await app.start(undefined, { loop: false })
    app.render()
    expect(mesh.quaternion.x).toBe(0)
    expect(mesh.quaternion.y).toBe(0)
  })
})

test('core never imports Three.js', () => {
  const dir = `${import.meta.dir}/../src/core`
  for (const f of readdirSync(dir)) {
    const src = readFileSync(`${dir}/${f}`, 'utf8')
    expect({ f, three: /from ['"]three/.test(src.replace(/import type[^\n]*/g, '')) }).toEqual({ f, three: false })
  }
})
