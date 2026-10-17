import { distSq, system, Transform } from 'kiln'
import { CoinCollected } from '../events/coin-collected.ts'
import { WaveCleared } from '../events/wave-cleared.ts'
import { Level } from '../resources/level.ts'
import { Score } from '../resources/score.ts'
import { IsCoin } from '../traits/is-coin.ts'
import { IsPlayer } from '../traits/is-player.ts'

/** Pickup radius between the player's and a coin's centres. */
export const PICKUP_RADIUS = 0.8

/** Despawns coins within reach of the player, adds score, and reports a cleared wave. */
export const CollectCoins = system(
  { coins: [Transform, IsCoin], player: [Transform, IsPlayer] },
  ({ coins, player }, { res, commands, events }) => {
    const p = player.first()
    if (p === undefined || coins.length === 0) return
    const pt = p.get(Transform)!
    let collected = 0
    coins.forEach((coin) => {
      if (distSq(coin.get(Transform)!, pt) < PICKUP_RADIUS * PICKUP_RADIUS) {
        commands.despawn(coin)
        res.mut(Score).value += 1
        events.emit(CoinCollected, { coin, by: p })
        collected++
      }
    })
    if (collected > 0 && collected === coins.length) events.emit(WaveCleared, { wave: res.get(Level).wave })
  },
)
