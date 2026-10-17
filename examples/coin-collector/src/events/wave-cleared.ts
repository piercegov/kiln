import { event } from 'kiln'

/** Every coin in the wave was collected. `wave` is the wave just cleared. */
export const WaveCleared = event<{ wave: number }>()
