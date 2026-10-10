// A FUNCTION HANDED TO A HIGHER-ORDER FUNCTION WITH NO BODY. `map`, `forEach` and `onReady` are declarations
// only, so the site that hands the callback over is what reaches it: each function below reaches its own
// callback and nothing another function handed to the same `map`.
import { RATE } from './rate'

const seen: number[] = []
function record(n: number): void {
  seen[0] = n
}

export function scaled(xs: number[]): number[] {
  return xs.map((x) => x * RATE)
}

export function doubled(xs: number[]): number[] {
  return xs.map((x) => x * 2)
}

function double(n: number): number {
  return n * 2
}

// a named function handed over: still reached, from the site that names it
export function named(xs: number[]): number[] {
  return xs.map(double)
}

// …and one held by a local first
export function viaLocal(xs: number[]): void {
  const log = (n: number) => record(n)
  xs.forEach(log)
}

// an ambient declaration with no body anywhere: a host API that calls back
declare function onReady(cb: () => void): void

export function atStartup(): void {
  onReady(() => record(RATE))
}

// CONTROL: a project higher-order function has a body that calls its parameter, so the callback is
// still a dispatch candidate of the parameter's function type, reached through `each`'s own call.
export function each(xs: number[], fn: (n: number) => void): void {
  for (const x of xs) fn(x)
}

export function useEach(xs: number[]): void {
  each(xs, (n) => record(n + RATE))
}

// a host registration with no body: the const handed to it holds a library-wrapped function literal, and
// registering the const reaches that literal as registering the literal bare does
import { migrate, plugin, settings } from './plugin'
declare const host: { register(p: unknown): void }

export function boot(): void {
  host.register(plugin)
}

// CONTROL: the literal handed bare, already reached from the site that hands it
export function bootBare(): void {
  host.register(async () => migrate())
}

// CONTROL: a const with no function in it registers nothing
export function bootSettings(): void {
  host.register(settings)
}
