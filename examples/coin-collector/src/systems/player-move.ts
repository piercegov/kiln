import { Input, Mut, system } from 'kiln'
import { IsPlayer } from '../traits/is-player.ts'
import { Velocity } from '../traits/velocity.ts'

/** Player speed in units per second. */
export const PLAYER_SPEED = 6

/** Turns the input axis into player velocity on the ground plane (up = -z, away from the camera). */
export const PlayerMove = system([Mut(Velocity), IsPlayer], ([v], { res }) => {
  const { axis } = res.get(Input)
  v.x = axis.x * PLAYER_SPEED
  v.z = -axis.y * PLAYER_SPEED
})
