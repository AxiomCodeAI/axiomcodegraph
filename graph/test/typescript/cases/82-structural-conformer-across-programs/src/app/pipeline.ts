// Production code, in its own program. `Pipeline` has a `map`, so by shape it "satisfies"
// the FIXTURE program's hand-written `Array` too — but no value of it can ever reach a
// receiver typed by that `Array`: neither program sees the other's files. So the fixture's
// `rows.map(...)` must not dispatch here, and `this.items.map(project)` must not reach the
// fixture's callback through that dispatch.
export class Pipeline<T> {
  constructor(private readonly items: T[]) {}

  map<U>(project: (value: T) => U): Pipeline<U> {
    return new Pipeline(this.items.map(project));
  }
}

export function build(xs: string[]): Pipeline<string> {
  return new Pipeline(xs).map((s) => s);
}
