import { afterEach, describe, expect, test } from 'bun:test'
import { App, Camera, CameraPlugin, CameraRig, CameraShake, CameraTarget, createApp, CorePlugins, Transform } from '../src/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(mode: '2d' | '3d' = '3d') {
  const a = createApp({ mode }).use(CorePlugins, CameraPlugin)
  apps.push(a)
  return a
}

describe('camera rig', () => {
  test('3D: snaps to the target first, then eases after it and looks at it', () => {
    const app = mk()
    const p = app.spawn(Transform({ x: 2, z: -3 }), CameraTarget)
    app.step(1)
    const cam = app.res(Camera)
    expect([cam.position.x, cam.position.y, cam.position.z]).toEqual([2, 10, 9])
    app.set(p, Transform, { x: 12 })
    app.step(1)
    const x1 = cam.position.x
    expect(x1).toBeGreaterThan(2)
    expect(x1).toBeLessThan(12)
    app.step(120)
    expect(cam.position.x).toBeCloseTo(12, 3)
    const dir = cam.getWorldDirection(new (cam.position.constructor as any)())
    expect(dir.y).toBeLessThan(0) // looking down at the target
  })

  test('smoothing 0 follows exactly; bounds clamp the focus', () => {
    const app = mk()
    app.res(CameraRig).smoothing = 0
    app.res(CameraRig).bounds = { minX: -5, maxX: 5 }
    const p = app.spawn(Transform, CameraTarget)
    app.step(1)
    app.set(p, Transform, { x: 50, z: 7 })
    app.step(1)
    expect(app.res(CameraRig).focus).toEqual({ x: 5, y: 0, z: 7 })
  })

  test('2D: offset on z, shake rolls about z and decays', () => {
    const app = mk('2d')
    app.spawn(Transform({ x: 1, y: 2 }), CameraTarget)
    app.step(1)
    const cam = app.res(Camera)
    expect([cam.position.x, cam.position.y, cam.position.z]).toEqual([1, 2, 100])
    app.emit(CameraShake, { amount: 1 })
    app.step(3)
    const rig = app.res(CameraRig)
    expect(rig.trauma).toBeGreaterThan(0.8)
    expect(Math.abs(rig.current.x) + Math.abs(rig.current.y)).toBeGreaterThan(0)
    expect(cam.rotation.z).toBe(rig.current.roll)
    app.step(120)
    expect(rig.trauma).toBe(0)
    expect([cam.position.x, cam.position.y]).toEqual([1, 2])
  })

  test('shake is deterministic', () => {
    const run = () => {
      const app = mk()
      app.spawn(Transform, CameraTarget)
      app.res(CameraRig).shake(0.7)
      app.step(10)
      return app.res(Camera).position.toArray()
    }
    expect(run()).toEqual(run())
  })

  test('zoom applies to the camera', () => {
    const app = mk('2d')
    app.res(CameraRig).zoom = 2
    app.step(1)
    expect(app.res(Camera).zoom).toBe(2)
  })
})
