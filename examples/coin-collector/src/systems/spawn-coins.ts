import type { Commands, RngState } from 'kiln'
import { Coin } from '../prefabs/coin.ts'

/**
 * Queues `count` coins on whole-unit grid points inside the arena, never on the centre tile.
 * Shared by SpawnLevel and NextWave; randomness comes from the seeded Rng.
 */
export function spawnCoins(commands: Commands, rng: RngState, halfSize: number, count: number): void {
  const taken = new Set<string>(['0,0'])
  const n = Math.floor(halfSize) - 1
  while (taken.size - 1 < count) {
    const x = rng.int(-n, n)
    const z = rng.int(-n, n)
    const key = `${x},${z}`
    if (taken.has(key)) continue
    taken.add(key)
    commands.spawn(Coin, { at: { x, y: 0, z }, phase: rng.float(0, Math.PI * 2) })
  }
}
