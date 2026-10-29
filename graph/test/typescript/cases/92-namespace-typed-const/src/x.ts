// `ns.score(x)` reads the const off a namespace import. The named import of the same const
// resolved and the namespace read did not.
import * as scorers from "./scorers";
import { score } from "./scorers";
export function viaNamespace(s: string): number { return scorers.score(s); }
// controls: the named import, a const holding an arrow, and an exported function
export function viaNamed(s: string): number { return score(s); }
export function viaArrow(s: string): number { return scorers.scoreArrow(s); }
export function viaPlain(s: string): number { return scorers.plain(s); }
