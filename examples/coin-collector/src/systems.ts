import { Camera, clamp, distSq, Input, Mut, origin, Rng, setYaw, system, Transform, Ui } from 'kiln'
import { Bob, CoinCollected, IsCoin, IsPlayer, Level, Score, Spin, Velocity, WaveCleared } from './data.ts'
import { Ground, Player, spawnCoins } from './prefabs.ts'

/** Player speed in units per second. */
export const PLAYER_SPEED = 6

/** Pickup radius between the player's and a coin's centres. */
export const PICKUP_RADIUS = 0.8

/** Camera offset from the player. */
const CAMERA_OFFSET = { x: 0, y: 11, z: 9 }

// Startup

/** Startup: the floor, the player at the origin, and the first wave of coins. */
export const SpawnLevel = system(({ commands, res }) => {
  const level = res.get(Level)
  commands.spawn(Ground, { size: level.halfSize * 2 + 2 })
  commands.spawn(Player, { at: origin })
  spawnCoins(commands, res.mut(Rng), level.halfSize, level.coins)
})

// Fixed

/** Turns the input axis into player velocity on the ground plane (up = -z, away from the camera). */
export const PlayerMove = system([Mut(Velocity), IsPlayer], ([v], { res }) => {
  const { axis } = res.get(Input)
  v.x = axis.x * PLAYER_SPEED
  v.z = -axis.y * PLAYER_SPEED
})

/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.y += v.y * time.step
  t.z += v.z * time.step
})

/** Keeps the player inside the arena walls. */
export const ClampToArena = system([Mut(Transform), IsPlayer], ([t], { res }) => {
  const h = res.get(Level).halfSize + 0.5
  t.x = clamp(t.x, -h, h)
  t.z = clamp(t.z, -h, h)
})

/** Advances Spin and writes it as yaw. */
export const Spinner = system([Mut(Transform), Mut(Spin)], ([t, s], { time }) => {
  s.angle += s.speed * time.step
  setYaw(t, s.angle)
})

/** Moves Bob entities up and down on a sine of simulated time. */
export const Bobber = system([Mut(Transform), Bob], ([t, b], { time }) => {
  t.y = b.baseY + Math.sin(time.elapsed * 3 + b.phase) * b.amplitude
})

/** Despawns coins within reach of the player, adds score, and reports a cleared wave. */
export const CollectCoins = system(
  { coins: [Transform, IsCoin], player: [Transform, IsPlayer] },
  ({ coins, player }, { res, commands, events }) => {
    const p = player.first()
    if (p === undefined || coins.length === 0) return
    const pt = p.get(Transform)!
    let collected = 0
    coins.each(([t], coin) => {
      if (distSq(t, pt) < PICKUP_RADIUS * PICKUP_RADIUS) {
        commands.despawn(coin)
        res.mut(Score).value += 1
        events.emit(CoinCollected, { coin, by: p })
        collected++
      }
    })
    if (collected > 0 && collected === coins.length) events.emit(WaveCleared, { wave: res.get(Level).wave })
  },
)

/** When a wave is cleared, spawns the next one with two more coins. */
export const NextWave = system(({ events, res, commands }) => {
  for (const _ of events.read(WaveCleared)) {
    const level = res.mut(Level)
    level.wave += 1
    level.coins += 2
    spawnCoins(commands, res.mut(Rng), level.halfSize, level.coins)
  }
})

// Update

/** Eases the camera toward a point above and behind the player. */
export const CameraFollow = system({ player: [Transform, IsPlayer] }, ({ player }, { res, time }) => {
  const p = player.first()?.get(Transform)
  if (!p) return
  const cam = res.mut(Camera)
  const o = CAMERA_OFFSET
  const k = 1 - Math.exp(-6 * time.dt)
  cam.position.x += (p.x + o.x - cam.position.x) * k
  cam.position.y += (p.y + o.y - cam.position.y) * k
  cam.position.z += (p.z + o.z - cam.position.z) * k
  cam.lookAt(cam.position.x - o.x, cam.position.y - o.y, cam.position.z - o.z)
})

/** Writes score and wave into the HUD (top left). */
export const UpdateHud = system(({ res }) => {
  res.mut(Ui).text('score', `Coins ${res.get(Score).value} · Wave ${res.get(Level).wave}`)
})
