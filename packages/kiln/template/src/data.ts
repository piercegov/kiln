import { trait } from 'kiln-ecs'

// Traits

/** Tag: the entity the input controls. */
export const IsPlayer = trait()

/** Linear velocity in world units per second. */
export const Velocity = trait({ x: 0, y: 0, z: 0 })
