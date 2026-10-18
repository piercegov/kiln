import { CameraRig, CameraShake, clamp, distSq, Input, Mut, origin, Rng, setYaw, system, Transform, Tweens, Ui, UiClick } from 'kiln-ecs'
import { Best, Bob, CoinCollected, IsCoin, IsPlayer, Level, Score, Screen, Spin, Velocity, WaveCleared } from './data.ts'
import { Ground, Player, spawnCoins } from './prefabs.ts'

/** Player speed in units per second. */
export const PLAYER_SPEED = 6

/** Pickup radius between the player's and a coin's centres. */
export const PICKUP_RADIUS = 0.8

// Startup

/** Startup: the floor, the player at the origin, the first wave of coins, and the camera offset. */
export const SpawnLevel = system(({ commands, res }) => {
  const level = res.get(Level)
  commands.spawn(Ground, { size: level.halfSize * 2 + 2 })
  commands.spawn(Player, { at: origin })
  spawnCoins(commands, res.mut(Tweens), res.mut(Rng), level.halfSize, level.coins)
  res.mut(CameraRig).offset = { x: 0, y: 11, z: 9 }
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
        events.emit(CameraShake, { amount: 0.25 })
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
    spawnCoins(commands, res.mut(Tweens), res.mut(Rng), level.halfSize, level.coins)
  }
})

// Update

/** Pauses on the `pause` action and shows a pause menu; the action or the Resume button resumes. */
export const TogglePause = system(({ res, events }) => {
  const screen = res.get(Screen)
  const resume = events.read(UiClick).some((c) => c.id === 'pause.resume')
  if (!resume && !res.get(Input).pressed('pause')) return
  const ui = res.mut(Ui)
  if (screen.is('playing') && !resume) {
    res.mut(Screen).set('paused')
    ui.text('pause.title', 'Paused', { anchor: 'center', size: 48 })
    ui.button('pause.resume', 'Resume', { anchor: 'center' })
  } else if (screen.is('paused')) {
    res.mut(Screen).set('playing')
    ui.clear('pause.')
  }
})

/** Keeps the best score up to date (it is persisted by savePlugin). */
export const TrackBest = system(({ res }) => {
  const score = res.get(Score).value
  if (score > res.get(Best).score) res.mut(Best).score = score
})

/** Writes score, wave and best into the HUD (top left). */
export const UpdateHud = system(({ res }) => {
  const ui = res.mut(Ui)
  ui.text('score', `Coins ${res.get(Score).value} · Wave ${res.get(Level).wave}`)
  ui.text('best', `Best ${res.get(Best).score}`, { size: 14, color: '#c8d0dc' })
})
