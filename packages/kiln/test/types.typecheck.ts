// Compile-time checks, run by `tsc --noEmit`. Not executed.
import { Mut, Not, resource, system, trait, Transform, type Entity } from '../src/index.ts'
import type * as THREE from 'three'

const Velocity = trait({ x: 0, y: 0, z: 0 })
const IsPlayer = trait()
const MeshRef = trait(() => null as THREE.Object3D | null)
const Score = resource({ value: 0 })

system([Mut(Transform), Velocity, IsPlayer, Not(MeshRef)], ([t, v], { time, entity }) => {
  t.x += v.x * time.step
  const e: Entity = entity
  // @ts-expect-error Velocity is read-only without Mut()
  v.x = 1
  void e
})

system([MeshRef], ([mesh]) => {
  mesh?.position.set(0, 0, 0) // Three.js escape hatch: object internals stay writable
})

system({ players: [Transform, IsPlayer], movers: [Mut(Transform)] }, ({ players, movers }, { res }) => {
  const p: Entity | undefined = players.first()
  void p
  movers.each(([t]) => {
    t.x = 1
  })
  players.each(([t]) => {
    // @ts-expect-error read-only in this query
    t.x = 1
  })
  res.mut(Score).value += 1
  // @ts-expect-error res.get is read-only
  res.get(Score).value = 2
})
