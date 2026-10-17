import { chain, createApp, CorePlugins, Fixed, Mut, resource, Startup, system, trait, Transform, Rng, prefab, distSq } from '../../../../src/index.ts'
import config from '../kiln.config.ts'

/** Linear velocity in world units per second. */
export const Velocity = trait({ x: 0, y: 0, z: 0 })
export const IsCoin = trait()
export const IsPlayer = trait()
export const Score = resource({ value: 0 })

export const Coin = prefab((p: { x: number; z: number }) => [Transform({ x: p.x, z: p.z }), IsCoin])
export const Player = prefab(() => [Transform, Velocity({ x: 1 }), IsPlayer])

export const SpawnLevel = system(({ commands, res }) => {
  commands.spawn(Player)
  for (let i = 0; i < 5; i++) commands.spawn(Coin, { x: i + 1, z: res.mut(Rng).float(-0.1, 0.1) })
})

/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.z += v.z * time.step
})

export const CollectCoins = system(
  { coins: [Transform, IsCoin], player: [Transform, IsPlayer] },
  ({ coins, player }, { res, commands }) => {
    const p = player.first()?.get(Transform)
    if (!p) return
    coins.forEach((c) => {
      if (distSq(c.get(Transform)!, p) < 0.25) {
        commands.despawn(c)
        res.mut(Score).value += 1
      }
    })
  },
)

export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(Movement, CollectCoins))
