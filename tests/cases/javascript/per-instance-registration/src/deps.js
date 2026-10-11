// A holder calls the dependency it was built with, or the one it builds when given none.
export class DefaultDep { run() { return 1; } }
export class OtherDep { run() { return 2; } }
export class Holder {
  constructor(dep) { this.dep = dep ?? new DefaultDep(); }
  go(f) { f(); return this.dep.run(); }
}
const h1 = new Holder();
const h2 = new Holder(new DefaultDep());
const h3 = new Holder(new OtherDep());
export const goDefault = () => h1.go(() => 0);
export const goExplicit = () => h2.go(() => 0);
export const goOther = () => h3.go(() => 0);
