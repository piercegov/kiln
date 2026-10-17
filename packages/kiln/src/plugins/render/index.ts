import * as THREE from 'three'
import { getStore, type Entity } from 'koota'
import type { App } from '../../core/app.ts'
import { plugin, type Plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Render } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'
import { KilnError } from '../../core/errors.ts'
import { ChildOf, Transform } from '../../core/transform.ts'
import { Instanced, InstanceColor, MeshRef, SharedMesh, Teleported } from './traits.ts'

export { Instanced, InstanceColor, MeshRef, SharedMesh, Teleported } from './traits.ts'

const ENTITY_ID_MASK = (1 << 20) - 1
const F = 10 // floats per transform: x y z qx qy qz qw sx sy sz
const FIELDS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'sx', 'sy', 'sz'] as const

/** The Three.js scene every MeshRef object is added to. Exists headless too. */
export const Scene = resource(() => new THREE.Scene(), { readonlyProxy: false }).named('Scene')

/**
 * The active camera: perspective in 3D, orthographic in 2D. Move it from an Update system with
 * `res.mut(Camera)`; it is a plain Three.js camera.
 */
export const Camera = resource(
  (app): THREE.PerspectiveCamera | THREE.OrthographicCamera => {
    const opts = (app.ext.renderOptions ?? {}) as RenderOptions
    if (app.config.mode === '2d') {
      const h = opts.viewHeight ?? 20
      const cam = new THREE.OrthographicCamera(-h / 2, h / 2, h / 2, -h / 2, -1000, 1000)
      cam.position.set(0, 0, 100)
      return cam
    }
    const cam = new THREE.PerspectiveCamera(opts.fov ?? 60, 16 / 9, 0.1, 1000)
    const [x, y, z] = opts.cameraPosition ?? [0, 10, 14]
    cam.position.set(x, y, z)
    cam.lookAt(0, 0, 0)
    return cam
  },
  { readonlyProxy: false },
).named('Camera')

/** The WebGPU renderer (WebGL2 fallback). null when headless. */
export interface RendererState {
  renderer: import('three/webgpu').WebGPURenderer | null
  /** 'webgpu' or 'webgl2' once initialised. */
  backend: 'webgpu' | 'webgl2' | null
  width: number
  height: number
  pixelRatio: number
}

export const Renderer = resource(
  (): RendererState => ({ renderer: null, backend: null, width: 0, height: 0, pixelRatio: 1 }),
  { readonlyProxy: false },
).named('Renderer')

export interface RenderOptions {
  /** Clear colour. Default 0x1a1d23. */
  background?: THREE.ColorRepresentation | null
  /** Ambient + directional light in 3D. Default true. */
  lights?: boolean
  antialias?: boolean
  /** Perspective field of view in degrees. Default 60. */
  fov?: number
  /** Initial camera position in 3D. Default [0, 10, 14], looking at the origin. */
  cameraPosition?: [number, number, number]
  /** World units visible vertically in 2D. Default 20. */
  viewHeight?: number
  /** Cap on devicePixelRatio. Default 2. */
  maxPixelRatio?: number
  /** Force the WebGL2 backend (kiln shot uses this when WebGPU is unavailable). */
  forceWebGL?: boolean
}

/** The previous fixed step's transforms, for interpolation. Hidden from the ECS. */
class PrevTransforms {
  data = new Float64Array(F * 1024)
  tick = new Int32Array(1024).fill(-0x7fffffff)

  ensure(eid: number) {
    if (eid < this.tick.length) return
    let n = this.tick.length
    while (n <= eid) n *= 2
    const d = new Float64Array(F * n)
    d.set(this.data)
    const t = new Int32Array(n).fill(-0x7fffffff)
    t.set(this.tick)
    this.data = d
    this.tick = t
  }

  capture(eid: number, store: any, tick: number) {
    this.ensure(eid)
    const o = eid * F
    for (let k = 0; k < F; k++) this.data[o + k] = store[FIELDS[k]!][eid]
    this.tick[eid] = tick
  }
}

export interface InstancedDefinition {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Starting capacity; grows by doubling. Default 256. */
  capacity?: number
  castShadow?: boolean
  receiveShadow?: boolean
}

const instancedDefs = new Map<string, InstancedDefinition>()

/**
 * Registers a shared mesh for `Instanced(key)` entities. Geometry and material are shared by every
 * app and never disposed by Kiln.
 */
export function defineInstanced(key: string, def: InstancedDefinition): string {
  instancedDefs.set(key, def)
  return key
}

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _quatB = new THREE.Quaternion()
const _scale = new THREE.Vector3()

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o: any) => {
    o.geometry?.dispose?.()
    const m = o.material
    if (Array.isArray(m)) for (const x of m) x.dispose?.()
    else m?.dispose?.()
  })
}

/** Builds a render plugin with options. */
export function renderPlugin(options: RenderOptions = {}): Plugin {
  return plugin((app) => {
    app.ext.renderOptions = options
    app.init(Scene, Camera, Renderer)
    const world = app.world
    const scene = app.resource(Scene)
    const is2D = app.config.mode === '2d'
    if (options.background !== null) scene.background = new THREE.Color(options.background ?? 0x1a1d23)
    if (!is2D && options.lights !== false) {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.2))
      const sun = new THREE.DirectionalLight(0xffffff, 2)
      sun.position.set(5, 10, 7)
      scene.add(sun)
    }

    // ---- MeshRef lifecycle: in the scene while the entity has it, disposed on removal.
    const objects = new Map<number, THREE.Object3D>()
    const attach = (e: Entity) => {
      const eid = (e as number) & ENTITY_ID_MASK
      const obj = e.get(MeshRef) as THREE.Object3D | null | undefined
      const prev = objects.get(eid)
      if (prev === obj) return
      if (prev) scene.remove(prev)
      if (!obj) {
        objects.delete(eid)
        return
      }
      objects.set(eid, obj)
      obj.matrixAutoUpdate = true
      if (e.has(Transform)) writeTransform(e, obj, 1)
      scene.add(obj)
    }
    const detach = (e: Entity) => {
      const eid = (e as number) & ENTITY_ID_MASK
      const obj = objects.get(eid)
      if (!obj) return
      objects.delete(eid)
      scene.remove(obj)
      if (!e.has(SharedMesh) && !obj.userData.kilnShared) disposeObject(obj)
    }
    const unsubs = [world.onAdd(MeshRef, attach), world.onChange(MeshRef, attach), world.onRemove(MeshRef, detach)]
    app.hooks.dispose.push(() => {
      for (const u of unsubs) u()
      for (const obj of objects.values()) scene.remove(obj)
      objects.clear()
    })

    // ---- Previous transforms for interpolation, captured at the start of each fixed step.
    const prev = new PrevTransforms()
    const capture = () => {
      const ents = world.query(Transform)
      if (ents.length === 0) return
      const store = getStore(world, Transform)
      const tick = app.time.tick
      for (let i = 0; i < ents.length; i++) prev.capture((ents[i]! as number) & ENTITY_ID_MASK, store, tick)
    }
    app.hooks.fixedStart.push(capture)
    app.hooks.fixedEnd.push(() => {
      const ts = world.query(Teleported, Transform)
      if (ts.length === 0) return
      const store = getStore(world, Transform)
      for (const e of ts) {
        prev.capture((e as number) & ENTITY_ID_MASK, store, app.time.tick - 1)
        e.remove(Teleported)
      }
    })

    function writeTransform(e: Entity, obj: THREE.Object3D, alpha: number) {
      const eid = (e as number) & ENTITY_ID_MASK
      const s = getStore(world, Transform) as any
      const interp = alpha < 1 && eid < prev.tick.length && prev.tick[eid] === app.time.tick - 1
      const o = eid * F
      const d = prev.data
      if (interp) {
        const a = alpha
        _pos.set(d[o]! + (s.x[eid] - d[o]!) * a, d[o + 1]! + (s.y[eid] - d[o + 1]!) * a, d[o + 2]! + (s.z[eid] - d[o + 2]!) * a)
        _quat.set(d[o + 3]!, d[o + 4]!, d[o + 5]!, d[o + 6]!)
        _quatB.set(s.qx[eid], s.qy[eid], s.qz[eid], s.qw[eid])
        _quat.slerp(_quatB, a)
        _scale.set(d[o + 7]! + (s.sx[eid] - d[o + 7]!) * a, d[o + 8]! + (s.sy[eid] - d[o + 8]!) * a, d[o + 9]! + (s.sz[eid] - d[o + 9]!) * a)
      } else {
        _pos.set(s.x[eid], s.y[eid], s.z[eid])
        _quat.set(s.qx[eid], s.qy[eid], s.qz[eid], s.qw[eid])
        _scale.set(s.sx[eid], s.sy[eid], s.sz[eid])
      }
      if (is2D) {
        // 2D: rotation about Z only.
        const len = Math.hypot(_quat.z, _quat.w) || 1
        _quat.set(0, 0, _quat.z / len, _quat.w / len)
      }
      obj.position.copy(_pos)
      obj.quaternion.copy(_quat)
      obj.scale.copy(_scale)
    }

    // World matrices for ChildOf chains, composed once per frame.
    const worldCache = new Map<number, THREE.Matrix4>()
    let cacheFrame = -1
    function worldMatrix(e: Entity, alpha: number, depth = 0): THREE.Matrix4 {
      const eid = (e as number) & ENTITY_ID_MASK
      let m = worldCache.get(eid)
      if (m && cacheFrame === app.time.frame) return m
      const tmp = new THREE.Object3D()
      writeTransform(e, tmp, alpha)
      m = new THREE.Matrix4().compose(tmp.position, tmp.quaternion, tmp.scale)
      const parent = depth < 64 ? e.targetFor(ChildOf) : undefined
      if (parent !== undefined && world.has(parent) && parent.has(Transform)) m.premultiply(worldMatrix(parent, alpha, depth + 1))
      worldCache.set(eid, m)
      return m
    }

    /** Copies interpolated Transforms to Three.js objects. One loop, no per-entity closures. */
    const RenderSync = system(
      ({ time }) => {
        const alpha = time.alpha
        const ents = world.query(MeshRef, Transform)
        cacheFrame = -1
        worldCache.clear()
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i]!
          const obj = objects.get((e as number) & ENTITY_ID_MASK)
          if (!obj) continue
          if (e.targetFor(ChildOf) !== undefined) {
            worldMatrix(e, alpha).decompose(obj.position, obj.quaternion, obj.scale)
          } else writeTransform(e, obj, alpha)
        }
        cacheFrame = app.time.frame
      },
      { name: 'RenderSync', reads: [Transform, MeshRef], unchecked: true },
    )

    // ---- Instancing: one InstancedMesh per key, matrices rewritten each frame.
    const instMeshes = new Map<string, { mesh: THREE.InstancedMesh; count: number; colored: boolean }>()
    const tmpObj = new THREE.Object3D()
    const tmpMat = new THREE.Matrix4()
    const tmpColor = new THREE.Color()
    const counts = new Map<string, number>()
    function instMesh(key: string, need: number) {
      let rec = instMeshes.get(key)
      if (rec && rec.mesh.instanceMatrix.count >= need) return rec
      const def = instancedDefs.get(key)
      if (!def) {
        throw new KilnError(
          'unknown-instanced',
          `An entity has Instanced('${key}') but no mesh is defined for '${key}'. Call defineInstanced('${key}', { geometry, material }) in a module the game imports.`,
        )
      }
      let cap = rec?.mesh.instanceMatrix.count ?? def.capacity ?? 256
      while (cap < need) cap *= 2
      const mesh = new THREE.InstancedMesh(def.geometry, def.material, cap)
      mesh.frustumCulled = false
      mesh.castShadow = def.castShadow ?? false
      mesh.receiveShadow = def.receiveShadow ?? false
      mesh.name = `instanced:${key}`
      mesh.userData.kilnShared = true
      if (rec) {
        scene.remove(rec.mesh)
        rec.mesh.dispose()
      }
      scene.add(mesh)
      rec = { mesh, count: 0, colored: false }
      instMeshes.set(key, rec)
      return rec
    }
    app.hooks.dispose.push(() => {
      for (const r of instMeshes.values()) {
        scene.remove(r.mesh)
        r.mesh.dispose()
      }
      instMeshes.clear()
    })

    /** Writes Instanced entities' interpolated transforms into their shared InstancedMesh. */
    const InstanceSync = system(
      ({ time }) => {
        const ents = world.query(Instanced, Transform)
        for (const r of instMeshes.values()) r.count = 0
        if (ents.length > 0) {
          const keys = getStore(world, Instanced) as string[]
          counts.clear()
          for (let i = 0; i < ents.length; i++) {
            const k = keys[(ents[i]! as number) & ENTITY_ID_MASK]!
            counts.set(k, (counts.get(k) ?? 0) + 1)
          }
          for (const [k, n] of counts) instMesh(k, n)
          for (let i = 0; i < ents.length; i++) {
            const e = ents[i]!
            const rec = instMeshes.get(keys[(e as number) & ENTITY_ID_MASK]!)!
            if (e.targetFor(ChildOf) !== undefined) tmpMat.copy(worldMatrix(e, time.alpha))
            else {
              writeTransform(e, tmpObj, time.alpha)
              tmpMat.compose(tmpObj.position, tmpObj.quaternion, tmpObj.scale)
            }
            rec.mesh.setMatrixAt(rec.count, tmpMat)
            const c = e.get(InstanceColor)
            if (c || rec.colored) {
              tmpColor.setRGB(c?.r ?? 1, c?.g ?? 1, c?.b ?? 1)
              rec.mesh.setColorAt(rec.count, tmpColor)
              rec.colored = true
            }
            rec.count++
          }
        }
        for (const r of instMeshes.values()) {
          r.mesh.count = r.count
          r.mesh.instanceMatrix.needsUpdate = true
          if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true
        }
      },
      { name: 'InstanceSync', reads: [Transform, Instanced, InstanceColor], unchecked: true },
    )

    /** Draws the scene. */
    const Draw = system(
      ({ res }) => {
        const r = res.get(Renderer)
        if (!r.renderer) return
        r.renderer.render(res.get(Scene), res.get(Camera))
      },
      { name: 'Draw' },
    )
    app.add(Render, RenderSync, InstanceSync.after(RenderSync), Draw.after(RenderSync, InstanceSync))

    app.hooks.start.push(async (canvas) => {
      if (!canvas || typeof window === 'undefined') return
      const { WebGPURenderer } = await import('three/webgpu')
      const forceWebGL = options.forceWebGL ?? (new URLSearchParams(location.search).get('webgl') === '1' || !('gpu' in navigator))
      const renderer = new WebGPURenderer({ canvas, antialias: options.antialias ?? true, forceWebGL })
      await renderer.init()
      const state = app.resource(Renderer)
      state.renderer = renderer
      state.backend = (renderer.backend as any)?.isWebGPUBackend ? 'webgpu' : 'webgl2'
      // Lets the uncapped browser loop wait for submitted GPU work (see App.runLoop).
      const device = (renderer.backend as any)?.device as { queue?: { onSubmittedWorkDone?: () => Promise<void> } } | undefined
      if (device?.queue?.onSubmittedWorkDone) app.ext.gpuFence = () => device.queue!.onSubmittedWorkDone!()
      const camera = app.resource(Camera)
      const resize = () => {
        const w = canvas.clientWidth || canvas.width || 800
        const h = canvas.clientHeight || canvas.height || 600
        const pr = Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2)
        if (w === state.width && h === state.height && pr === state.pixelRatio) return
        state.width = w
        state.height = h
        state.pixelRatio = pr
        renderer.setPixelRatio(pr)
        renderer.setSize(w, h, false)
        const aspect = w / h
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          ;(camera as THREE.PerspectiveCamera).aspect = aspect
        } else {
          const ortho = camera as THREE.OrthographicCamera
          const vh = options.viewHeight ?? 20
          ortho.left = (-vh * aspect) / 2
          ortho.right = (vh * aspect) / 2
          ortho.top = vh / 2
          ortho.bottom = -vh / 2
        }
        camera.updateProjectionMatrix()
      }
      resize()
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
      ro?.observe(canvas)
      app.hooks.dispose.push(() => {
        ro?.disconnect()
        renderer.dispose()
        state.renderer = null
      })
    })
  }, 'RenderPlugin')
}

/** Renderer, scene, camera, RenderSync with interpolation, and the MeshRef lifecycle. */
export const RenderPlugin = renderPlugin()

/** The object an entity renders as, or undefined. */
export function objectOf(e: Entity): THREE.Object3D | undefined {
  return (e.get(MeshRef) as THREE.Object3D | null) ?? undefined
}

