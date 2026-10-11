export class S {
  constructor({ a, b }) {
    this.n = 2;
    this.a = a;
    this.b = b;
  }

  async oldName(x, y) {
    return x + y;
  }

  keep(v) {
    return v;
  }
}

export function stamp(v, clock = { millis: () => Date.now() }) {
  return { v, at: clock.millis() };
}

export class Err extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'Err';
  }
}
