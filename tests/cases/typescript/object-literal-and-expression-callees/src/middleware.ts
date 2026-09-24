// A CALL THROUGH AN ARRAY ELEMENT BOUND TO A LOCAL. `middleware[i][0][0]` reads a function out of an array of arrays
// of tuples; the local it is bound to is then called. The call resolves to Handler's call signature through the
// element type, and the functions written as a Handler are its dispatch candidates.
export type Handler = (ctx: string, next: () => void) => void
export type Entry = [Handler, number]

export const logger: Handler = (ctx, next) => next()

export function dispatch(middleware: Entry[][], i: number): void {
  const handler = middleware[i][0][0]
  handler('ctx', () => {})
}

export function boot(): void {
  dispatch([[[logger, 1]]], 0)
}
