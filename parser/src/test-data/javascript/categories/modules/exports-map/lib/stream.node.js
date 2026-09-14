// fixture: exports-map/lib/stream.node.js
// module system: ESM  (governing: staging/exports-map/package.json)
// nature: runtime-bearing
// syntax floor: ES2015
//
// The "./stream" subpath under the nested "node" + "import" conditions. Reached
// only by an import from a Node runtime; a bundler targeting the browser
// resolves the same specifier to stream.browser.js and never sees this file.

import { Readable } from 'node:stream';

export function toStream(chunks) {
  return Readable.from(chunks);
}

export const target = 'node-esm';
