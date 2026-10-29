// `call` / `apply` / `bind` on a METHOD read as a value, `this.render.bind(this)`. The
// receiver names a method, so it had no type for the Function members to attach to.
// src/globals.d.ts and noLib, as in case 21, put the targets inside the case.
class View {
  render(): string { return "v"; }
  get label(): () => string { return () => "l"; }
  handler: (x: number) => number = (x) => x;
  wire(): void {
    this.render = this.render.bind(this);
    const r = this.render.call(this);
    const s = this.render.apply(this, []);
    // the bound result runs the method
    const bound = this.render.bind(this);
    const b = bound();
    // controls: a function-typed field already resolved; a getter's value is what it returns
    const h = this.handler.bind(this);
    const l = this.label.bind(this);
  }
}
function runOn(v: View): string { return v.render.call(v); }
export { View, runOn };
