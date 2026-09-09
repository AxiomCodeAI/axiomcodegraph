// HOW THE STANDARD LIBRARY DECLARES EVERY CONSTRUCTOR. `lib.es5.d.ts` has no `class`
// declaration in it: a built-in is an instance interface, a second interface carrying
// the construct signature, and a value of that type. So `class X extends Error` — the
// commonest subclassing there is — takes this path and not the class one.
export interface LibErr {
  message: string;
  describe(): string;
}
export interface LibErrConstructor {
  new (message?: string): LibErr;
  (message?: string): LibErr;
  readonly prototype: LibErr;
}
export declare const LibErr: LibErrConstructor;

// THE CONTROL: an ordinary class in the same library, reached the same way.
export class LibClass {
  constructor(public message: string) {}
  describe(): string {
    return this.message;
  }
}
