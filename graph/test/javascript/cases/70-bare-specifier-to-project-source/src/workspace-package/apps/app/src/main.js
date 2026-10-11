import { f, Bus } from '@ws/lib';
import { g } from '@ws/lib/sub';
import { deep } from 'ws-tools/deep';
// Control: a package this repository does not declare stays unresolved.
import { outside } from 'not-in-this-repo';

export function run() {
  f();
  g();
  deep();
  new Bus().publish('k');
  return outside();
}
