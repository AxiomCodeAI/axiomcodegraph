// STAR RE-EXPORT. `export *` names nothing, so the set of exports of this module is
// not readable from this file: it is the union of two other modules' exports, computed.
// A module graph that only follows named specifiers sees an EMPTY package here — which
// is how a real barrel-shaped package (vitest, remeda, lodash-es) disappears.
export * from './barrel-inner-a';
export * from './barrel-inner-b';

// `export * as ns` — the whole of a third module, reachable only under a name that
// exists in neither module.
export * as tools from './barrel-inner-c';
