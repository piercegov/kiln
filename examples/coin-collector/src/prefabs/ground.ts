import * as THREE from 'three'
import { MeshRef, prefab, Transform } from 'kiln'

/** The arena floor, `size` units across, with a grid on top. */
export const Ground = prefab((p: { size: number }) => {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }))
  const grid = new THREE.GridHelper(p.size, p.size, 0x3d4350, 0x343944)
  grid.position.y = 0.01
  floor.add(grid)
  return [Transform, MeshRef(floor)]
})
