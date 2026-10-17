import { origin, Rng, system } from 'kiln'
import { Ground } from '../prefabs/ground.ts'
import { Player } from '../prefabs/player.ts'
import { Level } from '../resources/level.ts'
import { spawnCoins } from './spawn-coins.ts'

/** Startup: the floor, the player at the origin, and the first wave of coins. */
export const SpawnLevel = system(({ commands, res }) => {
  const level = res.get(Level)
  commands.spawn(Ground, { size: level.halfSize * 2 + 2 })
  commands.spawn(Player, { at: origin })
  spawnCoins(commands, res.mut(Rng), level.halfSize, level.coins)
})
