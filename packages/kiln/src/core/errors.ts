/**
 * Every error Kiln throws names the fix. `message` reads as "<what happened>. <what to do>".
 */
export class KilnError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KilnError'
    this.code = code
  }
}
