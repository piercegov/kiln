import { chain, createApp, CorePlugins, Fixed, Startup } from 'kiln-ecs'
import config from '../kiln.config.ts'
import { Movement, PlayerMove, SpawnLevel } from './systems.ts'

/** The game: the whole schedule, top to bottom. */
export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement))
