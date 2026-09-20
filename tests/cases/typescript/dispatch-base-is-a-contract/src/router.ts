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
