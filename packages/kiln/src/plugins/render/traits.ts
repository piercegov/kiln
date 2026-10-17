import type { Object3D } from 'three'
import { trait } from '../../core/koota.ts'

/**
 * The Three.js object this entity renders as. Adding it puts the object in the scene; despawning
 * removes it and disposes its geometry and materials unless the entity has SharedMesh (or the
 * object has `userData.kilnShared`). Systems may read MeshRef to touch materials and uniforms,
 * but positions come from Transform.
 */
export const MeshRef = trait(() => null as Object3D | null)

/** Keep MeshRef's geometry and materials alive on despawn (they are shared or cached). */
export const SharedMesh = trait()

/** Snap to the current Transform on the next frame instead of interpolating (teleports). */
export const Teleported = trait()
