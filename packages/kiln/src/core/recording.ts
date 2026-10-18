/**
 * Recordings: a play session as data, replayable headless. A recording holds everything that
 * reaches the simulation from outside: the seed and loop config, every frame's delta, the input the
 * game saw, and side-channel events plugins note between frames (DOM button clicks, asset loads
 * finishing). Replaying it on a fresh app runs the same frames with the same inputs; checkpoints (a
 * state hash every N frames) show where a replay stops matching the session.
 *
 * In the browser, dev builds record from boot; F8 or a crash saves to recordings/ in the game.
 * Headless: `new Recorder(app)` before Startup, then `recorder.stop()`.
 */
import type { App } from './app.ts'
import { KilnError } from './errors.ts'
import type { ScriptEvent } from './input-types.ts'
import { Rng } from './rng.ts'
import { takeSnapshot, type Snapshot } from './snapshot.ts'

/** A side-channel event a plugin noted between frames, applied before frame `frame` runs. */
export interface ChannelEvent {
  frame: number
  kind: string
  data: unknown
}

/** A recorded session. JSON; save it under recordings/ and replay it with `replay()` or `kiln replay`. */
export interface Recording {
  kiln: 'recording'
  version: 1
  /** The loop config the session ran with. Replays build the app with the same values. */
  config: { seed: number; fixedHz: number; maxFrameDt: number; maxFixedSteps: number; mode: '2d' | '3d' }
  /** Frames recorded. Frame 1 is the first frame after Startup. */
  frames: number
  /** Each frame's delta in seconds (clamped by maxFrameDt), dt[0] for frame 1. */
  dt: number[]
  /** Frames that ran exactly one fixed step (the debug panel's "Step 1 frame"). */
  exact: number[]
  /** What the game saw from the input plugin, as an input script relative to boot. */
  input: ScriptEvent[]
  /** Outside state the session started with, by plugin ('save': the game's stored saves and settings). */
  start?: Record<string, unknown>
  /** Side-channel events: 'ui-click' (DOM HUD buttons), 'asset' (a load finished). */
  channels: ChannelEvent[]
  /** Checkpoint spacing in frames and rounding (decimals) for the state hashes. */
  checkEvery: number
  checkPrecision: number
  /** State hash (entities and Rng) after the frame's Late phase, every checkEvery frames. */
  checks: { frame: number; hash: string }[]
  /** Entities and resources when the recording was taken (precision 4). */
  final?: Snapshot
  /** The error that stopped the session, if one did. */
  error?: { frame: number; message: string; code?: string }
  /** Things a reader should know (hot swaps mid-session). */
  notes: string[]
  recordedAt?: string
}

export interface RecorderOptions {
  /** Frames between state checkpoints. Default 60. 0 turns checkpoints off. */
  checkEvery?: number
  /** Decimals the checkpoint hash rounds numbers to. Default 5. */
  checkPrecision?: number
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Hash of the simulation state: every entity's JSON trait values plus the Rng, rounded. */
export function stateHash(app: App, precision = 5): string {
  const snap = takeSnapshot(app, { precision, resources: [Rng] })
  return fnv1a(JSON.stringify({ tick: snap.tick, entities: snap.entities, resources: snap.resources }))
}

/** Records a session. Create it before Startup (before app.boot() or app.start()). */
export class Recorder {
  readonly checkEvery: number
  readonly checkPrecision: number
  private readonly startFrame: number
  private dt: number[] = []
  private exact: number[] = []
  private channels: ChannelEvent[] = []
  private checks: { frame: number; hash: string }[] = []
  private notes: string[] = []
  private error: Recording['error']
  private input: { stop(): ScriptEvent[]; peek(): ScriptEvent[] } | null
  private active = true
  private start: Record<string, unknown> = {}

  constructor(
    private app: App,
    options: RecorderOptions = {},
  ) {
    if (app.isBooted) {
      throw new KilnError(
        'record-after-boot',
        'A Recorder has to start before Startup so a replay can rebuild the session from boot. Create it before app.boot()/app.start(), or build with scenarioApp({ startup: false }).',
      )
    }
    this.checkEvery = options.checkEvery ?? 60
    this.checkPrecision = options.checkPrecision ?? 5
    this.startFrame = app.time.frame
    for (const [kind, s] of Object.entries(startStates(app))) this.start[kind] = s.capture()
    this.input = app.ext.input ? app.input.record() : null
    app.ext.recorder = this
    app.hooks.frameStart.push((dt, exact) => {
      if (!this.active) return
      this.dt.push(dt)
      if (exact) this.exact.push(this.frame)
    })
    app.hooks.frameEnd.push(() => {
      if (!this.active || this.checkEvery <= 0 || this.frame % this.checkEvery !== 0) return
      this.checks.push({ frame: this.frame, hash: stateHash(app, this.checkPrecision) })
    })
    app.hooks.error.push((err) => {
      if (!this.active || this.error) return
      const e = err as { message?: string; code?: string }
      this.error = { frame: this.frame, message: e?.message ?? String(err), ...(e?.code ? { code: e.code } : {}) }
    })
  }

  /** Frames recorded so far. */
  get frame(): number {
    return this.app.time.frame - this.startFrame
  }

  /** True until stop(). */
  get recording(): boolean {
    return this.active
  }

  /** Notes a side-channel event; it applies before the next frame, as it did live. Plugins call this. */
  note(kind: string, data: unknown): void {
    if (this.active) this.channels.push({ frame: this.frame + 1, kind, data })
  }

  /** Adds a line to the recording's notes. */
  addNote(text: string): void {
    if (this.active) this.notes.push(`frame ${this.frame}: ${text}`)
  }

  /** The recording so far. Recording continues. */
  take(): Recording {
    const input = this.input?.peek() ?? []
    const c = this.app.config
    let final: Snapshot | undefined
    try {
      final = takeSnapshot(this.app, { precision: 4, resources: true })
    } catch {
      final = undefined
    }
    return {
      kiln: 'recording',
      version: 1,
      config: { seed: c.seed, fixedHz: c.fixedHz, maxFrameDt: c.maxFrameDt, maxFixedSteps: c.maxFixedSteps, mode: c.mode },
      frames: this.dt.length,
      dt: [...this.dt],
      exact: [...this.exact],
      input,
      ...(Object.keys(this.start).length ? { start: structuredClone(this.start) } : {}),
      channels: this.channels.map((e) => ({ ...e })),
      checkEvery: this.checkEvery,
      checkPrecision: this.checkPrecision,
      checks: [...this.checks],
      ...(final ? { final } : {}),
      ...(this.error ? { error: { ...this.error } } : {}),
      notes: [...this.notes],
      recordedAt: new Date().toISOString(),
    }
  }

  /** Stops recording and returns the recording. */
  stop(): Recording {
    if (!this.active) throw new KilnError('recorder-stopped', 'This Recorder was already stopped. Keep the Recording stop() returned the first time.')
    const rec = this.take()
    this.active = false
    this.input?.stop()
    if (this.app.ext.recorder === this) this.app.ext.recorder = undefined
    return rec
  }
}

/** For plugins: notes a side-channel event if the app is recording. */
export function noteChannel(app: App, kind: string, data: unknown): void {
  ;(app.ext.recorder as Recorder | undefined)?.note(kind, data)
}

type ChannelApply = (data: unknown) => void | Promise<void>

interface StartState {
  capture(): unknown
  restore(data: unknown): void
}

function startStates(app: App): Record<string, StartState> {
  return (app.ext.recordStartStates ??= {}) as Record<string, StartState>
}

/**
 * For plugins: state from outside the simulation that a session starts with (stored saves). A
 * Recorder captures it when recording starts; a replay restores it before Startup.
 */
export function recordStartState(app: App, kind: string, capture: () => unknown, restore: (data: unknown) => void): void {
  startStates(app)[kind] = { capture, restore }
}

/** For plugins: how a replay applies this plugin's side-channel events. */
export function replayChannel(app: App, kind: string, apply: ChannelApply): void {
  ;((app.ext.replayChannels ??= {}) as Record<string, ChannelApply>)[kind] = apply
}

/** True while the app is set up for a replay (plugins hold back asset loads until the recording says). */
export function isReplaying(app: App): boolean {
  return app.ext.replay !== undefined
}

/** What a replay found. */
export interface ReplayResult {
  /** Frames played so far, and in the recording. */
  frames: number
  total: number
  /** Checkpoints compared so far. */
  checked: number
  /**
   * The first checkpoint frame whose state hash differs from the session, or null if all matched.
   * Expected after the game's code changes (a fix changes the state); before a change it means the
   * headless run drifted from the browser (physics, Math.* differences between engines, wall-clock
   * reads), and frames after it may not reproduce what the player saw.
   */
  divergedAt: number | null
  /** The recording's notes plus anything the replay noticed. */
  notes: string[]
  /** The error the session ended with, if any; a faithful replay throws it at the same frame. */
  recordedError?: Recording['error']
}

/** Checks a parsed JSON value is a recording, with a message that says what is wrong. */
export function asRecording(value: unknown, source = 'recording'): Recording {
  const r = value as Partial<Recording> | null
  if (!r || r.kiln !== 'recording' || !Array.isArray(r.dt) || !r.config) {
    throw new KilnError('not-a-recording', `${source} is not a Kiln recording. Save one with F8 in the dev server (or Recorder.stop()) and pass that JSON.`)
  }
  if (r.version !== 1) throw new KilnError('recording-version', `${source} is recording version ${r.version}; this Kiln reads version 1. Record the session again.`)
  return r as Recording
}

/**
 * Plays a recording on an app that hasn't run Startup. Call `play()` to advance (all frames, or
 * up to a frame); the app can be inspected and stepped between calls.
 */
export class Replayer {
  readonly recording: Recording
  private next = 1
  private checks: Map<number, string>
  private channels = new Map<number, ChannelEvent[]>()
  private exact: Set<number>
  private result: ReplayResult
  private warned = new Set<string>()

  constructor(
    private app: App,
    recording: Recording,
  ) {
    const rec = (this.recording = asRecording(recording))
    if (app.isBooted) {
      throw new KilnError(
        'replay-after-boot',
        'A replay starts from boot, so the app must not have run Startup yet. Use replayApp(), or scenarioApp({ startup: false }) and then new Replayer(app, recording).',
      )
    }
    const c = app.config
    for (const k of ['seed', 'fixedHz', 'maxFrameDt', 'maxFixedSteps', 'mode'] as const) {
      if (c[k] !== rec.config[k]) {
        throw new KilnError(
          'replay-config',
          `The recording ran with ${k} ${JSON.stringify(rec.config[k])} but this app has ${JSON.stringify(c[k])}. Build the app with the recording's config (replayApp() does).`,
        )
      }
    }
    this.checks = new Map(rec.checks.map((c) => [c.frame, c.hash]))
    for (const ev of rec.channels) {
      let list = this.channels.get(ev.frame)
      if (!list) this.channels.set(ev.frame, (list = []))
      list.push(ev)
    }
    this.exact = new Set(rec.exact ?? [])
    this.result = {
      frames: 0,
      total: rec.frames,
      checked: 0,
      divergedAt: null,
      notes: [...(rec.notes ?? [])],
      ...(rec.error ? { recordedError: rec.error } : {}),
    }
    app.ext.replay = this
    const starts = startStates(app)
    for (const [kind, data] of Object.entries(rec.start ?? {})) {
      if (starts[kind]) starts[kind].restore(structuredClone(data))
      else this.warnOnce(`the recording starts with '${kind}' state but no plugin in this app restores it (is its plugin missing?).`)
    }
    app.hooks.frameEnd.push(() => {
      if (app.ext.replay !== this) return
      const frame = app.time.frame
      const want = this.checks.get(frame)
      if (want === undefined) return
      this.result.checked++
      if (this.result.divergedAt === null && stateHash(app, rec.checkPrecision) !== want) this.result.divergedAt = frame
    })
    app.boot()
    if (rec.input.length) {
      if (!app.ext.input) this.warnOnce('The recording has input but this app has no input plugin; it was not replayed.')
      else app.input.script(rec.input)
    }
    app.bus.startRecording()
  }

  /** Frames played so far. */
  get frame(): number {
    return this.next - 1
  }

  /** True once every recorded frame has played. */
  get done(): boolean {
    return this.next > this.recording.frames
  }

  get status(): ReplayResult {
    return { ...this.result, notes: [...this.result.notes] }
  }

  /** Adds a note to the result, once per distinct text. Plugins call it when a replay can't apply something. */
  warnOnce(text: string): void {
    if (this.warned.has(text)) return
    this.warned.add(text)
    this.result.notes.push(`replay: ${text}`)
  }

  /** Plays to frame `until` (default: the end). Events emitted during the replay stay readable with app.events(E). */
  async play(until = this.recording.frames): Promise<ReplayResult> {
    const rec = this.recording
    const end = Math.min(until, rec.frames)
    const handlers = (this.app.ext.replayChannels ?? {}) as Record<string, ChannelApply>
    while (this.next <= end) {
      const f = this.next
      for (const ev of this.channels.get(f) ?? []) {
        const apply = handlers[ev.kind]
        if (!apply) {
          this.warnOnce(`the recording has '${ev.kind}' events but no plugin in this app replays them (is its plugin missing?).`)
          continue
        }
        await apply(ev.data)
      }
      this.next++
      this.result.frames = f
      this.app.tick(rec.dt[f - 1]!, this.exact.has(f))
    }
    return this.status
  }
}
