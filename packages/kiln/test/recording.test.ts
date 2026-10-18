import { afterEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  App,
  Assets,
  chain,
  createApp,
  CorePlugins,
  event,
  Fixed,
  Input,
  Mut,
  noteChannel,
  Recorder,
  Replayer,
  resource,
  Rng,
  Startup,
  stateHash,
  system,
  trait,
  Transform,
  Ui,
  memoryStorage,
  savePlugin,
  UiClick,
  Update,
  type Recording,
} from '../src/index.ts'
import type { RawInput } from '../src/plugins/input/index.ts'
import { replayApp, scenarioApp } from '../src/test/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
const root = `${import.meta.dir}/fixtures/game`

const Hero = trait({ jumps: 0, charge: 0 })
const IsWanderer = trait()
const Stats = resource({ updateTime: 0, px: 0, py: 0, ndcX: 0, wheel: 0, clicks: 0, assetFrame: -1 })
const Jumped = event<{ n: number }>()

const SpawnWorld = system(({ commands, res }) => {
  commands.spawn(Transform, Hero)
  const rng = res.mut(Rng)
  for (let i = 0; i < 3; i++) commands.spawn(Transform({ x: rng.float(-5, 5) }), IsWanderer)
})
const MoveHero = system([Mut(Transform), Mut(Hero)], ([t, h], { res, time, events }) => {
  const input = res.get(Input)
  t.x += input.axis.x * 4 * time.step
  t.z += input.axis.y * 4 * time.step
  h.charge += input.value('fire') * time.step
  if (input.pressed('jump')) {
    h.jumps++
    events.emit(Jumped, { n: h.jumps })
  }
})
const Wander = system([Mut(Transform), IsWanderer], ([t], { res }) => {
  t.z += res.mut(Rng).float(-1, 1)
})
// Update-phase work depends on the frame delta, so variable frames have to replay exactly.
const TrackFrame = system(({ res, time }) => {
  const s = res.mut(Stats)
  const p = res.get(Input).pointer
  s.updateTime += time.dt
  s.px = p.x
  s.py = p.y
  s.ndcX = p.ndcX
  s.wheel += p.wheel
})
const CountClicks = system(({ res, events }) => {
  res.mut(Stats).clicks += events.read(UiClick).length
})

function game(extra?: (app: App) => void) {
  return () => {
    const app = createApp({ seed: 7 }).use(CorePlugins).init(Stats, Jumped).add(Startup, SpawnWorld).add(Fixed, chain(MoveHero, Wander)).add(Update, TrackFrame, CountClicks)
    extra?.(app)
    apps.push(app)
    return app
  }
}

/** A "browser" session: live devices through RawInput and uneven frame times. */
async function playSession(make: () => App, frames = 240): Promise<{ app: App; rec: Recording }> {
  const app = await scenarioApp({ app: make, startup: false }, root)
  const recorder = new Recorder(app, { checkEvery: 20 })
  app.boot()
  app.res(Ui).button('go', 'Go')
  const raw = app.ext.rawInput as RawInput
  const dts = [1 / 144, 1 / 60, 1 / 30, 0.021, 1 / 90]
  for (let f = 1; f <= frames; f++) {
    if (f === 10) raw.keys.add('KeyD')
    if (f === 40) raw.keys.delete('KeyD')
    if (f === 50 || f === 120) raw.tapped.add('Space') // pressed and released inside one frame
    if (f === 60) raw.pad.set('Pad:RT', 0.4) // half-pulled trigger: fire at 0.4
    if (f === 90) raw.pad.delete('Pad:RT')
    if (f === 70) Object.assign(raw.stick, { x: 0.3, y: -0.6, active: true })
    if (f === 100) raw.stick.active = false
    if (f === 30 || f === 31) {
      raw.pointer.dx += 12
      raw.pointer.x += 12
      raw.pointer.y = 40
      raw.pointer.ndcX = 0.25
      raw.pointer.wheel += 3
    }
    if (f === 150) {
      // A DOM HUD button click lands between frames, outside the input plugin.
      app.res(Ui).clicks.push('go')
      noteChannel(app, 'ui-click', 'go')
    }
    app.tick(dts[f % dts.length]!)
  }
  return { app, rec: JSON.parse(JSON.stringify(recorder.stop())) }
}

describe('recordings', () => {
  test('a replay reproduces a live session exactly: variable frames, analog input, stick, pointer, UI clicks', async () => {
    const { app: live, rec } = await playSession(game())
    expect(rec.frames).toBe(240)
    expect(rec.checks).toHaveLength(12)
    expect(rec.channels).toEqual([{ frame: 150, kind: 'ui-click', data: 'go' }])
    expect(rec.input).toContainEqual({ frame: 60, press: 'fire', value: 0.4 })
    expect(rec.input.some((e) => 'axis' in e && e.axis !== null)).toBe(true)
    expect(live.res(Stats).clicks).toBe(1)

    const { app, result } = await replayApp(rec, { app: game() }, root)
    apps.push(app)
    expect(result.divergedAt).toBeNull()
    expect(result.checked).toBe(12)
    expect(result.frames).toBe(240)
    expect(app.time.frame).toBe(live.time.frame)
    expect(app.time.tick).toBe(live.time.tick)
    expect(stateHash(app)).toBe(stateHash(live))
    expect(app.res(Stats)).toEqual(live.res(Stats))
    expect(app.res(Stats).clicks).toBe(1)
    expect(app.res(Stats).wheel).toBe(6)
    expect(app.snapshot({ resources: [Rng] })).toEqual(live.snapshot({ resources: [Rng] }))
    // Events from the whole replay stay readable.
    expect(app.events(Jumped).map((e) => e.n)).toEqual([1, 2])
  })

  test('changed code shows where the state stopped matching', async () => {
    const { rec } = await playSession(game())
    const Faster = system([Mut(Transform), Hero], ([t], { time }) => {
      if (time.tick > 100) t.x += 0.01
    })
    const { app, result } = await replayApp(rec, { app: game((a) => a.add(Fixed, Faster.after(Wander))) }, root)
    apps.push(app)
    expect(result.divergedAt).not.toBeNull()
    // Frames of ~1/60 s or more run a fixed step each; tick 100 is reached a little after frame 80.
    expect(result.divergedAt!).toBeGreaterThan(60)
    expect(result.divergedAt!).toBeLessThanOrEqual(140)
    await expect(replayApp(rec, { app: game((a) => a.add(Fixed, Faster.after(Wander))), strict: true }, root)).rejects.toThrow('stopped matching the recording at frame')
  })

  test('replays can stop early and play on', async () => {
    const { rec } = await playSession(game())
    const { app, replayer } = await replayApp(rec, { app: game(), until: 45 }, root)
    apps.push(app)
    expect(app.time.frame).toBe(45)
    expect(replayer.done).toBe(false)
    const r = await replayer.play()
    expect(r.frames).toBe(240)
    expect(r.divergedAt).toBeNull()
  })

  test('a session that crashed throws the same error at the same frame', async () => {
    const Boom = system([Hero], ([h]) => {
      if (h.jumps >= 2) throw new Error('second jump breaks the world')
    })
    const make = game((a) => a.add(Update, Boom))
    const app = await scenarioApp({ app: make, startup: false }, root)
    const recorder = new Recorder(app)
    app.hooks.error.push(() => {})
    app.boot()
    const raw = app.ext.rawInput as RawInput
    let threw = 0
    for (let f = 1; f <= 60 && !threw; f++) {
      if (f === 5 || f === 20) raw.tapped.add('Space')
      try {
        app.tick(1 / 60)
      } catch (err) {
        threw = f
        for (const h of app.hooks.error) void h(err)
      }
    }
    expect(threw).toBe(20)
    const rec = recorder.stop()
    expect(rec.error).toMatchObject({ frame: 20, code: 'system-threw' })
    expect(rec.error!.message).toContain('second jump breaks the world')
    const replayed = await scenarioApp({ app: make, startup: false }, root)
    apps.push(replayed)
    const replayer = new Replayer(replayed, rec)
    await expect(replayer.play()).rejects.toThrow('second jump breaks the world')
    expect(replayer.frame).toBe(20)
  })

  test('asset loads finish on the frame they finished on in the session', async () => {
    const WatchAsset = system(({ res, time }) => {
      const h = res.get(Assets).json('level.json')
      const s = res.mut(Stats)
      if (h.ready && s.assetFrame < 0) s.assetFrame = time.frame
    })
    const make = game((a) => a.add(Update, WatchAsset))
    ;(globalThis as any).__KILN_ROOT__ = root
    const live = await scenarioApp({ app: make, startup: false }, root)
    apps.push(live)
    const recorder = new Recorder(live)
    live.boot()
    live.step(12)
    await live.idle() // the load lands while the browser is between frames 12 and 13
    live.step(8)
    expect(live.res(Stats).assetFrame).toBe(13)
    const rec = recorder.stop()
    expect(rec.channels).toEqual([{ frame: 13, kind: 'asset', data: 'level.json' }])

    // Headless loads finish almost at once; the replay holds this one back to frame 13.
    const { app, result } = await replayApp(rec, { app: make }, root)
    apps.push(app)
    expect(app.res(Stats).assetFrame).toBe(13)
    expect(result.notes).toEqual([])
  })

  test('stored saves the session started with are restored before the replay boots', async () => {
    const Best = resource({ value: 0 })
    const UseBest = system([Mut(Hero)], ([h], { res }) => {
      h.charge = res.get(Best).value
    })
    const make = (storage = memoryStorage()) =>
      game((a) => a.use(savePlugin({ key: 't', persist: [Best], storage })).add(Update, UseBest))
    const player = memoryStorage()
    player.set('t:persist:Best', JSON.stringify({ value: 42 }))
    player.set('t:slot:one', '{"v":1}')
    const live = await scenarioApp({ app: make(player), startup: false }, root)
    apps.push(live)
    const recorder = new Recorder(live)
    live.step(5)
    const rec = recorder.stop()
    expect(rec.start).toEqual({ save: { 't:persist:Best': '{"value":42}', 't:slot:one': '{"v":1}' } })
    const fresh = memoryStorage()
    const { app, result } = await replayApp(rec, { app: make(fresh) }, root)
    apps.push(app)
    expect(result.divergedAt).toBeNull()
    expect(app.res(Best).value).toBe(42)
    expect(fresh.get('t:slot:one')).toBe('{"v":1}')
  })

  test('replay() reads recordings from files; mistakes explain the fix', async () => {
    const { rec } = await playSession(game(), 30)
    const dir = mkdtempSync(join(tmpdir(), 'kiln-rec-'))
    writeFileSync(join(dir, 'session.json'), JSON.stringify(rec))
    const { app } = await replayApp(join(dir, 'session.json'), { app: game() }, root)
    apps.push(app)
    expect(app.time.frame).toBe(30)

    writeFileSync(join(dir, 'bad.json'), '{"hello":1}')
    await expect(replayApp(join(dir, 'bad.json'), { app: game() }, root)).rejects.toThrow('is not a Kiln recording')
    await expect(replayApp('recordings/missing.json', { app: game() }, root)).rejects.toThrow('Recordings save to recordings/')

    const booted = await scenarioApp({ app: game() }, root)
    apps.push(booted)
    expect(() => new Recorder(booted)).toThrow('before Startup')
    expect(() => new Replayer(booted, rec)).toThrow('must not have run Startup')
    const other = await scenarioApp({ app: game(), startup: false, seed: 99 }, root)
    apps.push(other)
    expect(() => new Replayer(other, rec)).toThrow('The recording ran with seed 7 but this app has 99')
  })

  test('pointer lock: raw movement and lock changes replay exactly', async () => {
    const Aim = resource({ yaw: 0, pitch: 0, lockedFrames: 0, lost: 0, wasLocked: false })
    const MouseLook = system(({ res }) => {
      const p = res.get(Input).pointer
      const a = res.mut(Aim)
      a.yaw += p.dx * 0.0037
      a.pitch += p.dy * 0.0021
      if (p.locked) a.lockedFrames++
      if (a.wasLocked && !p.locked) a.lost++
      a.wasLocked = p.locked
    })
    const make = game((a) => a.init(Aim).add(Update, MouseLook))
    const live = await scenarioApp({ app: make, startup: false }, root)
    const recorder = new Recorder(live, { checkEvery: 10 })
    live.boot()
    const raw = live.ext.rawInput as RawInput
    raw.pointer.x = 200
    raw.pointer.y = 150
    for (let f = 1; f <= 90; f++) {
      if (f === 5) raw.pointer.locked = true
      // Under lock the cursor freezes and only movement arrives, in uneven steps.
      if (raw.pointer.locked && f % 2 === 0) {
        raw.pointer.dx += 1.3 + (f % 7) * 0.1
        raw.pointer.dy -= 0.7
      }
      if (f === 60) raw.pointer.locked = false // Escape
      if (f === 70) {
        raw.pointer.dx += 33 // unlocked: movement is the position change
        raw.pointer.x += 33
      }
      live.tick(f % 3 ? 1 / 60 : 1 / 45)
    }
    const rec: Recording = JSON.parse(JSON.stringify(recorder.stop()))
    expect(live.res(Aim).lost).toBe(1)
    expect(rec.input).toContainEqual(expect.objectContaining({ pointer: expect.objectContaining({ locked: true }) }))
    expect(rec.input.some((e) => 'pointer' in e && e.pointer.dx !== undefined)).toBe(true)
    const { app, result } = await replayApp(rec, { app: make }, root)
    apps.push(app)
    expect(result.divergedAt).toBeNull()
    expect(app.res(Aim)).toEqual(live.res(Aim))
  })

  test('scripted pointer movement and lock without a position', () => {
    const app = game()()
    app.boot()
    app.input.script([
      { frame: 1, pointer: { dx: 5, dy: -2, locked: true } },
      { frame: 3, pointer: { locked: false } },
    ])
    app.step(1)
    expect(app.res(Input).pointer).toMatchObject({ x: 0, y: 0, dx: 5, dy: -2, locked: true })
    app.step(1)
    expect(app.res(Input).pointer).toMatchObject({ dx: 0, dy: 0, locked: true })
    app.step(1)
    expect(app.res(Input).pointer.locked).toBe(false)
  })

  test('input record() still emits plain press/release for keys', async () => {
    const app = game()()
    app.boot()
    const r = app.input.record()
    app.input.script([{ frame: 2, press: 'jump' }, { frame: 5, release: 'jump' }])
    app.step(6)
    expect(r.stop()).toEqual([
      { frame: 2, press: 'jump' },
      { frame: 5, release: 'jump' },
    ])
  })

  test('kiln replay prints where the replay stopped matching and the end state', async () => {
    const live = await scenarioApp({ startup: false }, root)
    apps.push(live)
    const recorder = new Recorder(live, { checkEvery: 30 })
    live.boot()
    for (let f = 0; f < 150; f++) live.tick(f % 3 === 0 ? 1 / 30 : 1 / 120)
    const rec = recorder.stop()
    const dir = mkdtempSync(join(tmpdir(), 'kiln-rec-'))
    const file = join(dir, 'coins.json')
    writeFileSync(file, JSON.stringify(rec))
    const pkg = `${import.meta.dir}/..`
    const out = JSON.parse(await $`bun src/cli/kiln.ts replay ${file} --snapshot IsPlayer,Transform --resources Score --cwd test/fixtures/game`.cwd(pkg).text())
    expect(out.replay).toMatchObject({ frames: 150, of: 150, checked: 5, divergedAt: null, endMatches: true })
    expect(out.snapshot.resources.Score).toEqual(live.res(objectScore(live)))
    const part = JSON.parse(await $`bun src/cli/kiln.ts replay ${file} --until 40 --cwd test/fixtures/game`.cwd(pkg).text())
    expect(part.replay).toMatchObject({ frames: 40, of: 150, checked: 1 })
    const bad = await $`bun src/cli/kiln.ts replay nope.json --cwd test/fixtures/game`.cwd(pkg).nothrow().quiet()
    expect(bad.exitCode).toBe(1)
    expect(bad.stderr.toString()).toContain('Recordings save to recordings/')
  })
})

function objectScore(app: App) {
  return app.resourceList().find((r) => r.name === 'Score')!
}
