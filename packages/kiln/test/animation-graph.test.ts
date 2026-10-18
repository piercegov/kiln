import { describe, expect, test } from 'bun:test'
import { AnimationController, animationGraph, KilnError } from '../src/index.ts'
import { frameIndex, type AnimationSink, type ClipInfo } from '../src/plugins/animation/index.ts'

const STEP = 1 / 60

/** Records what controller.step() reports. */
function recorder() {
  const log: string[] = []
  const sink: AnimationSink = {
    event: (n, s) => log.push(`event:${n}@${s}`),
    changed: (a, b) => log.push(`changed:${a}->${b}`),
    finished: (s) => log.push(`finished:${s}`),
  }
  return { log, sink }
}

const spriteClips = (entries: Record<string, ClipInfo>) => new Map(Object.entries(entries))
const clip = (frames: number, fps: number, loop?: ClipInfo['loop']): ClipInfo => ({ duration: frames / fps, frames, fps, loop })

describe('animation graph', () => {
  const Hero = animationGraph({
    initial: 'idle',
    params: { speed: 0, grounded: true },
    triggers: ['attack', 'jump'],
    states: {
      idle: {},
      run: { events: [{ frame: 1, name: 'footstep' }, { frame: 3, name: 'footstep' }] },
      attack: { loop: 'once', events: [{ frame: 2, name: 'hit' }] },
      air: {},
    },
    transitions: [
      { from: '*', to: 'attack', trigger: 'attack' },
      { from: ['idle', 'run'], to: 'air', when: { grounded: false } },
      { from: 'idle', to: 'run', when: { speed: { gt: 0.1 } } },
      { from: 'run', to: 'idle', when: { speed: { lte: 0.1 } } },
      { from: 'attack', to: 'idle', exitTime: 1 },
      { from: 'air', to: 'idle', when: { grounded: true } },
    ],
  })
  const clips = spriteClips({ idle: clip(4, 10), run: clip(4, 10), attack: clip(4, 20), air: clip(1, 10) })

  function make() {
    const c = new AnimationController(Hero)
    c.bind(clips, 'the test sheet')
    return c
  }

  test('loop clips: frames change at the clip fps, normalized time counts plays', () => {
    const c = make()
    const { sink } = recorder()
    const info = clips.get('idle')!
    const frames: number[] = []
    for (let i = 0; i < 30; i++) {
      c.step(STEP, sink)
      frames.push(frameIndex(info, c.loop, c.time))
    }
    // 10 fps at 60 Hz: a new frame every 6 steps, wrapping after 4 frames.
    expect(frames.join('')).toBe('000001111112222223333330000001')
    expect(c.normalizedTime).toBeCloseTo(30 / 60 / 0.4, 9)
  })

  test('params drive transitions; one transition per step, in order', () => {
    const c = make()
    const { log, sink } = recorder()
    c.step(STEP, sink)
    c.set('speed', 3)
    c.step(STEP, sink)
    expect(c.state).toBe('run')
    c.set('grounded', false)
    c.step(STEP, sink)
    expect(c.state).toBe('air')
    c.set('grounded', true).set('speed', 0)
    c.step(STEP, sink)
    expect(c.state).toBe('idle')
    expect(log.filter((l) => l.startsWith('changed'))).toEqual(['changed:idle->run', 'changed:run->air', 'changed:air->idle'])
  })

  test('triggers fire once and expire after a step; exitTime 1 returns at the end of a once clip', () => {
    const c = make()
    const { log, sink } = recorder()
    c.trigger('attack')
    c.step(STEP, sink)
    expect(c.state).toBe('attack')
    expect(c.triggers.size).toBe(0)
    // An unused trigger is dropped after one step.
    c.trigger('jump')
    c.step(STEP, sink)
    expect(c.triggers.size).toBe(0)
    // attack: 4 frames at 20 fps = 0.2 s = 12 steps; it was entered and advanced on step 1.
    for (let i = 0; i < 10; i++) c.step(STEP, sink)
    expect(c.finished).toBe(true)
    expect(c.state).toBe('attack')
    c.step(STEP, sink)
    expect(c.state).toBe('idle')
    expect(log.filter((l) => l.startsWith('finished'))).toEqual(['finished:attack'])
    expect(log.filter((l) => l.startsWith('event:hit'))).toHaveLength(1)
  })

  test("'*' transitions don't re-enter the current state", () => {
    const c = make()
    const { log, sink } = recorder()
    c.trigger('attack')
    c.step(STEP, sink)
    c.trigger('attack')
    c.step(STEP, sink)
    expect(log.filter((l) => l.startsWith('changed'))).toEqual(['changed:idle->attack'])
  })

  test('frame events fire exactly once per pass, on the step their frame first shows', () => {
    const c = make()
    const { log, sink } = recorder()
    c.set('speed', 1)
    const info = clips.get('run')!
    const firstShown: number[] = []
    let last = -1
    for (let i = 0; i < 48; i++) {
      const before = log.length
      c.step(STEP, sink)
      const f = frameIndex(info, c.loop, c.time)
      if (f !== last && (f === 1 || f === 3)) firstShown.push(i)
      if (log.length > before && log[log.length - 1]!.startsWith('event')) expect(firstShown.at(-1)).toBe(i)
      last = f
    }
    // 48 steps = 0.8 s = two full loops of run; two footsteps per loop.
    expect(log.filter((l) => l === 'event:footstep@run')).toHaveLength(4)
  })

  test('events at frame 0 fire on entry and on every loop', () => {
    const g = animationGraph({ initial: 'spin', states: { spin: { events: [{ frame: 0, name: 'tick' }] } } })
    const c = new AnimationController(g)
    c.bind(spriteClips({ spin: clip(2, 30) }), 'test') // 2 frames at 30 fps: a loop every 4 steps
    const { log, sink } = recorder()
    for (let i = 0; i < 12; i++) c.step(STEP, sink)
    // Steps 1, 4, 8 and 12: frame 0 shows again at 0.2 s.
    expect(log).toEqual(['event:tick@spin', 'event:tick@spin', 'event:tick@spin', 'event:tick@spin'])
  })

  test('pingpong plays forward then back without doubling the end frames', () => {
    const info = clip(4, 60, 'pingpong')
    const frames: number[] = []
    for (let i = 0; i < 9; i++) frames.push(frameIndex(info, 'pingpong', i * STEP))
    expect(frames).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2])
    const g = animationGraph({ initial: 'p', states: { p: { loop: 'pingpong', events: [{ frame: 2, name: 'mid' }, { frame: 3, name: 'top' }] } } })
    const c = new AnimationController(g)
    c.bind(spriteClips({ p: info }), 'test')
    const { log, sink } = recorder()
    for (let i = 0; i < 6; i++) c.step(STEP, sink) // frames 1 2 3 2 1 0
    expect(log).toEqual(['event:mid@p', 'event:top@p', 'event:mid@p'])
  })

  test('crossfades report the new state weight from 0 to 1', () => {
    const g = animationGraph({ initial: 'a', fade: 0.1, params: { go: false }, states: { a: {}, b: {} }, transitions: [{ from: 'a', to: 'b', when: { go: true } }] })
    const c = new AnimationController(g)
    c.bind(new Map([['a', { duration: 1 }], ['b', { duration: 1 }]]), 'test')
    const { sink } = recorder()
    c.set('go', true)
    c.step(STEP, sink)
    expect(c.state).toBe('b')
    expect(c.fade?.from).toBe('a')
    expect(c.weight).toBeCloseTo(STEP / 0.1, 9)
    for (let i = 0; i < 5; i++) c.step(STEP, sink)
    expect(c.fade).toBeNull()
    expect(c.weight).toBe(1)
  })

  test('play() enters a state at the next step, skipping transitions; restart replays', () => {
    const c = make()
    const { log, sink } = recorder()
    c.play('air')
    c.step(STEP, sink)
    expect(c.state).toBe('air')
    c.play('air')
    c.step(STEP, sink)
    c.play('air', { restart: true })
    c.step(STEP, sink)
    expect(log.filter((l) => l.startsWith('changed'))).toEqual(['changed:idle->air', 'changed:air->air'])
    expect(c.time).toBeCloseTo(STEP, 9)
  })

  test('mistakes name the fix', () => {
    expect(() => animationGraph({ initial: 'idle', states: { idle: {} }, transitions: [{ from: 'idle', to: 'rnu' as 'idle' }] })).toThrow("isn't one of: 'idle'")
    expect(() => animationGraph({ initial: 'idle', states: { idle: {} }, transitions: [{ from: 'idle', to: 'idle', when: { speed: 1 } as {} }] })).toThrow('Declare it in params')
    expect(() => animationGraph({ initial: 'idle', states: { idle: {} }, transitions: [{ from: 'idle', to: 'idle', trigger: 'x' as never }] })).toThrow("triggers: ['x']")
    const c = make()
    expect(() => c.set('sped', 1)).toThrow("No animation param 'sped'")
    expect(() => c.trigger('atack')).toThrow(KilnError)
    expect(() => c.play('nope')).toThrow("States: 'idle', 'run', 'attack', 'air'")
    const missing = new AnimationController(Hero)
    expect(() => missing.bind(spriteClips({ idle: clip(1, 1) }), 'the sprite sheet')).toThrow("plays clip 'run', which the sprite sheet doesn't have")
  })
})
