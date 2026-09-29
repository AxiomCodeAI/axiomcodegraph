// A call through an object-literal table whose key is computed at run time, with NO
// default beside it. The engine cannot know which entry the key selects, but it does
// know the table: the call reaches one of its function values. Before, the site was a
// dead end (dynamic_terminal / ambiguous_unknown) and removeItem had no caller at all.
import { handlers, cli } from './handlers.js';

// THE CONSTRUCT, form 1: the read assigned to a const, then called (a Redux-style reducer).
export function reducer(state, action) {
  const h = handlers[action.type];
  return h ? h(state, action.payload) : state;
}

// THE CONSTRUCT, form 2: the read called directly.
export function dispatch(state, type, p) {
  return handlers[type](state, p);
}

// THE CONSTRUCT, form 3: a nested table reached through a property chain (CLI dispatch).
export function main(argv) {
  return cli.commands[argv[0]](argv);
}

// CONTROL 1: a dotted read names the exact entry and must stay a single known edge.
export function add(state, p) { return handlers.ADD(state, p); }

// CONTROL 2: a literal key names the exact entry too.
export function remove(state, p) { return handlers['REMOVE'](state, p); }

// CONTROL 3: a key held in a const the value layer reads keeps its own answer; the
// open-read rule only speaks where nothing else found a target.
const KEY = 'ADD';
export function addByConst(state, p) { return handlers[KEY](state, p); }

// CONTROL 4: a computed read on a class instance is not an object literal; it stays
// the declared dynamic_terminal it was.
class Router {
  get(x) { return x; }
  post(x) { return x; }
  route(verb, x) { return this[verb](x); }
}
export const router = new Router();

// CONTROL 5: an array read with a computed index is excluded by kind.
const steps = [addItem2, removeItem2];
function addItem2(s) { return s; }
function removeItem2(s) { return s; }
export function step(i, s) { return steps[i](s); }
