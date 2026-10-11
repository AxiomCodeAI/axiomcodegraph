export class S {
  constructor({ a, b }) {
    this.a = a;
    this.b = b;
    this.n = 1;
  }

  async oldName(x, y) {
    return x + y;
  }

  keep(v) {
    return v;
  }
}

export function stamp(v, clock = { millis: () => Date.now() + 1 }) {
  return { v, at: clock.millis() };
}

export class Err extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'Err';
  }
}
