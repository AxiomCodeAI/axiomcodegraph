// census: fn_value (SPEC R21; call-chain break class 2, "callback / higher-order: function values")
// A function value passed, stored or returned reaches its target when the value is decidable: a callback
// parameter, a handler table read with a literal key (dot, bracket, and a const key), an options-object function,
// an array element, a returned function, and a bound function. A table read with a key the program does not decide
// is a declared unknown, never silently dropped.
export function archive(id: string) {
  return `archived ${id}`
}
export function restore(id: string) {
  return `restored ${id}`
}
export function purge(id: string) {
  return `purged ${id}`
}

export const handlers = { archive, restore, purge }

export function withRetry<T>(times: number, fn: () => T): T {
  let last: T = fn()
  for (let i = 1; i < times; i++) last = fn()
  return last
}

export function tryit<A extends unknown[], R>(fn: (...a: A) => R) {
  return (...a: A) => fn(...a)
}

export function run(opts: { getInput: () => string }) {
  return opts.getInput()
}

export function readInput() {
  return 'input'
}

export const pipeline = [archive, restore]

export class Mailer {
  from: string
  constructor(from: string) {
    this.from = from
  }
  send(to: string) {
    return `${this.from} -> ${to}`
  }
}
