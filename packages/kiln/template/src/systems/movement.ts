import { Mut, system, Transform } from 'kiln'
import { Velocity } from '../traits/velocity.ts'

/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.y += v.y * time.step
  t.z += v.z * time.step
})
