// fixture: exports-map/consumer/consumer.js
// module system: ESM  (governing: staging/exports-map/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2020 (dynamic import)
//
// Reaches the package through its own maps. Four specifier shapes that all
// resolve through package.json rather than through the file system:
//
//   '#internal/log'            imports map, "default" condition
//   '#internal/log.dev.js'     imports map, wildcard pattern "#internal/*.js"
//   '../lib/index.js'          a relative path that DELIBERATELY bypasses the
//                              exports map — legal from inside the package, and
//                              it is how a package's own files reach each other
//   dynamic import of './'     resolved at runtime, not at parse time
//
// A specifier that starts with "#" and is NOT in the imports map is a hard
// resolution failure, not a fall-through to node_modules. That is the fifth
// case, and it is the one below marked unresolvable — which is also why this
// particular file does not run: the failure is deliberate and structural.

import { open as createLogger } from '#internal/log';
import { open as devOpen } from '#internal/log.dev.js';
import direct from '../lib/index.js';

// Not in the imports map. Node throws ERR_PACKAGE_IMPORT_NOT_DEFINED; there is
// no fallback lookup. resolutionOutcome = UNRESOLVED_MISSING, and the reason is
// structural rather than environmental — installing something cannot fix it.
import { missing } from '#internal/not-declared';

export async function main() {
  const stream = await import('@fixture/exports-map/stream');
  return { createLogger, devOpen, direct, missing, stream };
}
