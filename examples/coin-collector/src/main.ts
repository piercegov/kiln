import { chain, createApp, CorePlugins, Fixed, Startup, Update } from 'kiln'
import config from '../kiln.config.ts'
import { CoinCollected, Level, Score, WaveCleared } from './data.ts'
import { Bobber, CameraFollow, ClampToArena, CollectCoins, Movement, NextWave, PlayerMove, SpawnLevel, Spinner, UpdateHud } from './systems.ts'

/** Coin Collector: move with WASD / arrows / left stick, collect every coin to start the next wave. */
export default () =>
  createApp(config)
    .use(CorePlugins)
    .init(Score, Level, CoinCollected, WaveCleared)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement, ClampToArena, Spinner, Bobber, CollectCoins, NextWave))
    .add(Update, CameraFollow, UpdateHud)
