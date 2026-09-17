// A named function EXPRESSION whose name matches the export is not the export's
// target (#793): the const holding the ternary is, so both operands survive.
export function fast(x) { return 'fast:' + x; }
const useFast = true;
export const compute = useFast ? fast : function compute(x) { return 'slow:' + x; };
export const other = useFast ? fast : function slowOther(x) { return 'slow:' + x; };
// The polyfill spelling, where the lost operand is the platform.
export const cbrt = Math.cbrt || function cbrt(x) { return x; };
// The controls: a function DECLARATION is still the export's target, and so is
// one exported through a separate clause.
export function plain(x) { return 'plain:' + x; }
function named(x) { return 'named:' + x; }
export { named };
