import { CameraPlugin, chain, createApp, CorePlugins, Fixed, inState, runIf, savePlugin, Startup, Update } from 'kiln-ecs'
import config from '../kiln.config.ts'
import { Best, CoinCollected, Level, Score, Screen, WaveCleared } from './data.ts'
import { ClampToArena, CollectCoins, Movement, NextWave, PlayerMove, SpawnLevel, Spinner, Bobber, TogglePause, TrackBest, UpdateHud } from './systems.ts'

/** Coin Collector: move with WASD / arrows / left stick, collect every coin to start the next wave. Escape pauses. */
export default () =>
  createApp(config)
    .use(CorePlugins, CameraPlugin, savePlugin({ key: 'coin-collector', persist: [Best] }))
    .init(Score, Level, Screen, CoinCollected, WaveCleared)
    .add(Startup, SpawnLevel)
    .add(Fixed, runIf(inState(Screen, 'playing'), chain(PlayerMove, Movement, ClampToArena, Spinner, Bobber, CollectCoins, NextWave)))
    .add(Update, TogglePause, TrackBest, UpdateHud)
