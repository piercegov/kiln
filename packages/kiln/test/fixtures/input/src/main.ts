import { createApp, CorePlugins, Fixed, Input, Mut, Startup, system, trait, Transform } from 'kiln'

export const IsPlayer = trait()
export const Jumps = trait({ count: 0 })

export const SpawnPlayer = system(({ commands }) => void commands.spawn(Transform, IsPlayer, Jumps))

export const PlayerMove = system([Mut(Transform), Mut(Jumps), IsPlayer], ([t, j], { res, time }) => {
  const input = res.get(Input)
  t.x += input.axis.x * 5 * time.step
  if (input.pressed('jump')) j.count += 1
})

export default () => createApp({ seed: 1 }).use(CorePlugins).add(Startup, SpawnPlayer).add(Fixed, PlayerMove)
