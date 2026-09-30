export const ANY = '*';

export type Handler = (payload: unknown) => void;

// A registry of callbacks keyed by name: a Map from the name to a Set of handlers.
export class Bus {
  private readonly handlers = new Map<string, Set<Handler>>();

  subscribe(name: string, fn: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  // every entry of the table is subscribed under its own key
  subscribeAll(table: Record<string, Handler>): void {
    for (const name of Object.keys(table)) {
      const fn = table[name];
      if (fn) this.subscribe(name, fn);
    }
  }

  // reads the registry by key and never calls what it finds
  count(name: string): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  publish(name: string, payload: unknown): void {
    const run = () => this.dispatch(name, payload);
    run();
  }

  private dispatch(name: string, payload: unknown): void {
    const targets: Handler[] = [...(this.handlers.get(name) ?? []), ...(this.handlers.get(ANY) ?? [])];
    for (const handler of targets) handler(payload);
  }
}

// The same idea written tersely: the set created inline, and the lookup iterated directly.
export class MiniBus {
  private h = new Map<string, Set<(p: unknown) => void>>();

  on(k: string, fn: (p: unknown) => void) {
    (this.h.get(k) ?? this.h.set(k, new Set()).get(k)!).add(fn);
  }

  fire(k: string, p: unknown) {
    for (const f of this.h.get(k) ?? []) f(p);
    this.h.get('*')?.forEach((f) => f(p));
  }
}
