import { afterEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as THREE from 'three'
import { App, Camera, createApp, CorePlugins, MeshRef, Scene, Transform, type Plugin } from '../src/index.ts'
import { CameraFollow, OrbitCamera, OrbitCameraPlugin } from '../community/orbit-camera/index.ts'
import { Water, WaterPlugin, type WaterUniforms } from '../community/water/index.ts'
import { Terrain, terrainHeightAt, TerrainPlugin } from '../community/terrain/index.ts'
import { ParticleEmitter, ParticlesPlugin } from '../community/particles/index.ts'
import { AudioPlugin, AudioState, PlaySound, Sound } from '../community/audio/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(...plugins: Plugin[]) {
  const a = createApp({ seed: 5 }).use(CorePlugins, ...plugins)
  apps.push(a)
  return a
}

describe('community plugins run headless', () => {
  test('orbit-camera places the camera and follows a target', () => {
    const app = mk(OrbitCameraPlugin)
    const cam = app.spawn(OrbitCamera({ distance: 10, yaw: 0, pitch: 0 }))
    app.step(60)
    const c = app.res(Camera)
    expect(c.position.x).toBeCloseTo(0, 5)
    expect(c.position.z).toBeCloseTo(10, 5)
    app.spawn(Transform({ x: 5, z: 2 }), CameraFollow({ smoothing: 0 }))
    app.step(1)
    expect(app.get(cam, OrbitCamera)!.targetX).toBeCloseTo(5, 5)
    expect(c.position.x).toBeCloseTo(5, 5)
    expect(c.position.z).toBeCloseTo(12, 5)
  })

  test('water builds a TSL mesh and drives its time uniform from the sim clock', () => {
    const app = mk(WaterPlugin)
    const e = app.spawn(Transform, Water({ size: 10, segments: 8 }))
    app.step(60)
    const mesh = app.get(e, MeshRef) as THREE.Mesh
    expect(mesh.parent).toBe(app.res(Scene))
    expect((mesh.material as any).isMeshStandardNodeMaterial).toBe(true)
    expect((mesh.material as any).positionNode).toBeTruthy()
    expect((mesh.userData.water as WaterUniforms).time.value).toBeCloseTo(app.time.elapsed, 6)
    app.set(e, Water, { segments: 4 })
    app.step(1)
    expect(mesh.geometry.attributes.position!.count).toBe(25)
  })

  test('terrain builds a mesh whose vertices match terrainHeightAt', () => {
    const app = mk(TerrainPlugin)
    const params = { size: 20, resolution: 10, height: 5, seed: 9, scale: 8, octaves: 3, colorLow: 0, colorHigh: 0xffffff }
    const e = app.spawn(Transform, Terrain(params))
    app.step(60)
    const mesh = app.get(e, MeshRef) as THREE.Mesh
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
    for (const i of [0, 17, 60, pos.count - 1]) expect(pos.getY(i)).toBeCloseTo(terrainHeightAt(params, pos.getX(i), pos.getZ(i)), 5)
    expect(mesh.geometry.attributes.color).toBeTruthy()
  })

  test('terrainHeightAt is deterministic per seed and stays in range', () => {
    const p = { height: 6, seed: 42 }
    const samples = (q: typeof p) => Array.from({ length: 50 }, (_, i) => terrainHeightAt(q, i * 1.37 - 30, i * -0.91 + 12))
    const a = samples(p)
    expect(samples({ ...p })).toEqual(a)
    expect(samples({ ...p, seed: 43 })).not.toEqual(a)
    for (const h of a) expect(h >= 0 && h <= 6).toBe(true)
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.5)
  })

  test('particles emit deterministically and clean up on despawn', () => {
    const run = () => {
      const app = mk(ParticlesPlugin)
      const e = app.spawn(Transform({ y: 1 }), ParticleEmitter({ rate: 60, lifetime: 0.5, max: 100 }))
      app.step(60)
      const mesh = app.res(Scene).getObjectByName('particles') as THREE.InstancedMesh
      const m = new THREE.Matrix4()
      mesh.getMatrixAt(3, m)
      return { app, e, mesh, count: mesh.count, y: new THREE.Vector3().setFromMatrixPosition(m).y }
    }
    const a = run()
    const b = run()
    expect(a.count).toBeGreaterThan(20)
    expect(a.count).toBeLessThanOrEqual(100)
    expect([a.count, a.y]).toEqual([b.count, b.y])
    a.app.despawn(a.e)
    a.app.step(1)
    expect(a.mesh.parent).toBe(null)
  })

  test('audio is a silent no-op headless', () => {
    const app = mk(AudioPlugin)
    const e = app.spawn(Transform({ x: 2 }), Sound({ src: '/nope.ogg', loop: true }))
    app.emit(PlaySound, { src: '/boom.ogg', entity: e })
    app.emit(PlaySound, { src: '/flat.ogg' })
    expect(() => app.step(60)).not.toThrow()
    expect(app.res(AudioState).listener).toBe(null)
    expect(app.res(Camera).children.length).toBe(0)
  })

  test('all five together', () => {
    const app = mk(OrbitCameraPlugin, WaterPlugin, TerrainPlugin, ParticlesPlugin, AudioPlugin)
    app.spawn(Transform, Terrain)
    app.spawn(Transform, Water)
    app.spawn(Transform, ParticleEmitter, CameraFollow, Sound({ src: '/x.ogg' }))
    app.spawn(OrbitCamera)
    expect(() => app.step(60)).not.toThrow()
  })
})

describe('community fixture', () => {
  test(
    'kiln shot renders it with no errors',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'kiln-community-'))
      const out = join(dir, 'shot.png')
      try {
        const r = await $`bun src/cli/kiln.ts shot --json --steps 60 --cwd test/fixtures/community ${out}`.cwd(`${import.meta.dir}/..`).nothrow().quiet()
        const res = JSON.parse(r.stdout.toString().trim().split('\n').pop()!)
        expect(res.ok).toBe(true)
        expect(res.tick).toBe(60)
        // The fixture's sound file is missing on purpose: that may warn, nothing else may.
        expect(res.errors.filter((e: string) => !e.includes('[audio]'))).toEqual([])
        expect(existsSync(out)).toBe(true)
        expect(Bun.file(out).size).toBeGreaterThan(2000)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    90_000,
  )
})
