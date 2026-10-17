/** One step of an input script. `frame` counts frames after script() was called (1 = the next frame). */
export type ScriptEvent = { frame: number } & (
  | { press: string }
  | { release: string }
  /** Press now, release one frame later. */
  | { tap: string }
  /** Hold for `frames` frames. */
  | { hold: string; frames: number }
  /** A raw key code through the action map, e.g. 'Space'. */
  | { key: string; up?: boolean }
  /** Override the move axis; null hands it back to the devices. */
  | { axis: { x: number; y: number } | null }
  /** Pointer position in canvas pixels, optionally with the primary button state. */
  | { pointer: { x: number; y: number; down?: boolean } }
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
  /** Starts recording live action changes; stop() returns them as a script. */
  record(): { stop(): ScriptEvent[] }
}
