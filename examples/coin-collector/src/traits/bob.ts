import { trait } from 'kiln'

/** Bobs the entity up and down around `baseY` with `amplitude` and `phase` (radians). */
export const Bob = trait({ baseY: 0.6, amplitude: 0.15, phase: 0 })
