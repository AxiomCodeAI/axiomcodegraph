export class Gauge {
  #v = 0;
  get value(): number {
    return this.#v;
  }
}
