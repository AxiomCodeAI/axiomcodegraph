// CONTROL: the project maps $lib itself, and its own paths win over any framework default
import { pick } from '$lib/util';

export function chosen() {
  return pick();
}
