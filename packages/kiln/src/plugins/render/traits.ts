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

/**
 * Renders this entity as one instance of a shared InstancedMesh: `Instanced('bullet')`, after
 * `defineInstanced('bullet', { geometry, material })`. The default path for crowds, bullets, foliage.
 */
export const Instanced = trait(() => '' as string)

/** Per-instance colour for Instanced entities (multiplies the material colour). */
export const InstanceColor = trait({ r: 1, g: 1, b: 1 })
