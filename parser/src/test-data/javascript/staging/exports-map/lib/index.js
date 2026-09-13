// fixture: exports-map/lib/index.js
// module system: ESM  (governing: staging/exports-map/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The "import" condition target of the "." export. A consumer writing
// `import x from '@fixture/exports-map'` lands here; a consumer writing
// `require('@fixture/exports-map')` lands in index.cjs, which is a DIFFERENT
// file with a different module system exporting a compatible shape. One
// specifier, two resolutions, decided by the requesting context.
//
// This is the case where tsc and Node can legitimately disagree: tsc MODELS
// conditional resolution under moduleResolution node16/bundler, Node IS it.
// The schema puts that disagreement in the oracle, not in js_import.

import { open } from '#internal/log';

export function createLogger(name) {
  return open(name);
}

export const condition = 'import';

export default createLogger;
