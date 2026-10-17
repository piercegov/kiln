import * as THREE from 'three'
import { MeshRef, prefab, Transform, type Vec3 } from 'kiln'
import { IsPlayer } from '../traits/is-player.ts'
import { Velocity } from '../traits/velocity.ts'

/** The player: a box at `at`. */
export const Player = prefab((p: { at: Vec3 }) => [
  Transform({ x: p.at.x, y: 0.5, z: p.at.z }),
  Velocity,
  IsPlayer,
  MeshRef(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x4d96ff }))),
])
