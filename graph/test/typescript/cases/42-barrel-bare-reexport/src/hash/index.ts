// A BARREL. The name is IMPORTED and then exported bare, which is how a
// package-per-directory layout is written. `digest` is not declared here, so the
// rule that matches a bare `export { c }` against the module's own declarations
// cannot see it, and there is no sourceSpecifier for the re-export rule to follow.
import { digest } from "./impl";
export { digest };

// The control: the `export ... from` spelling of the same intent, which resolved
// before this case existed. If a change breaks the barrel and the control together
// the cause is elsewhere; only the barrel line should ever move.
export { digestFrom } from "./impl";
