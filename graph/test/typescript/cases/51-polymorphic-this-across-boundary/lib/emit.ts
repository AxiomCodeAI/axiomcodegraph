// A fluent API declared in a DEPENDENCY. This is the idiom's home -- builders and
// emitters are far more often imported than written in the client -- which is why
// resolving `this` only for client declarations lost the whole chain after hop one.
export declare class Emitter {
  on(name: string): this;
  emit(name: string): void;
}
