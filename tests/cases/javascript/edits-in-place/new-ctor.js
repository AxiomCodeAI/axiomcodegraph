export class S {
  constructor({ a, c }) {
    this.a = a;
    this.c = c;
    this.n = 1;
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
