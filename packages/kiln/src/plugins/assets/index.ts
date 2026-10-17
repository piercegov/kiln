import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { Not } from 'koota'
import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import { trait } from '../../core/koota.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Update } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'
import { MeshRef } from '../render/traits.ts'

export type { GLTF }

export type AssetKind = 'gltf' | 'texture' | 'json' | 'text' | 'binary'

/** A loading or loaded asset. Systems check `ready` (or `failed`) and never await. */
export interface AssetHandle<T = unknown> {
  readonly path: string
  readonly kind: AssetKind
  ready: boolean
  failed: boolean
  /** Why loading failed, naming the fix. */
  error: string | null
  value: T | null
  /** Resolves with the value; for code outside systems (startup scripts, tests). */
  readonly promise: Promise<T>
}

function kindOf(path: string): AssetKind {
  const ext = path.split('?')[0]!.split('.').pop()!.toLowerCase()
  if (ext === 'glb' || ext === 'gltf') return 'gltf'
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'ktx2'].includes(ext)) return 'texture'
  if (ext === 'json') return 'json'
  if (['txt', 'glsl', 'wgsl', 'csv', 'md'].includes(ext)) return 'text'
  return 'binary'
}

/** Three's loaders emit ProgressEvent, which Bun and Node lack. */
function polyfillHeadless(): void {
  const g = globalThis as any
  if (typeof g.ProgressEvent === 'undefined') {
    g.ProgressEvent = class ProgressEvent extends Event {
      lengthComputable: boolean
      loaded: number
      total: number
      constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
        super(type)
        this.lengthComputable = init.lengthComputable ?? false
        this.loaded = init.loaded ?? 0
        this.total = init.total ?? 0
      }
    }
  }
}

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined'

/** Reads a file headlessly from the game's public/ folder. */
async function readLocal(base: string, path: string): Promise<ArrayBuffer> {
  const fs = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const file = resolve(base, path.replace(/^\//, ''))
  try {
    const buf = await fs.readFile(file)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    throw new KilnError('asset-missing', `Asset "${path}" not found at ${file}. Put it in the game's public/ folder (public/${path.replace(/^\//, '')}).`)
  }
}

async function fetchBuffer(url: string, path: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok) {
    throw new KilnError('asset-missing', `Asset "${path}" failed to load (HTTP ${r.status}). Put it in the game's public/ folder (public/${path.replace(/^\//, '')}).`)
  }
  return r.arrayBuffer()
}

export interface AssetOptions {
  /** URL prefix in the browser. Default: Vite's base ('/'). */
  baseUrl?: string
  /** Folder for headless loads. Default: <game root>/public. */
  baseDir?: string
}

/**
 * Loads and caches assets by path. `res.get(Assets).load('models/ship.glb')` returns a handle at
 * once; loading happens in the background (tracked by app.idle()). Paths are relative to the
 * game's public/ folder.
 */
export class AssetStore {
  private cache = new Map<string, AssetHandle<any>>()
  private gltfLoader: Promise<any> | null = null

  constructor(
    private app: App,
    private options: AssetOptions,
  ) {}

  private url(path: string): string {
    if (/^(https?:|data:|blob:)/.test(path)) return path
    const base = this.options.baseUrl ?? ((import.meta as any).env?.BASE_URL as string | undefined) ?? '/'
    return base.replace(/\/?$/, '/') + path.replace(/^\//, '')
  }

  private baseDir(): string {
    const root = (globalThis as any).__KILN_ROOT__ ?? (globalThis as any).process?.cwd?.() ?? '.'
    return this.options.baseDir ?? `${root}/public`
  }

  private async buffer(path: string): Promise<ArrayBuffer> {
    if (isBrowser() || /^(https?:|data:)/.test(path)) return fetchBuffer(this.url(path), path)
    return readLocal(this.baseDir(), path)
  }

  /** Starts loading (once per path) and returns the handle. */
  load<T = unknown>(path: string, kind: AssetKind = kindOf(path)): AssetHandle<T> {
    const hit = this.cache.get(path)
    if (hit) return hit as AssetHandle<T>
    let resolveP!: (v: T) => void
    let rejectP!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolveP = res
      rejectP = rej
    })
    promise.catch(() => {})
    const handle: AssetHandle<T> = { path, kind, ready: false, failed: false, error: null, value: null, promise }
    this.cache.set(path, handle)
    this.app.track(
      this.fetchAs<T>(path, kind).then(
        (v) => {
          handle.value = v
          handle.ready = true
          resolveP(v)
        },
        (err) => {
          handle.failed = true
          handle.error = err instanceof Error ? err.message : String(err)
          console.error(`[kiln] ${handle.error}`)
          rejectP(err)
        },
      ),
    )
    return handle
  }

  gltf(path: string): AssetHandle<GLTF> {
    return this.load<GLTF>(path, 'gltf')
  }
  texture(path: string): AssetHandle<THREE.Texture> {
    return this.load<THREE.Texture>(path, 'texture')
  }
  json<T = unknown>(path: string): AssetHandle<T> {
    return this.load<T>(path, 'json')
  }

  /** The handle for a path if it was requested. */
  get<T = unknown>(path: string): AssetHandle<T> | undefined {
    return this.cache.get(path) as AssetHandle<T> | undefined
  }

  /** Number of assets still loading. */
  get pending(): number {
    let n = 0
    for (const h of this.cache.values()) if (!h.ready && !h.failed) n++
    return n
  }

  /** A new instance of a loaded model's scene. Geometry and materials are shared with the cache. */
  instantiate(handle: AssetHandle<GLTF>): THREE.Object3D | null {
    if (!handle.ready || !handle.value) return null
    const clone = this.cloneFn ? this.cloneFn(handle.value.scene) : handle.value.scene.clone(true)
    clone.userData.kilnShared = true
    clone.userData.kilnAsset = handle.path
    return clone
  }

  private cloneFn: ((o: THREE.Object3D) => THREE.Object3D) | null = null

  private async fetchAs<T>(path: string, kind: AssetKind): Promise<T> {
    switch (kind) {
      case 'json':
        return JSON.parse(new TextDecoder().decode(await this.buffer(path))) as T
      case 'text':
        return new TextDecoder().decode(await this.buffer(path)) as T
      case 'binary':
        return (await this.buffer(path)) as T
      case 'texture': {
        if (!isBrowser()) {
          // Headless: a placeholder texture; pixels don't affect the simulation.
          await this.buffer(path)
          const t = new THREE.Texture()
          t.name = path
          t.userData.headless = true
          return t as T
        }
        const tex = await new THREE.TextureLoader().loadAsync(this.url(path))
        tex.colorSpace = THREE.SRGBColorSpace
        tex.name = path
        return tex as T
      }
      case 'gltf': {
        if (!isBrowser()) polyfillHeadless()
        this.gltfLoader ??= Promise.all([
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/utils/SkeletonUtils.js'),
        ]).then(([{ GLTFLoader }, skel]) => {
          this.cloneFn = (o) => skel.clone(o)
          return new GLTFLoader()
        })
        const loader = await this.gltfLoader
        const buf = await this.buffer(path)
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
        return (await loader.parseAsync(buf, isBrowser() ? this.url(dir) : '')) as T
      }
    }
  }

  /** Frees GPU resources for everything loaded. Called when the app is disposed. */
  dispose(): void {
    for (const h of this.cache.values()) {
      const v = h.value as any
      if (!v) continue
      if (v.isTexture) v.dispose()
      if (v.scene) {
        v.scene.traverse((o: any) => {
          o.geometry?.dispose?.()
          const m = o.material
          for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
            for (const val of Object.values(mat)) if ((val as any)?.isTexture) (val as THREE.Texture).dispose()
            mat.dispose()
          }
        })
      }
    }
    this.cache.clear()
  }
}

/** The asset cache. Use `res.get(Assets).load(path)`. */
export const Assets = resource((app): AssetStore => {
  const store = new AssetStore(app, (app.ext.assetOptions ?? {}) as AssetOptions)
  app.hooks.dispose.push(() => store.dispose())
  return store
}, { readonlyProxy: false }).named('Assets')

/**
 * A model to show once loaded: `commands.spawn(Transform, Model(res.get(Assets).gltf('ship.glb')))`.
 * When the handle is ready, the entity gets a MeshRef with a shared-geometry instance.
 */
export const Model = trait(() => null as AssetHandle<GLTF> | null)

/** Builds an assets plugin with options. */
export function assetsPlugin(options: AssetOptions = {}) {
  return plugin((app) => {
    app.ext.assetOptions = options
    app.init(Assets)
    /** Gives entities with a ready Model their MeshRef instance. */
    const SpawnModels = system(
      { pending: [Model, Not(MeshRef)] },
      ({ pending }, { res, commands }) => {
        if (pending.length === 0) return
        const assets = res.get(Assets)
        pending.forEach((e) => {
          const h = e.get(Model) as AssetHandle<GLTF> | null
          if (!h?.ready) return
          const obj = assets.instantiate(h)
          if (obj) commands.add(e, MeshRef(obj))
        })
      },
      { name: 'SpawnModels' },
    )
    app.add(Update, SpawnModels)
  }, 'AssetsPlugin')
}

/** GLTF, textures, JSON; handles cached by path, never blocking a phase. */
export const AssetsPlugin = assetsPlugin()
