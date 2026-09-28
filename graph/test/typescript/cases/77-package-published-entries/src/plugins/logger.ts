// Published by the "./plugins/*" subpath pattern: `*` = logger.
import { tracer } from './deep/tracer';

// Reads tracer without publishing it: a published const bound to `tracer` itself would
// hand the function to a consumer, which is a root (79-package-published-members).
export const tracerName = tracer.name;

export function logger(message: string) {
  return format(message);
}

function format(message: string) {
  return `[log] ${message}`;
}
