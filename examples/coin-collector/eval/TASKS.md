# Agent eval: Coin Collector

Three feature requests of increasing reach. Each has a check file that fails today and passes
once the feature is built the Kiln way. Give an agent one task's text (not the check), then run:

```bash
bun test ./eval/checks/<task>.eval.ts && kiln test && kiln check
```

A task passes when its check, the existing scenarios and `kiln check` all pass. Also look at
`git diff`: the feature should be new exports in the existing files plus lines in `src/main.ts`.

## 1. dash

Pressing the `sprint` action makes the player dash: for 0.2 seconds (12 fixed steps) the player
moves at 3× `PLAYER_SPEED` in its current move direction, then a 1 second cooldown starts
(counted from the end of the dash) during which `sprint` does nothing. Dashing with no move input
does nothing. Put the dash state in a trait exported as `Dash` from `src/data.ts`.

## 2. chasers

Add enemies. Export an `IsEnemy` tag and a `PlayerHit` event (payload `{ enemy: Entity }`)
from `src/data.ts`. At Startup spawn 3 enemies, one in
each of three arena corners (±(halfSize − 1)), using a prefab. Each fixed step they move straight
toward the player at 2 units per second. When an enemy is within 0.9 units of the player: emit
`PlayerHit`, reset `Score` to 0, and put the player back at the origin. Enemies get a red mesh.

## 3. round-timer

Add a 60-second round. Export a `RoundTimer` resource (`{ remaining: 60 }`, seconds) and a `RoundOver`
event (payload `{ score: number }`) from `src/data.ts`. The timer counts down in Fixed using simulated time. When it reaches
0 it stays at 0, `RoundOver` is emitted exactly once, and from then on the player no longer moves
from input. Show the remaining whole seconds in the HUD.

## Results log

- 2026-10-17, first run (one fresh agent per task, given only the task text and the game folder):
  dash 3/3, chasers 3/3, round-timer 2/2 on the checks; `kiln test` and `kiln check` green in all
  three. Friction they reported was fixed in the guide and in `kiln docs` (see git log).
