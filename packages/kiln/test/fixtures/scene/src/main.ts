import * as THREE from 'three'
import { createApp, CorePlugins, Fixed, MeshRef, prefab, Startup, system, Transform } from 'kiln'
import { Spinner } from './systems/spinner.ts'
import { Spin } from './traits.ts'
import config from '../kiln.config.ts'


const geo = new THREE.BoxGeometry(1, 1, 1)
export const Cube = prefab((p: { x: number; color: number }) => [
  Transform({ x: p.x, y: 0.5 }),
  Spin({ speed: 1 + Math.abs(p.x) * 0.3 }),
  MeshRef(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color }))),
])

export const SpawnCubes = system(({ commands }) => {
  const colors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xc77dff]
  colors.forEach((color, i) => commands.spawn(Cube, { x: (i - 2) * 2, color }))
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }))
  ground.rotation.x = -Math.PI / 2
  commands.spawn(MeshRef(ground))
})

export default () => createApp(config).use(CorePlugins).add(Startup, SpawnCubes).add(Fixed, Spinner)
