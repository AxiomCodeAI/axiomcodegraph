// 80's shapes with NO standard library in the graph, which is what a default index is:
// `map`, `forEach` and `then` have no declaration to read a callback signature from, so
// the parameter's type has to come off the receiver's own reference, the way a `for…of`
// binding over the same receiver already does. Two classes share every member name, so a
// name match cannot pass for a resolution.
export class User {
  display(): string {
    return 'd';
  }
  save(): string {
    return 's';
  }
  touch(): string {
    return 't';
  }
}
export class Admin {
  display(): string {
    return 'D';
  }
  save(): string {
    return 'S';
  }
  touch(): string {
    return 'T';
  }
}

export class Repo {
  constructor(private readonly pending: Promise<User>, private readonly users: User[]) {}
  all(): User[] {
    return this.users;
  }
  one(): Promise<User> {
    return this.pending;
  }
  readonlyAll(): ReadonlyArray<User> {
    return this.users;
  }
}

export function mapBare(r: Repo): string[] {
  return r.all().map(u => u.display());
}
export function forEachParen(r: Repo): void {
  r.all().forEach((u) => {
    u.save();
  });
}
export function findReadonly(r: Repo): User | undefined {
  return r.readonlyAll().find(u => u.touch() === 't');
}
export function everyParam(as: Admin[]): boolean {
  return as.every(a => a.save() !== '');
}
// `reduce`'s first parameter is the accumulator: only the second is the element.
export function reduceElement(us: User[]): string {
  return us.reduce((acc, u) => acc + u.save(), '');
}
export function thenBare(r: Repo): Promise<string> {
  return r.one().then(u => u.touch());
}
export function thenParam(p: Promise<Admin>): Promise<string> {
  return p.then(a => a.display());
}

// ── CONTROLS ────────────────────────────────────────────────────────────────
// A class of the user's own with a `then` and a `map`: its own signatures type the
// callback, and nothing about Promise or Array may be added to them.
export class Lazy {
  then(cb: (a: Admin) => string): string {
    return cb(new Admin());
  }
  map(cb: (u: User) => string): string {
    return cb(new User());
  }
}
export function ctlOwnThen(l: Lazy): string {
  return l.then(a => a.touch());
}
export function ctlOwnMap(l: Lazy): string {
  return l.map(u => u.touch());
}
// An annotated parameter keeps its annotation.
export function ctlAnnotated(us: User[]): string[] {
  return us.map((u: User) => u.save());
}
