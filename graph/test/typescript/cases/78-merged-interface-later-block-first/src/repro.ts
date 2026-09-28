import "./augment";
import type { Text, Plain, Typed, Strict, Rx, Bare } from "./text";
export function use(t: Text, s: string, p: Plain): void {
  t.find(/x/);
  s.match(/x/);
  p.pick(/x/);
}
// The augmentation's block is tried first, and a Rx fits its Matcher.
export function typed(t: Typed, r: Rx): void {
  t.take(r);
}
// Control: a Bare does not fit the augmentation's Matcher, so the original stays.
export function strict(t: Strict, b: Bare): void {
  t.hold(b);
}
