import { Rng, system } from 'kiln'
import { WaveCleared } from '../events/wave-cleared.ts'
import { Level } from '../resources/level.ts'
import { spawnCoins } from './spawn-coins.ts'

/** When a wave is cleared, spawns the next one with two more coins. */
export const NextWave = system(({ events, res, commands }) => {
  for (const _ of events.read(WaveCleared)) {
    const level = res.mut(Level)
    level.wave += 1
    level.coins += 2
    spawnCoins(commands, res.mut(Rng), level.halfSize, level.coins)
  }
})
