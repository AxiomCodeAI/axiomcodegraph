// TYPE FLOW THAT LEAVES THE CLIENT AND COMES BACK. `first(handlers)` has no type of its
// own: T is bound by the ARGUMENT, which is a client type, and the method called on the
// result is declared in the CLIENT. So the chain runs client -> library -> client, and
// an engine that treats a library return type as opaque loses the receiver entirely.
export declare function first<T>(items: readonly T[]): T;

export declare class Cell<T> {
  constructor(value: T);
  get(): T;
  map<U>(fn: (value: T) => U): Cell<U>;
}

export declare function wrap<T>(value: T): Cell<T>;

// A library interface a CLIENT class implements. The receiver is typed by the library
// and every body that can run is in the client — the reverse of the usual direction.
export interface Runner {
  run(input: string): number;
}
export declare function runAll(runners: readonly Runner[], input: string): number;

// A PROMISE-returning library function: the receiver is only known after the await.
export declare function fetchRunner(): Promise<Runner>;
