// A THREE-HOP RE-EXPORT CHAIN THAT RENAMES AT EVERY HOP. The name the client writes
// (`topFn`) and the name the declaration carries (`leafFn`) have nothing in common, and
// the two intermediate names exist only inside the package. Resolving this needs the
// alias walked to a fixpoint, not one step.
export { deepFn as topFn } from './chain-mid';
export { Relay as TopRelay } from './chain-mid';
