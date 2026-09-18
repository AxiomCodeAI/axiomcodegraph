import { compute, other, cbrt, plain, named } from "./impl.js";
export function drive() {
  return compute(1) + other(2) + cbrt(8) + plain(3) + named(4);
}
