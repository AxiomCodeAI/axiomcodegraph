// an alias import through jsconfig paths: resolved to lib/check.js
import { checkA } from '@/check';
// the relative spelling of the same module: unchanged by the mapping
import { checkB } from './lib/check.js';

export function probeA(request) {
  return checkA(request.token);
}

export function probeB(request) {
  return checkB(request.token);
}
