import { api, makeStore, greeter, makeGreeter } from './api';

// same-file and imported: a method, an arrow property, a function-expression property
export function callNested() { api.users.list(); api.users.byName('x'); return api.users.get('1'); }
export function callTop() { api.ping(); api.find('2'); return api.remove('1'); }

// a factory's result, held in a const and called directly
export function callStore() {
  const s = makeStore(1);
  s.inc();
  makeStore(2).reset();
  return s;
}

// controls: annotated receivers keep their declared member
export function callGreeter() { greeter.greet('a'); return makeGreeter().greet('b'); }

// control: a literal with the same member names that is never called
const unrelated = { list() { return 1; }, inc() { return 2; } };
export function keepUnrelated() { return unrelated; }
