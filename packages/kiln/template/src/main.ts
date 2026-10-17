import { chain, createApp, CorePlugins, Fixed, Startup } from 'kiln'
import config from '../kiln.config.ts'
import { Movement } from './systems/movement.ts'
import { PlayerMove } from './systems/player-move.ts'
import { SpawnLevel } from './systems/spawn-level.ts'

/** The game: the whole schedule, top to bottom. */
export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement))
