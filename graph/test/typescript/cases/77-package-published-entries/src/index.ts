// The package's "." entry: main, types and every exports condition name its build
// output. index.test.ts imports it, so it is NOT an unimported module.
import { createCastStore, createStore } from './vanilla';
import { describeState } from './internal';

export { createStore } from './vanilla';

export function useStore(initial: number) {
  const store = createStore(initial);
  createCastStore(initial);
  return describeState(store.value);
}
