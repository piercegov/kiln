import { Mut, setYaw, system, Transform } from 'kiln'
import { Spin } from '../traits/spin.ts'

/** Advances Spin and writes it as yaw. */
export const Spinner = system([Mut(Transform), Mut(Spin)], ([t, s], { time }) => {
  s.angle += s.speed * time.step
  setYaw(t, s.angle)
})
