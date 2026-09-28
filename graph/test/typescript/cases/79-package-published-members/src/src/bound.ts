// A published const bound to a method reference: the headline API of many libraries.
class Engine {
  produce(x: number) { return x + 1; }
  finish(x: number) { return x - 1; }
  static make() { return new Engine(); }
  // CONTROL: a method no published const names stays unrooted.
  unused() { return 0; }
}
const engine = new Engine();
export const produce = engine.produce;
export const finish = engine.finish.bind(engine);
export const make = Engine.make;
// CONTROL: a published const holding a plain value roots nothing.
export const version = 1;
