// A callback parameter with no annotation takes its type from the signature it is passed to:
// `Array<T>.map((value: T) => U)`, `forEach`, `Promise<T>.then((value: T) => …)`. Two classes
// share every member name, so a name match cannot pass for a resolution — the owner is the answer.
//
// Each shape is written twice, `(u) => …` and `u => …`, because a parameter written without
// parentheses is the commoner spelling and the two must type alike.
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
  readonlyAll(): readonly User[] {
    return this.users;
  }
}

export interface Handler {
  handle(n: number): number;
}

// ── map: the method declares its own `U` beside Array's `T` ─────────────────
export function mapParen(r: Repo): string[] {
  return r.all().map((u) => u.display());
}
export function mapBare(r: Repo): string[] {
  return r.all().map(u => u.display());
}
export function mapDeclared(hs: Handler[]): number[] {
  return hs.map(h => h.handle(1));
}

// ── forEach / filter / some: no type parameter of their own ───────────────
export function forEachParen(r: Repo): void {
  r.all().forEach((u) => {
    u.save();
  });
}
export function forEachBare(r: Repo): void {
  r.all().forEach(u => {
    u.save();
  });
}
export function filterBare(r: Repo): User[] {
  return r.all().filter(u => u.save() !== '');
}
export function someReadonly(r: Repo): boolean {
  return r.readonlyAll().some(u => u.touch() === 't');
}

// ── then: the callback's parameter type is `((value: T) => …) | undefined | null` ──
export function thenParen(r: Repo): Promise<string> {
  return r.one().then((u) => u.touch());
}
export function thenBare(r: Repo): Promise<string> {
  return r.one().then(u => u.touch());
}
export function thenDeclared(p: Promise<Admin>): Promise<string> {
  return p.then(a => a.touch());
}

// ── CONTROLS: these must keep resolving, and only to their own owner ────────
export function ctlAnnotated(r: Repo): string[] {
  return r.all().map((u: User) => u.save());
}
export function ctlOtherOwner(as: Admin[]): void {
  as.forEach((a) => a.display());
}
// `catch`'s parameter is `any`: nothing to type, so `e.touch()` must stay unresolved.
export function ctlCatchAny(r: Repo): Promise<User | string> {
  return r.one().catch(e => e.touch());
}
