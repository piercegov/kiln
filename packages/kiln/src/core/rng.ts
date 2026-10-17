import { resource } from './resource.ts'

/**
 * Seeded, serializable PRNG (sfc32 seeded by splitmix32). The only randomness systems may use:
 * `res.mut(Rng).float()`. Math.random breaks deterministic runs.
 */
export class RngState {
  a = 0
  b = 0
  c = 0
  d = 0
  constructor(seed = 0) {
    this.reseed(seed)
  }

  reseed(seed: number): void {
    let s = seed >>> 0
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
    for (let i = 0; i < 12; i++) this.u32()
  }

  /** Uniform 32-bit unsigned integer. */
  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0
    this.d = (this.d + 1) >>> 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) >>> 0
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0
    this.c = (this.c + t) >>> 0
    return t
  }

  /** Float in [min, max). Defaults to [0, 1). */
  float(min = 0, max = 1): number {
    return min + (this.u32() / 4294967296) * (max - min)
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor((this.u32() / 4294967296) * (max - min + 1))
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p
  }

  /** A random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!
  }

  /** Shuffles in place and returns the array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      const t = items[i]!
      items[i] = items[j]!
      items[j] = t
    }
    return items
  }

  toJSON() {
    return { a: this.a, b: this.b, c: this.c, d: this.d }
  }

  /** Restores state saved by toJSON (snapshots). */
  restore(s: { a: number; b: number; c: number; d: number }): void {
    this.a = s.a >>> 0
    this.b = s.b >>> 0
    this.c = s.c >>> 0
    this.d = s.d >>> 0
  }
}

/** The app's seeded random number generator. Seeded from `config.seed`. */
export const Rng = resource((app) => new RngState(app.config.seed)).named('Rng')
