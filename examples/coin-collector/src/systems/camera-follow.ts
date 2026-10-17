import { Camera, system, Transform } from 'kiln'
import { IsPlayer } from '../traits/is-player.ts'

/** Camera offset from the player. */
const OFFSET = { x: 0, y: 11, z: 9 }

/** Eases the camera toward a point above and behind the player. */
export const CameraFollow = system({ player: [Transform, IsPlayer] }, ({ player }, { res, time }) => {
  const p = player.first()?.get(Transform)
  if (!p) return
  const cam = res.mut(Camera)
  const k = 1 - Math.exp(-6 * time.dt)
  cam.position.x += (p.x + OFFSET.x - cam.position.x) * k
  cam.position.y += (p.y + OFFSET.y - cam.position.y) * k
  cam.position.z += (p.z + OFFSET.z - cam.position.z) * k
  cam.lookAt(cam.position.x - OFFSET.x, cam.position.y - OFFSET.y, cam.position.z - OFFSET.z)
})
