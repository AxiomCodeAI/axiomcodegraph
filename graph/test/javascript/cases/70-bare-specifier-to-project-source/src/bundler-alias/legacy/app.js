import { boot } from 'Lib';
import { trim } from 'Util/trim';
// CONTROL: 'Lib$' is exact, and 'Loose' has no fixed directory: both stay unresolved
import { extra } from 'Lib/extra';
import { extra as loose } from 'Loose/extra';

export function start(s) {
  boot();
  extra();
  loose();
  return trim(s);
}
