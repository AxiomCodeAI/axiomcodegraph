// A bus holds what it was built with and what was subscribed on it.
export class Bus {
  constructor({ validate } = {}) { this.v = validate; this.subs = []; }
  on(f) { this.subs.push(f); }
  emit(e) { this.v?.(e); this.subs.forEach((f) => f(e)); }
}

// control: a registry whose handler is written inside the class serves every instance.
export function defaultHandler(x) { return x; }
export class Registry {
  constructor() { this.h = defaultHandler; }
  run(x) { return this.h(x); }
}
