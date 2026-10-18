import { ActionMap, AnimationEvent, Input, Mut, SpriteAnimator, system, Transform, Tweens, Ui } from 'kiln-ecs'
import { DummyHit, Hits, IsDummy, IsHero, Velocity } from './data.ts'
import { Dummy, Dust, Ground, Hero } from './prefabs.ts'

/** Run speed in units per second. */
export const RUN_SPEED = 6

/** Take-off speed of a jump, in units per second. */
export const JUMP_SPEED = 11

/** Downward acceleration in units per second squared. */
export const GRAVITY = 30

/** How far in front of the hero the sword reaches. */
export const SWORD_REACH = 1.8

/** The arena spans -ARENA..ARENA on x. */
export const ARENA = 12

// Startup

/** Startup: the ground, three dummies and the hero; J swings too. */
export const SpawnLevel = system(({ commands, res }) => {
  res.mut(ActionMap).fire.push('KeyJ')
  commands.spawn(Ground, { width: ARENA * 2 + 4 })
  for (const x of [-6, 4, 8]) commands.spawn(Dummy, { x })
  commands.spawn(Hero, { x: 0 })
})

// Fixed

/**
 * Input to velocity and animation params: run on the axis, jump on `jump`, swing on `fire`. Faces
 * the way it runs. Standing still while the swing plays. Runs before AnimateSprites.
 */
export const HeroControl = system([Mut(Velocity), Mut(SpriteAnimator), Transform, IsHero], ([v, anim, t], { res }) => {
  const input = res.get(Input)
  const grounded = t.y <= 0
  const attacking = anim.is('attack')
  v.x = attacking ? 0 : input.axis.x * RUN_SPEED
  if (grounded && !attacking && input.pressed('jump')) v.y = JUMP_SPEED
  if (grounded && input.pressed('fire')) anim.trigger('attack')
  if (v.x !== 0) anim.flipX = v.x < 0
  anim.set('speed', Math.abs(v.x)).set('grounded', grounded && v.y <= 0).set('vy', v.y)
})

/** Gravity, integration and the ground and arena edges. */
export const Physics = system([Mut(Transform), Mut(Velocity)], ([t, v], { time }) => {
  v.y -= GRAVITY * time.step
  t.x = Math.max(-ARENA, Math.min(ARENA, t.x + v.x * time.step))
  t.y += v.y * time.step
  if (t.y <= 0) {
    t.y = 0
    v.y = 0
  }
})

/** On the sword's hit frame, hits every dummy within reach in front of the hero. */
export const SwordHits = system(
  { hero: [Transform, SpriteAnimator, IsHero], dummies: [Transform, IsDummy] },
  ({ hero, dummies }, { events, res }) => {
    for (const ev of events.read(AnimationEvent)) {
      if (ev.name !== 'hitFrame') continue
      hero.each(([h, anim], e) => {
        if (e !== ev.entity) return
        const dir = anim.flipX ? -1 : 1
        dummies.each(([d], dummy) => {
          const ahead = (d.x - h.x) * dir
          if (ahead > 0 && ahead <= SWORD_REACH && Math.abs(d.y - h.y) < 1.5) {
            res.mut(Hits).value++
            events.emit(DummyHit, { dummy })
          }
        })
      })
    }
  },
)

/** Footsteps kick up dust at the hero's feet. */
export const FootstepDust = system({ hero: [Transform, SpriteAnimator, IsHero] }, ({ hero }, { events, commands }) => {
  for (const ev of events.read(AnimationEvent)) {
    if (ev.name !== 'footstep') continue
    hero.each(([h, anim], e) => {
      if (e === ev.entity) commands.spawn(Dust, { x: h.x + (anim.flipX ? 0.4 : -0.4), flipX: anim.flipX })
    })
  }
})

/** A hit dummy squashes and springs back. */
export const WobbleDummies = system(({ events, res }) => {
  for (const hit of events.read(DummyHit)) {
    res.mut(Tweens).to(hit.dummy, Transform, { sy: 1 }, { from: { sy: 0.6 }, duration: 0.35, ease: 'outElastic' })
  }
})

// Update

/** The hit counter and controls in the HUD. */
export const UpdateHud = system(({ res }) => {
  const ui = res.mut(Ui)
  ui.text('hits', `Hits ${res.get(Hits).value}`)
  ui.text('help', 'Move: A/D · Jump: Space · Swing: click or J', { anchor: 'bottom', size: 14, color: '#c8d0dc' })
})
