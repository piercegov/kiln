import * as THREE from 'three'
import { MeshRef, origin, system } from 'kiln'
import { Player } from '../prefabs/player.ts'

/** Startup: a floor and the player. */
export const SpawnLevel = system(({ commands }) => {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }))
  commands.spawn(MeshRef(floor))
  commands.spawn(Player, { at: origin })
})
