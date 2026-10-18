import { createApp, CorePlugins, Startup, system, Transform } from 'kiln-ecs'
import { CameraFollow, OrbitCamera, OrbitCameraPlugin } from '../../../../community/orbit-camera/index.ts'
import { Water, WaterPlugin } from '../../../../community/water/index.ts'
import { Terrain, terrainHeightAt, TerrainPlugin } from '../../../../community/terrain/index.ts'
import { ParticleEmitter, ParticlesPlugin } from '../../../../community/particles/index.ts'
import { AudioPlugin, Sound } from '../../../../community/audio/index.ts'
import config from '../kiln.config.ts'

const terrain = { size: 60, resolution: 120, height: 7, seed: 3, scale: 16, octaves: 4, colorLow: 0xd9c99a, colorHigh: 0x2f6b2f }

/** Spawns the showcase: terrain, water, a fire-like emitter on a hill, an orbit camera and a sound. */
export const SpawnWorld = system(({ commands }) => {
  commands.spawn(Transform, Terrain(terrain))
  commands.spawn(Transform({ y: 2.2 }), Water({ size: 60, segments: 160, waveHeight: 0.45 }))
  const x = 6
  const z = -4
  const y = terrainHeightAt(terrain, x, z)
  commands.spawn(Transform({ x, y, z }), ParticleEmitter({ rate: 80, speed: 3.5, size: 0.35, lifetime: 1.6, max: 400 }), CameraFollow({ smoothing: 0, offsetY: 0 }))
  commands.spawn(Transform({ x, y, z }), Sound({ src: '/sfx/missing-campfire.ogg', loop: true }))
  commands.spawn(OrbitCamera({ distance: 24, yaw: 0.9, pitch: 0.5 }))
})

export default () =>
  createApp(config).use(CorePlugins, OrbitCameraPlugin, WaterPlugin, TerrainPlugin, ParticlesPlugin, AudioPlugin).add(Startup, SpawnWorld)
