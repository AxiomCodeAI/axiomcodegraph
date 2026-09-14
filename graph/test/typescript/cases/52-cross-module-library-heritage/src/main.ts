import { Rect } from "../lib/core";
import { Square, Circle } from "../lib/ext";

// The control: a CLIENT class extending a library class. That route already worked, so
// only the two library-to-library lines should ever move.
export class Local extends Rect { side(): number { return 2; } }

export function use(sq: Square, ci: Circle, lo: Local): void {
  sq.area();    // inherited from Rect, across library modules
  ci.label();   // inherited from Shape, across library modules
  lo.area();    // control: inherited from Rect by a client subclass
}
