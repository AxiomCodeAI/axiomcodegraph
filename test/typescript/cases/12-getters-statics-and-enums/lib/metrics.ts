export enum Unit {
  Ms = "ms",
  S = "s",
}
export class Gauge {
  static create(): Gauge {
    return new Gauge();
  }
  get value(): number {
    return 0;
  }
  record(n: number): number {
    return n;
  }
}
