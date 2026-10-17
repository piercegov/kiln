import * as THREE from 'three'
import { createApp, CorePlugins, defineInstanced, Instanced, InstanceColor, MeshRef, Rng, Startup, system, Transform } from 'kiln'
import { Collider, PhysicsPlugin, RigidBody } from 'kiln/physics'

defineInstanced('crate', { geometry: new THREE.BoxGeometry(0.5, 0.5, 0.5), material: new THREE.MeshStandardMaterial() })

export const SpawnPile = system(({ commands, res }) => {
  const rng = res.mut(Rng)
  const ground = new THREE.Mesh(new THREE.BoxGeometry(16, 1, 16), new THREE.MeshStandardMaterial({ color: 0x3a4150 }))
  commands.spawn(Transform({ y: -0.5 }), RigidBody({ type: 'fixed' }), Collider({ hx: 8, hy: 0.5, hz: 8 }), MeshRef(ground))
  for (let i = 0; i < 300; i++) {
    commands.spawn(
      Transform({ x: rng.float(-2, 2), y: 2 + i * 0.12, z: rng.float(-2, 2) }),
      RigidBody,
      Collider({ hx: 0.25, hy: 0.25, hz: 0.25 }),
      Instanced('crate'),
      InstanceColor({ r: rng.float(0.3, 1), g: rng.float(0.3, 1), b: rng.float(0.3, 1) }),
    )
  }
})

export default () => createApp({ seed: 3 }).use(CorePlugins, PhysicsPlugin).add(Startup, SpawnPile)
