/** One step of an input script. `frame` counts frames after script() was called (1 = the next frame). */
export type ScriptEvent = { frame: number } & (
  /** Hold an action down; `value` (default 1) for analog input such as a half-pulled trigger. */
  | { press: string; value?: number }
  | { release: string }
  /** Press now, release one frame later. */
  | { tap: string }
  /** Hold for `frames` frames. */
  | { hold: string; frames: number }
  /** A raw key code through the action map, e.g. 'Space'. */
  | { key: string; up?: boolean }
  /** Override the move axis; null hands it back to the devices. */
  | { axis: { x: number; y: number } | null }
  /**
   * Pointer position in canvas pixels (left out: it stays where it was), optionally with the primary
   * button state, normalized device coords (recordings carry them; scripts can leave them out), a
   * wheel delta, `dx`/`dy` movement for that frame (mouse look under pointer lock; without them the
   * movement is the position change) and `locked` (pointer lock taken or lost).
   */
  | {
      pointer: {
        x?: number
        y?: number
        dx?: number
        dy?: number
        locked?: boolean
        down?: boolean
        ndcX?: number
        ndcY?: number
        wheel?: number
      }
    }
)

/** What `app.input` exposes. Implemented by the input plugin. */
export interface InputController {
  /** Queues scripted input, relative to the current frame. */
  script(events: readonly ScriptEvent[]): InputController
  /** Holds an action down from the next frame on. */
  press(action: string): InputController
  release(action: string): InputController
  /** Presses on the next frame and releases the frame after. */
  tap(action: string): InputController
  setAxis(x: number, y: number): InputController
  clearAxis(): InputController
  /** Drops scripted state and pending events. */
  reset(): InputController
  /**
   * Starts recording what the game sees as a script: action values (press/release), the move axis
   * when a stick or script drives it, and the pointer. stop() returns it (peek() copies it so far);
   * script() replays it.
   */
  record(): { stop(): ScriptEvent[]; peek(): ScriptEvent[] }
}
