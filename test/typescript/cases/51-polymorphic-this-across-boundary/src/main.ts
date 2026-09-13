import { Emitter } from "../lib/emit";

// The same shape declared in the CLIENT. It chained before this case existed, so it is
// the control: only the library line should ever move.
export class LocalEmitter {
  on(name: string): this { return this; }
  emit(name: string): void {}
}

export function use(e: Emitter, l: LocalEmitter): void {
  e.on("a").emit("a");   // the case: `this` returned from a library declaration
  l.on("a").emit("a");   // control: `this` returned from a client declaration
}
