import isLen from "./vlib/isLen";
import { isLenNamed } from "./vlib/isLen";

export function use(): void {
  isLen("x");        // the case: a default export of a qualified expression
  isLenNamed("y");   // control: a named export from the same module
}
