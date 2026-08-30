// The barrel. Every consumer below reaches the overload sets through THIS file, so a
// call has to travel import -> re-export -> declaration before the overload set is
// even visible.
export { scale, pad } from '@fixture/math';
export { area } from '@fixture/shapes';
export type { Circle, Square } from '@fixture/shapes';
export { Registry } from '@fixture/registry';
export { format, Box } from '@fixture/callable';
export type { Formatter, BoxConstructor } from '@fixture/callable';
