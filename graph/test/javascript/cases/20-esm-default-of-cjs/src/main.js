import util from "./util.cjs";
import { clamp } from "./util.cjs";
import * as ns from "./util.cjs";
import shape from "./shape.cjs";
import mixed from "./mixed.cjs";
const { isString } = util;
export function main() {
  util.isString("a");
  isString("b");
  clamp(1, 2);
  ns.clamp(3, 4);
  shape.make().area();
  mixed();
  mixed.late();
}
main();
