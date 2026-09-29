// An API module: a const object literal of callables, exported and called from elsewhere.
export function listUsers(): string[] { return []; }
export function getUserById(id: string): string { return id; }

export const api = {
  users: {
    list() { return listUsers(); },
    get: (id: string) => getUserById(id),
    byName: function (n: string) { return n; },
  },
  ping() { return 'pong'; },
  remove: (id: string) => id,
  find: getUserById,
};

// A factory returning a literal: the call's value is that literal.
export function makeStore(start: number) {
  let n = start;
  return {
    inc() { n += 1; return n; },
    reset: () => { n = 0; },
  };
}

// CONTROL: a literal bound to an ANNOTATED const. The compiler resolves a call through it
// to the interface's member signature, so the literal's own method must not be added.
export interface Greeter { greet(n: string): string }
export const greeter: Greeter = { greet(n: string) { return n; } };

// CONTROL: a factory with a declared return type — the annotation is the answer.
export function makeGreeter(): Greeter { return { greet: (n: string) => n.trim() }; }
