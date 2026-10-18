// Visual-only particle emitters: one InstancedMesh per emitter. Vendored by `kiln add particles`.
import * as THREE from 'three'
import { plugin, Rng, RngState, Scene, system, trait, Transform, Update, type Entity } from 'kiln-ecs'

/**
 * A particle emitter at this entity's Transform:
 * `commands.spawn(Transform({ y: 1 }), ParticleEmitter({ rate: 40, color: 0xffaa33 }))`.
 * `rate` is particles per second, `lifetime` seconds, `speed` the launch speed (units/s),
 * `spread` the cone half-angle in radians around +Y (π = every direction), `size` the start
 * diameter (particles shrink to nothing), `gravity` units/s² down, `max` the most alive at once.
 * `color` fades toward `colorEnd` over a particle's life. Set `rate: 0` to stop emitting.
 * Particles are not entities: they live in the plugin, in world space, and never touch the
 * simulation or the gameplay Rng stream after the emitter's first frame.
 */
export const ParticleEmitter = trait({
  rate: 30,
  lifetime: 1.5,
  speed: 3,
  spread: 0.4,
  size: 0.15,
  gravity: 2,
  color: 0xffb347,
  colorEnd: 0xff3b1f,
  max: 256,
})

interface EmitterState {
  mesh: THREE.InstancedMesh
  rng: RngState
  /** Per particle: x y z vx vy vz age life. */
  data: Float32Array
  alive: number
  carry: number
  max: number
  seen: number
}

const STRIDE = 8
const geometry = new THREE.IcosahedronGeometry(0.5, 0)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c0 = new THREE.Color()
const _c1 = new THREE.Color()
const _c = new THREE.Color()

/**
 * Colours go in a per-instance 'color' geometry attribute (read through vertexColors) rather than
 * InstancedMesh.instanceColor: WebGPURenderer re-uploads geometry attributes on every render call,
 * but syncs instanceColor only once per animation frame, which loses updates when a frame renders
 * several times (kiln shot steps).
 */
function makeMesh(max: number): THREE.InstancedMesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', geometry.getAttribute('position'))
  geo.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3))
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })
  const mesh = new THREE.InstancedMesh(geo, mat, max)
  mesh.name = 'particles'
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}

function disposeMesh(mesh: THREE.InstancedMesh): void {
  mesh.removeFromParent()
  mesh.geometry.dispose()
  ;(mesh.material as THREE.Material).dispose()
  mesh.dispose()
}

/**
 * Particle emitters: `app.use(ParticlesPlugin)`, then spawn `ParticleEmitter` entities with a Transform.
 * Each emitter gets its own RNG forked from the app's `Rng` when first seen, so runs replay exactly.
 */
export const ParticlesPlugin = plugin((app) => {
  const emitters = new Map<Entity, EmitterState>()
  let frame = 0

  /** Emits, moves, ages and draws every emitter's particles. */
  const UpdateParticles = system(
    { emitters: [ParticleEmitter, Transform] },
    ({ emitters: q }, { res, time }) => {
      frame++
      const dt = time.dt
      q.each(([em, t], e) => {
        let st = emitters.get(e)
        const max = Math.max(1, Math.min(100000, Math.round(em.max)))
        if (!st || st.max !== max) {
          if (st) disposeMesh(st.mesh)
          const mesh = makeMesh(max)
          res.mut(Scene).add(mesh)
          st = { mesh, rng: st?.rng ?? new RngState(res.mut(Rng).u32()), data: new Float32Array(max * STRIDE), alive: 0, carry: 0, max, seen: frame }
          emitters.set(e, st)
        }
        st.seen = frame
        const d = st.data
        // Age and move; swap-remove the dead.
        for (let i = 0; i < st.alive; ) {
          const o = i * STRIDE
          d[o + 6] += dt
          if (d[o + 6] >= d[o + 7]) {
            st.alive--
            d.copyWithin(o, st.alive * STRIDE, st.alive * STRIDE + STRIDE)
            continue
          }
          d[o + 4] -= em.gravity * dt
          d[o] += d[o + 3] * dt
          d[o + 1] += d[o + 4] * dt
          d[o + 2] += d[o + 5] * dt
          i++
        }
        // Emit.
        st.carry += Math.max(0, em.rate) * dt
        const rng = st.rng
        while (st.carry >= 1) {
          st.carry -= 1
          if (st.alive >= max) continue
          const o = st.alive++ * STRIDE
          const theta = rng.float(0, Math.PI * 2)
          const cosPhi = 1 - rng.float() * (1 - Math.cos(Math.min(Math.PI, Math.max(0, em.spread))))
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
          const v = em.speed * rng.float(0.7, 1)
          d[o] = t.x
          d[o + 1] = t.y
          d[o + 2] = t.z
          d[o + 3] = Math.cos(theta) * sinPhi * v
          d[o + 4] = cosPhi * v
          d[o + 5] = Math.sin(theta) * sinPhi * v
          d[o + 6] = 0
          d[o + 7] = em.lifetime * rng.float(0.75, 1.25)
        }
        // Write instances.
        _c0.setHex(em.color)
        _c1.setHex(em.colorEnd)
        const mesh = st.mesh
        const colors = mesh.geometry.getAttribute('color') as THREE.InstancedBufferAttribute
        for (let i = 0; i < st.alive; i++) {
          const o = i * STRIDE
          const k = d[o + 6] / d[o + 7]
          const sz = em.size * (1 - k)
          _p.set(d[o], d[o + 1], d[o + 2])
          _s.set(sz, sz, sz)
          mesh.setMatrixAt(i, _m.compose(_p, _q, _s))
          _c.copy(_c0).lerp(_c1, k)
          colors.setXYZ(i, _c.r, _c.g, _c.b)
        }
        mesh.count = st.alive
        mesh.instanceMatrix.needsUpdate = true
        colors.needsUpdate = true
      })
      // Emitters that lost their trait or were despawned.
      for (const [e, st] of emitters) {
        if (st.seen === frame) continue
        disposeMesh(st.mesh)
        emitters.delete(e)
      }
    },
    { name: 'UpdateParticles' },
  )
  app.add(Update, UpdateParticles)
  app.hooks.dispose.push(() => {
    for (const st of emitters.values()) disposeMesh(st.mesh)
    emitters.clear()
  })
}, 'ParticlesPlugin')
