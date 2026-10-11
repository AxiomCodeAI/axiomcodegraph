// NEAR MISS: a Map or Set stores, finds and drops a function and never calls it, so storing one is not
// handing it over: `set`, `add` and `has` reach nothing. Neither is declared in this case, so each is
// recognised by the reference it was declared with or by the `new` that initialises it.
function onUpdated(): number {
  return 1
}

const handlers = new Map()
const subs: Set<() => number> = new Set()

export function store(): void {
  handlers.set('a', onUpdated)
  subs.add(onUpdated)
}

export function known(): boolean {
  return subs.has(onUpdated)
}

// CONTROL: a host API with no body that is handed the same function still reaches it.
declare function later(cb: () => number): void

export function deferred(): void {
  later(onUpdated)
}
