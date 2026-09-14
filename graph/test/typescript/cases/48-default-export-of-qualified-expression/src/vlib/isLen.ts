// `export default <expression>` records exportedEntityKind = EXPRESSION with an EMPTY
// entity hash -- what it exports is not a declaration but whatever the expression
// DENOTES -- so the module exported nothing at all under `default`, and every call
// through a default import of it was unresolved.
//
// The control below is a NAMED export rather than `export default function foo()`,
// deliberately: the parser records a default-exported function's name as `default`
// rather than its declared name, so that spelling mismatches the compiler's label for
// a reason that has nothing to do with this case.
import { V } from "./index";

export default V.isLen;

export function isLenNamed(s: string): boolean { return s.length > 1; }
