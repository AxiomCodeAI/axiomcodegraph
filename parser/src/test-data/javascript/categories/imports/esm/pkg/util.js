// fixture: esm/imports/pkg/util.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Named exports of every declaration kind, plus a default. The target of most
// of import-forms.js.

export function normalize(text) {
  return String(text).trim();
}

export async function fetchJson(url) {
  const res = await globalThis.fetch(url);
  return res.json();
}

export function* counter(from) {
  let i = from;
  while (true) { yield i++; }
}

export class Formatter {
  constructor(locale) { this.locale = locale; }
  format(value) { return String(value); }
}

export const DEFAULT_LOCALE = 'en-US';
export let mutableCounter = 0;
export var legacyFlag = false;

const internalOnly = 'not exported';

function shorthandTarget() { return internalOnly; }

// Export list, separate from the declarations — the two spellings bind the same
// names and are different syntax.
export { shorthandTarget, shorthandTarget as aliasedTarget };

export default function greet(name) {
  return 'hello ' + name;
}
