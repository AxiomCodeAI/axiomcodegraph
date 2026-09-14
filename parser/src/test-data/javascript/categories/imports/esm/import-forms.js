// fixture: esm/imports/import-forms.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2020 (dynamic import); ES2015 for everything else
//
// Every declaration-borne import form. These are the 16.4% of module edges the
// schema calls DECLARATION-borne, and they are the half that ports cleanly from
// TypeScript. edgeBearer = DECLARATION, isTopLevel = true, sourceExpressionLinkHash = ""
// for all of them EXCEPT the dynamic imports at the bottom, which are
// expression-borne even in an ES module.
//
// Grounded in pure-ESM library source.

import greet from './pkg/util.js';
import { normalize, Formatter } from './pkg/util.js';
import { normalize as clean, DEFAULT_LOCALE as LOCALE } from './pkg/util.js';
import defaultAndNamed, { counter } from './pkg/util.js';
import * as util from './pkg/util.js';
import './pkg/side-effects.js';

// Builtins, both spellings. 'node:fs' and 'fs' resolve to the same module and
// are different specifiers as written — specifier is recorded AS WRITTEN.
import { readFile } from 'node:fs/promises';
import process from 'process';

// A bare package specifier that is not installed in this checkout.
import ansiPaint from 'ansi-paint';

// A directory specifier resolved through the barrel's index.js. ESM does NOT do
// directory-index resolution the way CommonJS does, so this one needs the
// explicit file name — which is itself a difference between the two systems
// that the same-looking specifier hides.
import { clean as barrelClean } from './pkg/index.js';

// Dynamic import: expression-borne, and a call site as well as a module edge.
// callKind = DYNAMIC_IMPORT_CALL. Kept inside a function so this file's syntax
// floor stays at ES2020; top-level await has its own fixture and its own floor.
export async function lazyLoad() {
  const lazy = await import('./pkg/util.js');
  const { Formatter: LazyFormatter } = await import('./pkg/util.js');
  return { lazy, LazyFormatter };
}

// Dynamic import with a non-literal specifier — unresolvable by construction,
// exactly as require(variable) is.
async function loadLocale(name) {
  return import(`./locales/${name}.js`);
}

// Dynamic import inside a conditional, not at top level.
async function maybeLoad(flag) {
  if (flag) {
    return import('./pkg/side-effects.js');
  }
  return null;
}

// Dynamic import used as a value without awaiting: a Promise, not a module.
const pending = import('./pkg/index.js');

export {
  greet, normalize, Formatter, clean, LOCALE, defaultAndNamed, counter,
  util, readFile, process, ansiPaint, barrelClean,
  loadLocale, maybeLoad, pending
};
