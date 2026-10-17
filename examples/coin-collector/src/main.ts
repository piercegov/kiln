import { chain, createApp, CorePlugins, Fixed, Startup, Update } from 'kiln'
import config from '../kiln.config.ts'
import { Bobber } from './systems/bobber.ts'
import { CameraFollow } from './systems/camera-follow.ts'
import { ClampToArena } from './systems/clamp-to-arena.ts'
import { CollectCoins } from './systems/collect-coins.ts'
import { Movement } from './systems/movement.ts'
import { NextWave } from './systems/next-wave.ts'
import { PlayerMove } from './systems/player-move.ts'
import { SpawnLevel } from './systems/spawn-level.ts'
import { Spinner } from './systems/spinner.ts'
import { UpdateHud } from './systems/update-hud.ts'
import { Level } from './resources/level.ts'
import { Score } from './resources/score.ts'
import { CoinCollected } from './events/coin-collected.ts'
import { WaveCleared } from './events/wave-cleared.ts'

/** Coin Collector: move with WASD / arrows / left stick, collect every coin to start the next wave. */
export default () =>
  createApp(config)
    .use(CorePlugins)
    .init(Score, Level, CoinCollected, WaveCleared)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement, ClampToArena, Spinner, Bobber, CollectCoins, NextWave))
    .add(Update, CameraFollow, UpdateHud)
