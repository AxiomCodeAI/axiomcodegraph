// fixture: exports-map/internal/log.dev.js
// module system: ESM  (governing: staging/exports-map/package.json)
// nature: runtime-bearing
// syntax floor: ES2015
//
// The "development" condition of "#internal/log". Selected only when Node is
// run with --conditions=development, so under a default resolution this file is
// unreachable — and a resolver that reports the "default" target as THE answer
// is reporting one of two correct answers.

export function open(name) {
  return {
    name,
    write(line) { console.debug('[dev] %s: %s', name, line); }
  };
}
