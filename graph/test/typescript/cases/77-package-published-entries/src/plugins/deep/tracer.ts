// CONTROL: two segments below plugins/, which the one-segment `*` does not match, and
// imported (neither called nor published) by logger.ts, so it is not an unimported module either.
// tracer must stay unreachable.
export function tracer() {
  return 'trace';
}
