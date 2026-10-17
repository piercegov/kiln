import { Input, Mut, system } from 'kiln'
import { IsPlayer } from '../traits/is-player.ts'
import { Velocity } from '../traits/velocity.ts'

/** Turns the input axis into player velocity on the ground plane (up = -z). */
export const PlayerMove = system([Mut(Velocity), IsPlayer], ([v], { res }) => {
  const { axis } = res.get(Input)
  v.x = axis.x * 5
  v.z = -axis.y * 5
})
