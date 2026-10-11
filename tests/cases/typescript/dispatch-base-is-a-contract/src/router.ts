// The shape of #1011: a bodiless interface method with two implementations. The engine records
// dispatch_candidates base -> candidate and NO override rows for it (TypeScript is structural), so the
// contract subtraction that saves the override case cannot save this one.
export interface Router {
  add(path: string): void;
}

export class LinearRouter implements Router {
  add(path: string): void {
    this.rows.push(path);
  }
  rows: string[] = [];
}

export class TrieRouter implements Router {
  add(path: string): void {
    this.seen = path;
  }
  seen = '';
}

export class App {
  constructor(private readonly router: Router) {}
  mount(path: string): void {
    this.router.add(path);          // typed to the interface: the dispatch base
  }
}

// No `implements`: it fits Router's shape and is passed as one, so it may run at `mount` — but nothing
// declared the contract, so a change to it does not have to change Router.add.
export class DuckRouter {
  add(path: string): void {
    this.last = path;
  }
  last = '';
}

export function duckApp(): App {
  return new App(new DuckRouter());
}
