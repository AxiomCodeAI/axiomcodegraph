// fixture: exports-map/internal/log.js
// module system: ESM  (governing: staging/exports-map/package.json)
// nature: runtime-bearing
// syntax floor: ES2015
//
// The "default" condition of the "#internal/log" IMPORTS map. A "#"-prefixed
// specifier is private to the package: it is not importable from outside, it is
// not a relative path, and it is not a node_modules lookup. Node resolves it
// from the same package.json that governs the importing file, which makes it
// the one specifier form where the governing config is load-bearing for
// RESOLUTION and not only for module system.

export function open(name) {
  return {
    name,
    write(line) { process.stdout.write(name + ': ' + line + '\n'); }
  };
}
