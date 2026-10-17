import * as THREE from 'three'
import { MeshRef, prefab, SharedMesh, Transform, type Vec3 } from 'kiln'
import { Bob } from '../traits/bob.ts'
import { IsCoin } from '../traits/is-coin.ts'
import { Spin } from '../traits/spin.ts'

const geometry = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 24).rotateX(Math.PI / 2)
const material = new THREE.MeshStandardMaterial({ color: 0xffd93d, metalness: 0.3, roughness: 0.35, emissive: 0x3a2a00 })

/** A spinning, bobbing coin at `at` (y is ignored). Geometry and material are shared. */
export const Coin = prefab((p: { at: Vec3; phase: number }) => [
  Transform({ x: p.at.x, y: 0.6, z: p.at.z }),
  IsCoin,
  Spin({ speed: 2.5 }),
  Bob({ baseY: 0.6, amplitude: 0.15, phase: p.phase }),
  MeshRef(new THREE.Mesh(geometry, material)),
  SharedMesh,
])
