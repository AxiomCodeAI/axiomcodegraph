import Legacy = require("./legacy");
import { NamedImpl } from "./named";

export function use(): void {
  new Legacy().go();     // the case: constructed through an export-assignment binding
  new NamedImpl().go();  // control: an ordinary named class
}
