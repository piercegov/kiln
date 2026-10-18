import * as THREE from 'three'
import { Lifetime, MeshRef, prefab, spriteAnimator, Transform } from 'kiln'
import { HeroAnim, HeroSheet, IsDummy, IsHero, Velocity } from './data.ts'

/** The hero standing at `x` on the ground, in front of the dummies (z is draw order). */
export const Hero = prefab((p: { x: number }) => [Transform({ x: p.x, z: 1 }), Velocity, IsHero, spriteAnimator(HeroSheet, { graph: HeroAnim })])

/** A puff of dust at the hero's feet; plays its clip once and despawns. */
export const Dust = prefab((p: { x: number; flipX: boolean }) => [
  Transform({ x: p.x, z: 2, sx: 0.6, sy: 0.6 }),
  spriteAnimator(HeroSheet, { play: 'dust', flipX: p.flipX }),
  Lifetime({ seconds: 0.25 }),
])

const dummyGeometry = new THREE.PlaneGeometry(0.8, 1.6).translate(0, 0.8, 0)

/** A training dummy: a red post at `x`, behind the hero. */
export const Dummy = prefab((p: { x: number }) => [
  Transform({ x: p.x }),
  IsDummy,
  MeshRef(new THREE.Mesh(dummyGeometry, new THREE.MeshBasicMaterial({ color: 0xc8553d }))),
])

/** The ground strip the hero runs on. */
export const Ground = prefab((p: { width: number }) => [
  Transform({ y: -0.5, z: -1 }),
  MeshRef(new THREE.Mesh(new THREE.PlaneGeometry(p.width, 1), new THREE.MeshBasicMaterial({ color: 0x3a4150 }))),
])
