import { clamp, Mut, system, Transform } from 'kiln'
import { Level } from '../resources/level.ts'
import { IsPlayer } from '../traits/is-player.ts'

/** Keeps the player inside the arena walls. */
export const ClampToArena = system([Mut(Transform), IsPlayer], ([t], { res }) => {
  const h = res.get(Level).halfSize + 0.5
  t.x = clamp(t.x, -h, h)
  t.z = clamp(t.z, -h, h)
})
