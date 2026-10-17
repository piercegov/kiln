// Positional sounds tied to Transform, on Web Audio via Three.js. Vendored by `kiln add audio`.
import * as THREE from 'three'
import { Camera, event, plugin, resource, Scene, system, trait, Transform, Update, type App, type Entity } from 'kiln'

/**
 * A looping or one-time sound at this entity's Transform:
 * `commands.spawn(Transform({ x: 4 }), Sound({ src: '/sfx/waterfall.ogg', loop: true }))`.
 * `src` is a URL (files in the game's `public/` folder are served from `/`), `volume` 0..1+,
 * `refDistance` the distance in world units at which volume starts to fall off. `autoplay` starts it
 * once the file has loaded (browsers wait for the first click or key press before any audio plays).
 * Without a Transform the sound is not positional. Headless (tests, `kiln run`) nothing loads or plays.
 */
export const Sound = trait({ src: '', volume: 1, loop: false, autoplay: true, refDistance: 4 })

/**
 * Plays a one-shot: `events.emit(PlaySound, { src: '/sfx/coin.ogg', entity })`. With an entity that
 * has a Transform the sound plays positionally at that spot; without one it plays flat.
 */
export const PlaySound = event<{ entity?: Entity; src: string; volume?: number }>()

/**
 * Audio state: the `THREE.AudioListener` attached to the Camera (null headless or before the first
 * frame) and a master `volume`. Change the volume with `res.mut(AudioState).volume = 0.5`.
 */
export const AudioState = resource(
  (): { listener: THREE.AudioListener | null; volume: number; failed: string[] } => ({ listener: null, volume: 1, failed: [] }),
  { readonlyProxy: false },
).named('AudioState')

interface Voice {
  audio: THREE.PositionalAudio | THREE.Audio
  src: string
  started: boolean
  seen: number
}

/** True only where Web Audio exists and the app is running for real. */
function canPlay(app: App): boolean {
  return !app.headless && typeof window !== 'undefined' && (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')
}

/**
 * Positional audio: `app.use(AudioPlugin)`, then spawn `Sound` entities or emit `PlaySound`.
 * A no-op headless. Missing or undecodable files log one warning and stay silent.
 */
export const AudioPlugin = plugin((app) => {
  app.init(AudioState, PlaySound)
  const voices = new Map<Entity, Voice>()
  const oneShots = new Set<THREE.Audio | THREE.PositionalAudio>()
  const buffers = new Map<string, Promise<AudioBuffer | null>>()
  let loader: THREE.AudioLoader | null = null
  let frame = 0
  let unlock: (() => void) | null = null

  const load = (src: string, state: { failed: string[] }): Promise<AudioBuffer | null> => {
    let p = buffers.get(src)
    if (p) return p
    loader ??= new THREE.AudioLoader()
    const l = loader
    p = new Promise<AudioBuffer | null>((resolve) => {
      l.load(
        src,
        (buf) => resolve(buf),
        undefined,
        (err) => {
          state.failed.push(src)
          console.warn(`[audio] couldn't load '${src}' (${(err as Error)?.message ?? err}). Check the path; files in public/ are served from '/'.`)
          resolve(null)
        },
      )
    })
    buffers.set(src, p)
    app.track(p)
    return p
  }

  const listenerFor = (state: { listener: THREE.AudioListener | null }, camera: THREE.Camera): THREE.AudioListener => {
    if (state.listener) return state.listener
    const listener = new THREE.AudioListener()
    camera.add(listener)
    state.listener = listener
    // Browsers keep the AudioContext suspended until a user gesture.
    const resume = () => {
      if (listener.context.state === 'suspended') void listener.context.resume()
    }
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
    unlock = () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
    }
    return listener
  }

  const stop = (a: THREE.Audio | THREE.PositionalAudio) => {
    try {
      if (a.isPlaying) a.stop()
    } catch {}
    a.removeFromParent()
    try {
      a.disconnect()
    } catch {}
  }

  /** Starts, moves and stops Sound entities and plays PlaySound one-shots. */
  const UpdateAudio = system(
    { sounds: [Sound] },
    ({ sounds }, { res, events }) => {
      const shots = events.read(PlaySound)
      if (!canPlay(app)) return
      frame++
      const state = res.mut(AudioState)
      const scene = res.mut(Scene)
      const camera = res.mut(Camera)
      const listener = listenerFor(state, camera)
      listener.setMasterVolume(state.volume)

      sounds.forEach((e) => {
        const s = e.get(Sound)!
        let v = voices.get(e)
        if (v && v.src !== s.src) {
          stop(v.audio)
          voices.delete(e)
          v = undefined
        }
        const positional = e.has(Transform)
        if (!v) {
          if (!s.src) return
          const audio = positional ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener)
          scene.add(audio)
          v = { audio, src: s.src, started: false, seen: frame }
          voices.set(e, v)
          const voice = v
          void load(s.src, state).then((buf) => {
            if (!buf || voices.get(e) !== voice) return
            voice.audio.setBuffer(buf)
            voice.audio.setLoop(s.loop)
            if (s.autoplay && !voice.started) {
              voice.started = true
              voice.audio.play()
            }
          })
        }
        v.seen = frame
        v.audio.setVolume(s.volume)
        if (v.audio.getLoop() !== s.loop && v.audio.buffer) v.audio.setLoop(s.loop)
        if (positional) {
          const t = e.get(Transform)!
          v.audio.position.set(t.x, t.y, t.z)
          ;(v.audio as THREE.PositionalAudio).setRefDistance?.(s.refDistance)
        }
      })
      for (const [e, v] of voices) {
        if (v.seen === frame) continue
        stop(v.audio)
        voices.delete(e)
      }

      for (const shot of shots) {
        if (!shot?.src) continue
        const at = shot.entity !== undefined && app.world.has(shot.entity) && shot.entity.has(Transform) ? shot.entity.get(Transform)! : null
        const audio = at ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener)
        if (at) audio.position.set(at.x, at.y, at.z)
        audio.setVolume(shot.volume ?? 1)
        scene.add(audio)
        oneShots.add(audio)
        void load(shot.src, state).then((buf) => {
          if (!buf || !oneShots.has(audio)) return
          audio.setBuffer(buf)
          const ended = audio.onEnded.bind(audio)
          audio.onEnded = () => {
            ended()
            oneShots.delete(audio)
            stop(audio)
          }
          audio.play()
        })
      }
    },
    { name: 'UpdateAudio' },
  )
  app.add(Update, UpdateAudio)

  app.hooks.dispose.push(() => {
    for (const v of voices.values()) stop(v.audio)
    for (const a of oneShots) stop(a)
    voices.clear()
    oneShots.clear()
    unlock?.()
    const state = app.hasResource(AudioState) ? app.resource(AudioState) : null
    if (state?.listener) {
      state.listener.removeFromParent()
      state.listener = null
    }
  })
}, 'AudioPlugin')
