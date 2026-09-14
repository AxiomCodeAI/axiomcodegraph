// fixture: exports-map/lib/stream.browser.js
// module system: ESM  (governing: staging/exports-map/package.json)
// nature: runtime-bearing
// syntax floor: ES2018 (async generator)
//
// The "browser" and "default" condition target. No Node builtin is reachable
// from here, which is the whole reason the condition exists.

export async function* toStream(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export const target = 'browser';
