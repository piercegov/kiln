// Animation: the shared state graph, sprite-sheet animation (2D) and glTF skeletal animation (3D).
export {
  animationGraph,
  clipGraph,
  isAnimationGraph,
  AnimationController,
  AnimationEvent,
  AnimationStateChanged,
  AnimationFinished,
  EventSink,
  localTime,
  frameIndex,
  cycleOf,
} from './graph.ts'
export type { AnimationGraph, AnimationGraphSpec, AnimationStateSpec, AnimationEventSpec, TransitionSpec, ParamTest, LoopMode, ClipInfo, Fade, AnimationSink } from './graph.ts'
export { SpriteAnimationPlugin, SpriteAnimator, SpriteAnimation, spriteAnimator, spriteSheet, SpriteSheets, SpriteSheetStore, AnimateSprites } from './sprite.ts'
export type { SpriteSheet, SpriteSheetSpec, SpriteClipSpec, SpriteAnimatorOptions, AtlasRect } from './sprite.ts'
