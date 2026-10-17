import * as THREE from 'three'
import { Input, MeshRef, Mut, origin, system, Transform } from 'kiln'
import { IsPlayer, Velocity } from './data.ts'
import { Player } from './prefabs.ts'

// Startup

/** Startup: a floor and the player. */
export const SpawnLevel = system(({ commands }) => {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }))
  commands.spawn(MeshRef(floor))
  commands.spawn(Player, { at: origin })
})

// Fixed

/** Turns the input axis into player velocity on the ground plane (up = -z). */
export const PlayerMove = system([Mut(Velocity), IsPlayer], ([v], { res }) => {
  const { axis } = res.get(Input)
  v.x = axis.x * 5
  v.z = -axis.y * 5
})

/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.y += v.y * time.step
  t.z += v.z * time.step
})
