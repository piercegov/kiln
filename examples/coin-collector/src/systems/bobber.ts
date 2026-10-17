import { Mut, system, Transform } from 'kiln'
import { Bob } from '../traits/bob.ts'

/** Moves Bob entities up and down on a sine of simulated time. */
export const Bobber = system([Mut(Transform), Bob], ([t, b], { time }) => {
  t.y = b.baseY + Math.sin(time.elapsed * 3 + b.phase) * b.amplitude
})
