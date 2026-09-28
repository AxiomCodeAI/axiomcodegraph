// Published by the "./plugins/*" subpath pattern: `*` = logger.
import { tracer } from './deep/tracer';

export const traced = tracer;

export function logger(message: string) {
  return format(message);
}

function format(message: string) {
  return `[log] ${message}`;
}
