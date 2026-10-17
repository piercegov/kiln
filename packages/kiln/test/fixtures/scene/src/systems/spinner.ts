import { Mut, setYaw, system, Transform } from 'kiln'
import { Spin } from '../traits.ts'

/** Spins entities about Y. */
export const Spinner = system([Mut(Transform), Mut(Spin)], ([t, s], { time }) => {
  s.angle += s.speed * time.step
  setYaw(t, s.angle)
})
