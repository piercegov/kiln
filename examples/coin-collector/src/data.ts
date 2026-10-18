import { event, resource, state, trait, type Entity } from 'kiln-ecs'

// Traits

/** Tag: the entity the input controls. */
export const IsPlayer = trait()

/** Tag: a collectable coin. */
export const IsCoin = trait()

/** Linear velocity in world units per second. Movement integrates it into Transform. */
export const Velocity = trait({ x: 0, y: 0, z: 0 })

/** Spins the entity about Y: `speed` in radians per second, `angle` is the current yaw. */
export const Spin = trait({ speed: 2, angle: 0 })

/** Bobs the entity up and down around `baseY` with `amplitude` and `phase` (radians). */
export const Bob = trait({ baseY: 0.6, amplitude: 0.15, phase: 0 })

// Resources

/** Coins collected so far. */
export const Score = resource({ value: 0 })

/** Level layout: arena half-size, coin count per wave, and the current wave number. */
export const Level = resource({ halfSize: 9, coins: 20, wave: 1 })

/** The best score ever reached. Persisted across sessions by savePlugin in main.ts. */
export const Best = resource({ score: 0 })

// States

/** Whether gameplay runs. The `pause` action (Escape, Start) toggles it. */
export const Screen = state(['playing', 'paused'], 'playing')

// Events

/** A coin was picked up by `by`. Emitted in Fixed by CollectCoins. */
export const CoinCollected = event<{ coin: Entity; by: Entity }>()

/** Every coin in the wave was collected. `wave` is the wave just cleared. */
export const WaveCleared = event<{ wave: number }>()
