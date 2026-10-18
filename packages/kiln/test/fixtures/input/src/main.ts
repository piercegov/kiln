import { createApp, CorePlugins, Fixed, Input, Mut, Startup, system, trait, Transform, Update } from 'kiln-ecs'

export const IsPlayer = trait()
export const Jumps = trait({ count: 0 })
export const Look = trait({ yaw: 0, locked: false })

export const SpawnPlayer = system(({ commands }) => void commands.spawn(Transform, IsPlayer, Jumps, Look))

export const PlayerMove = system([Mut(Transform), Mut(Jumps), IsPlayer], ([t, j], { res, time }) => {
  const input = res.get(Input)
  t.x += input.axis.x * 5 * time.step
  if (input.pressed('jump')) j.count += 1
})

// Mouse look: holds pointer lock while it has the mouse, turns with raw movement.
export const MouseLook = system([Mut(Look)], ([l], { res }) => {
  const input = res.get(Input)
  l.yaw += input.pointer.dx * 0.01
  l.locked = input.pointer.locked
})

export default () => createApp({ seed: 1 }).use(CorePlugins).add(Startup, SpawnPlayer).add(Fixed, PlayerMove).add(Update, MouseLook)
