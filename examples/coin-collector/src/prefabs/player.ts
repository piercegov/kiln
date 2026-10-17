import * as THREE from 'three'
import { MeshRef, prefab, Transform, type Vec3 } from 'kiln'
import { IsPlayer } from '../traits/is-player.ts'
import { Velocity } from '../traits/velocity.ts'

const geometry = new THREE.CapsuleGeometry(0.4, 0.6, 4, 12)

/** The player: a capsule standing on the ground at `at`. */
export const Player = prefab((p: { at: Vec3 }) => [
  Transform({ x: p.at.x, y: 0.7, z: p.at.z }),
  Velocity,
  IsPlayer,
  MeshRef(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x4d96ff, roughness: 0.4 }))),
])
