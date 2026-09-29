// A METHOD PASSED BY REFERENCE. `this.m`, `this.m.bind(this)`, `xs.forEach(this.m, this)` and a listener
// registered on a typed receiver hand the method over without calling it, exactly as `xs.map(double)` hands a
// free function over, so the method that writes the hand-off reaches the method it hands.
export interface Target {
  addEventListener(type: string, fn: () => void): void;
}

export class Widget {
  private scale = 2;
  handle(n: number): number { return n * this.scale; }
  onClick(): number { return 1; }
  onHover(): number { return 2; }
  onTap(): number { return 4; }
  later(): () => void { return () => {}; }
  label = 'w';

  start(xs: number[]): number[] {
    xs.forEach(this.handle.bind(this));
    return xs.map(this.handle, this);
  }

  wire(el: Target): void {
    el.addEventListener('click', this.onClick);
    setTimeout(this.onHover.bind(this));
  }

  // a method of ANOTHER instance, handed over through a typed receiver
  relay(other: Widget, xs: number[]): void {
    xs.forEach(other.handle, other);
  }

  // CONTROL: an arrow that CALLS the method is the arrow's call, as before — the passer registers the arrow only
  tap(el: Target): void {
    el.addEventListener('tap', () => this.onTap());
  }

  // CONTROL: `call` RUNS the method here and hands over what it returns (the arrow `later` returns, not
  // `later`), a data field is not a function, and a getter is READ where it is written: its value is handed over
  now(xs: number[]): void {
    setTimeout(this.later.call(this));
    xs.forEach(this.label as any);
    xs.forEach(this.current);
  }

  get current(): (n: number) => void { return () => {}; }
}
