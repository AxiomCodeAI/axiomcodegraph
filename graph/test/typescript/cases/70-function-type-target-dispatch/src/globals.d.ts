// The slice of the standard library this case iterates through, so the client-only pass can type `map`'s
// callback parameter the way the full library would.
interface Array<T> {
  map<U>(fn: (v: T, i: number) => U): U[];
  [n: number]: T;
}
