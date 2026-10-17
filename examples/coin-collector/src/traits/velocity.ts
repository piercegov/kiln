import { trait } from 'kiln'

/** Linear velocity in world units per second. Movement integrates it into Transform. */
export const Velocity = trait({ x: 0, y: 0, z: 0 })
