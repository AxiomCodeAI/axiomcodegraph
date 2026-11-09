// A runtime's global namespace, staged as a library: a const typed by an interface with
// a call signature, a const typed by a plain interface, and a function.
declare namespace Rt {
  export interface TestFn {
    (name: string, fn: () => void): void;
    only(name: string, fn: () => void): void;
  }
  export interface Env {
    get(key: string): string | undefined;
  }
  export const test: TestFn;
  export const env: Env;
  export function serve(port: number): void;
}
