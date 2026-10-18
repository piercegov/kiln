import { animationGraph, event, resource, spriteSheet, trait, type Entity } from 'kiln-ecs'

// Sprites

/** The hero's 4x4 sheet (drawn by tools/make-sheet.ts): idle, run, attack, rise/fall, dust. */
export const HeroSheet = spriteSheet({
  texture: 'sprites/hero.png',
  columns: 4,
  rows: 4,
  size: [2, 2],
  pivot: [0.5, 0],
  clips: {
    idle: { range: [0, 3], fps: 4 },
    run: { range: [4, 7], fps: 10 },
    attack: { range: [8, 11], fps: 14, loop: 'once' },
    rise: { frames: [12] },
    fall: { frames: [13] },
    dust: { range: [14, 15], fps: 8, loop: 'once' },
  },
})

/**
 * The hero's animation graph: run on speed, rise/fall on vertical speed, a sword swing on the
 * `attack` trigger. Footsteps and the sword's hit frame are events the game reacts to.
 */
export const HeroAnim = animationGraph({
  initial: 'idle',
  params: { speed: 0, grounded: true, vy: 0 },
  triggers: ['attack'],
  states: {
    idle: {},
    run: { events: [{ frame: 0, name: 'footstep' }, { frame: 2, name: 'footstep' }] },
    attack: { events: [{ frame: 2, name: 'hitFrame' }] },
    rise: {},
    fall: {},
  },
  transitions: [
    { from: ['idle', 'run'], to: 'attack', trigger: 'attack' },
    { from: 'attack', to: 'idle', exitTime: 1 },
    { from: ['idle', 'run', 'fall'], to: 'rise', when: { grounded: false, vy: { gt: 0 } } },
    { from: ['idle', 'run', 'rise'], to: 'fall', when: { grounded: false, vy: { lte: 0 } } },
    { from: ['rise', 'fall'], to: 'idle', when: { grounded: true } },
    { from: 'idle', to: 'run', when: { speed: { gt: 0.1 } } },
    { from: 'run', to: 'idle', when: { speed: { lte: 0.1 } } },
  ],
})

// Traits

/** Tag: the entity the input controls. */
export const IsHero = trait()

/** Tag: a training dummy the sword can hit. */
export const IsDummy = trait()

/** Velocity in world units per second. */
export const Velocity = trait({ x: 0, y: 0 })

// Resources

/** Dummy hits landed so far. */
export const Hits = resource({ value: 0 })

// Events

/** The sword's hit frame connected with a dummy. */
export const DummyHit = event<{ dummy: Entity }>()
