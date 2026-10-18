import { AnimateSprites, chain, createApp, CorePlugins, Fixed, SpriteAnimationPlugin, Startup, Update } from 'kiln-ecs'
import config from '../kiln.config.ts'
import { DummyHit, Hits } from './data.ts'
import { FootstepDust, HeroControl, Physics, SpawnLevel, SwordHits, UpdateHud, WobbleDummies } from './systems.ts'

/** Sprite Hero: a 2D sprite-sheet hero who runs, jumps and swings at training dummies. */
export default () =>
  createApp(config)
    .use(CorePlugins, SpriteAnimationPlugin)
    .init(Hits, DummyHit)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(HeroControl.before(AnimateSprites), Physics), chain(SwordHits.after(AnimateSprites), WobbleDummies), FootstepDust.after(AnimateSprites))
    .add(Update, UpdateHud)
