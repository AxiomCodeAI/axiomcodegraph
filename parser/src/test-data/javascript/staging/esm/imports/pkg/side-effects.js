// fixture: esm/imports/pkg/side-effects.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2015
//
// No exports at all. Imported purely for what its top-level code does, which is
// the one import form that binds no name — bindingForm = SIDE_EFFECT_ONLY, and
// importedName and localName are both "". A parser that mints an import row
// only when a binding appears drops this edge entirely.

globalThis.__fixtureSideEffect = (globalThis.__fixtureSideEffect || 0) + 1;

console.log('side effect ran');
