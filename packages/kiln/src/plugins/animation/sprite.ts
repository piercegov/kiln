import * as THREE from 'three'
import type { Entity } from 'koota'
import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import { trait } from '../../core/koota.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed } from '../../core/schedule.ts'
import { Mut } from '../../core/access.ts'
import { system } from '../../core/system.ts'
import { Assets } from '../assets/index.ts'
import { MeshRef } from '../render/traits.ts'
import {
  AnimationController,
  AnimationEvent,
  AnimationFinished,
  AnimationStateChanged,
  frameIndex,
  type AnimationGraph,
  EventSink,
  type ClipInfo,
  type LoopMode,
} from './graph.ts'

const sink = new EventSink()

/** A clip on a sprite sheet: `range: [8, 15]` (inclusive) or `frames: [0, 1, 2, 1]`, at `fps`. */
export interface SpriteClipSpec {
  range?: readonly [number, number]
  frames?: readonly number[]
  /** Frames per second. Default 10. */
  fps?: number
  /** Default 'loop'. A graph state can override it. */
  loop?: LoopMode
}

/** A frame rectangle in pixels, from the image's top-left corner. */
export interface AtlasRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SpriteSheetSpec<C extends string = string> {
  /** An image path in public/ (loaded through Assets), a THREE.Texture, or null for an untextured quad. */
  texture: string | THREE.Texture | null
  /** Grid sheets: frames are numbered left to right, top to bottom. */
  columns?: number
  rows?: number
  /** Atlas sheets: the image size and each frame's rectangle in pixels. Frame numbers index this list. */
  atlas?: { width: number; height: number; frames: readonly AtlasRect[] }
  clips: { readonly [K in C]: SpriteClipSpec }
  /** World units of one frame, [width, height]. Default [1, 1]. */
  size?: readonly [number, number]
  /** Where the Transform sits on the quad, 0..1 from the bottom-left: [0.5, 0] puts it at the feet. Default [0.5, 0.5]. */
  pivot?: readonly [number, number]
  /** 'nearest' keeps pixel art crisp (default); 'linear' smooths. */
  filter?: 'nearest' | 'linear'
  /** Tint multiplied with the texture. Default white. */
  color?: THREE.ColorRepresentation
}

interface ResolvedClip extends ClipInfo {
  /** Sheet frame numbers in play order. */
  sheetFrames: number[]
}

/** A validated sprite sheet: frame UVs and clips. Made by `spriteSheet`. */
export interface SpriteSheet {
  readonly kind: 'kiln.spriteSheet'
  readonly spec: SpriteSheetSpec
  /** [u0, v0, u1, v1] per sheet frame. */
  readonly uvs: readonly (readonly [number, number, number, number])[]
  readonly clips: ReadonlyMap<string, ResolvedClip>
}

/**
 * Defines a sprite sheet and its clips:
 * `spriteSheet({ texture: 'sprites/hero.png', columns: 4, rows: 2, clips: { idle: { range: [0, 3], fps: 6 }, run: { range: [4, 7], fps: 12 } } })`.
 * Grid sheets number frames left to right, top to bottom; atlas sheets index `atlas.frames`.
 */
export function spriteSheet<const C extends string>(spec: SpriteSheetSpec<C>): SpriteSheet {
  const uvs: [number, number, number, number][] = []
  if (spec.atlas) {
    const { width: W, height: H } = spec.atlas
    for (const r of spec.atlas.frames) uvs.push([r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H])
  } else {
    const cols = spec.columns ?? 1
    const rows = spec.rows ?? 1
    if (cols < 1 || rows < 1) throw new KilnError('sprite-grid', 'spriteSheet() columns and rows must be at least 1.')
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) uvs.push([c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows])
  }
  const clips = new Map<string, ResolvedClip>()
  for (const [name, c] of Object.entries(spec.clips) as [string, SpriteClipSpec][]) {
    let frames: number[]
    if (c.frames) frames = [...c.frames]
    else if (c.range) {
      const [a, b] = c.range
      frames = []
      for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) frames.push(i)
    } else throw new KilnError('sprite-clip', `Sprite clip '${name}' needs range: [first, last] or frames: [...].`)
    if (frames.length === 0) throw new KilnError('sprite-clip', `Sprite clip '${name}' has no frames.`)
    for (const f of frames) {
      if (!Number.isInteger(f) || f < 0 || f >= uvs.length) {
        throw new KilnError('sprite-frame', `Sprite clip '${name}' uses frame ${f}, but the sheet has frames 0..${uvs.length - 1}. Fix the clip or the sheet's columns/rows/atlas.`)
      }
    }
    const fps = c.fps ?? 10
    clips.set(name, { duration: frames.length / fps, loop: c.loop ?? 'loop', frames: frames.length, fps, sheetFrames: frames })
  }
  if (clips.size === 0) throw new KilnError('sprite-clip', 'spriteSheet() needs at least one clip: clips: { idle: { range: [0, 3] } }.')
  return { kind: 'kiln.spriteSheet', spec, uvs, clips }
}

export interface SpriteAnimatorOptions {
  /** The state graph. Default: one state per clip, switched with play(). */
  graph?: AnimationGraph
  /** State to start in instead of the graph's initial state (or the first clip). */
  play?: string
  /** Mirror horizontally (face left). */
  flipX?: boolean
  /** Playback rate multiplier. Default 1. */
  speed?: number
}

/**
 * A sprite entity's animation: the shared controller (`set`, `trigger`, `play`, `state`, `time`)
 * plus the sheet, the shown `frame` (sheet frame number), `clipFrame` (index within the clip),
 * and `flipX`. Made by `spriteAnimator(sheet, options)`.
 */
export class SpriteAnimation extends AnimationController {
  sheet: SpriteSheet | null
  /** The sheet frame on screen. */
  frame = -1
  /** The frame's index within the current clip. */
  clipFrame = 0
  flipX: boolean
  /** The quad the plugin made (its MeshRef). */
  mesh: THREE.Mesh | null = null
  /** What the UVs were last written for. */
  shown = { frame: -1, flipX: false, texW: 0, texH: 0 }

  constructor(sheet: SpriteSheet | null = null, options: SpriteAnimatorOptions = {}) {
    super(options.graph ?? null, options.play)
    this.sheet = sheet
    this.flipX = options.flipX ?? false
    this.speed = options.speed ?? 1
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), frame: this.frame, ...(this.flipX ? { flipX: true } : {}) }
  }
}

/**
 * Plays sprite-sheet clips through an animation graph. Add it with `spriteAnimator(sheet, { graph })`;
 * the plugin gives the entity a textured quad (MeshRef). Rows from `Mut(SpriteAnimator)` take
 * `set(param, v)`, `trigger(name)`, `play(state)`, `flipX`.
 */
export const SpriteAnimator = trait(() => new SpriteAnimation())

/** The SpriteAnimator for a sheet: `commands.spawn(Transform, spriteAnimator(HeroSheet, { graph: HeroAnim }))`. */
export function spriteAnimator(sheet: SpriteSheet, options: SpriteAnimatorOptions = {}) {
  if (sheet?.kind !== 'kiln.spriteSheet') throw new KilnError('not-a-sheet', 'spriteAnimator(sheet, options) needs a sheet made with spriteSheet({...}) first.')
  return SpriteAnimator(new SpriteAnimation(sheet, options))
}

/** Per-app sprite resources: one material per sheet, the quads made for entities. */
export class SpriteSheetStore {
  private materials = new Map<SpriteSheet, THREE.MeshBasicMaterial>()
  /** Quads by entity, so despawn can dispose them. */
  readonly quads = new Map<Entity, THREE.Mesh>()

  constructor(private readonly app: App) {}

  /** The shared material for a sheet; a texture path loads through Assets and becomes its map when ready. */
  material(sheet: SpriteSheet): THREE.MeshBasicMaterial {
    let m = this.materials.get(sheet)
    if (!m) {
      const s = sheet.spec
      const material = new THREE.MeshBasicMaterial({ color: s.color ?? 0xffffff, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide })
      if (typeof s.texture === 'string') {
        // The map arrives with the texture, between steps or before the next draw.
        const handle = this.app.resource(Assets).texture(s.texture)
        if (handle.ready) this.useTexture(material, handle.value!, s)
        else handle.promise.then((tex) => this.useTexture(material, tex, s), () => {})
      } else if (s.texture) this.useTexture(material, s.texture, s)
      m = material
      this.materials.set(sheet, m)
    }
    return m
  }

  private useTexture(material: THREE.MeshBasicMaterial, tex: THREE.Texture, s: SpriteSheetSpec): void {
    const nearest = (s.filter ?? 'nearest') === 'nearest'
    tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter
    tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter
    // Mip levels average neighbouring frames together; pixel art never needs them.
    tex.generateMipmaps = !nearest
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    material.map = tex
    material.needsUpdate = true
  }

  /** A new quad for an entity: own geometry (its UVs change), shared material. */
  quad(entity: Entity, sheet: SpriteSheet): THREE.Mesh {
    const [w, h] = sheet.spec.size ?? [1, 1]
    const [px, py] = sheet.spec.pivot ?? [0.5, 0.5]
    const geo = new THREE.PlaneGeometry(w, h).translate((0.5 - px) * w, (0.5 - py) * h, 0)
    const mesh = new THREE.Mesh(geo, this.material(sheet))
    mesh.name = 'sprite'
    // Render must not dispose the shared material; the plugin disposes the geometry on despawn.
    mesh.userData.kilnShared = true
    this.quads.set(entity, mesh)
    return mesh
  }

  release(entity: Entity): void {
    const q = this.quads.get(entity)
    if (!q) return
    this.quads.delete(entity)
    q.geometry.dispose()
  }

  dispose(): void {
    for (const q of this.quads.values()) q.geometry.dispose()
    this.quads.clear()
    for (const m of this.materials.values()) m.dispose()
    this.materials.clear()
  }
}

/** Sprite sheet materials and the quads made for SpriteAnimator entities. */
export const SpriteSheets = resource((app): SpriteSheetStore => {
  const store = new SpriteSheetStore(app)
  app.hooks.dispose.push(() => store.dispose())
  return store
}, { readonlyProxy: false }).named('SpriteSheets')

/**
 * A frame's UV rectangle [u0, v0, u1, v1], pulled in by half a texel on each side when the image
 * size is known. Edges exactly on the frame boundary sample the neighbouring frame at sub-pixel
 * positions (and under linear filtering), which shows as a border of the next frame.
 */
export function frameUvs(sheet: SpriteSheet, frame: number, texW = 0, texH = 0): [number, number, number, number] {
  const [u0, v0, u1, v1] = sheet.uvs[frame]!
  const w = texW || sheet.spec.atlas?.width || 0
  const h = texH || sheet.spec.atlas?.height || 0
  const du = w > 0 ? Math.min(0.5 / w, (u1 - u0) / 2) : 0
  const dv = h > 0 ? Math.min(0.5 / h, (v1 - v0) / 2) : 0
  return [u0 + du, v0 + dv, u1 - du, v1 - dv]
}

/** The pixel size of a material's map, or 0 while it is loading (headless placeholders have none). */
function mapSize(mesh: THREE.Mesh): [number, number] {
  const img = (mesh.material as THREE.MeshBasicMaterial).map?.image as { width?: number; height?: number } | undefined
  return [img?.width ?? 0, img?.height ?? 0]
}

/** Writes a frame's UVs into a quad (flipped for flipX). */
function writeUvs(mesh: THREE.Mesh, uv: readonly [number, number, number, number], flipX: boolean): void {
  const attr = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  const [a, v0, b, v1] = uv
  const u0 = flipX ? b : a
  const u1 = flipX ? a : b
  // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
  attr.setXY(0, u0, v1)
  attr.setXY(1, u1, v1)
  attr.setXY(2, u0, v0)
  attr.setXY(3, u1, v0)
  attr.needsUpdate = true
}

/**
 * Advances every SpriteAnimator one fixed step: play() requests, graph transitions, the playhead,
 * events (AnimationEvent, AnimationStateChanged, AnimationFinished) and the quad's frame. Gives
 * new sprites their quad. Systems that set params or triggers in Fixed go `.before(AnimateSprites)`.
 */
export const AnimateSprites = system(
  [Mut(SpriteAnimator)],
  ([anim], { entity, time, events, res, commands }) => {
    const sheet = anim.sheet
    if (!sheet) {
      throw new KilnError('sprite-no-sheet', 'A SpriteAnimator has no sheet. Spawn it with spriteAnimator(MySheet, { graph }) instead of the bare SpriteAnimator trait.')
    }
    if (!anim.mesh) {
      const store = res.mut(SpriteSheets)
      anim.mesh = store.quad(entity, sheet)
      commands.add(entity, MeshRef(anim.mesh))
    }
    if (!anim.bound) anim.bind(sheet.clips, 'the sprite sheet')
    anim.step(time.step, sink.for(entity, events))
    const info = anim.clipInfo(anim.clip) as ResolvedClip
    anim.clipFrame = frameIndex(info, anim.loop, anim.time)
    anim.frame = info.sheetFrames[anim.clipFrame]!
    const [texW, texH] = mapSize(anim.mesh)
    const shown = anim.shown
    // The texture's size arriving also rewrites, so the half-texel inset applies once it is known.
    if (anim.frame !== shown.frame || anim.flipX !== shown.flipX || texW !== shown.texW || texH !== shown.texH) {
      writeUvs(anim.mesh, frameUvs(sheet, anim.frame, texW, texH), anim.flipX)
      shown.frame = anim.frame
      shown.flipX = anim.flipX
      shown.texW = texW
      shown.texH = texH
    }
  },
)

/**
 * Sprite-sheet animation for `mode: '2d'`: sheets with clips (`spriteSheet`), `spriteAnimator(sheet,
 * { graph })` on entities, the shared animation graph, and frame events. Ticks in Fixed. Quads face
 * +z, so z stays the draw order (in 3D they are flat cards). Needs CorePlugins.
 */
export const SpriteAnimationPlugin = plugin((app) => {
  app.init(SpriteSheets, AnimationEvent, AnimationStateChanged, AnimationFinished)
  app.add(Fixed, AnimateSprites)
  const store = app.resource(SpriteSheets)
  const unsub = app.world.onRemove(SpriteAnimator, (e) => store.release(e))
  app.hooks.dispose.push(unsub)
}, 'SpriteAnimationPlugin')
