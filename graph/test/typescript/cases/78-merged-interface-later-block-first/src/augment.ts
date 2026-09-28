import type { Matcher } from "./text";
declare module "./text" {
  interface Text { find(m: Matcher): 2; }
  interface Typed { take(m: Matcher): 2; }
  interface Strict { hold(m: Matcher): 2; }
}
export {};
