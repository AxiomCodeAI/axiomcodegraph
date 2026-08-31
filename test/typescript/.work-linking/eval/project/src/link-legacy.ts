// `export =` AND `import = require` — the pre-ESM shape, and still most of DefinitelyTyped.
//
// The library's entire export is one NAMESPACE symbol. There is no export specifier to
// follow: every member is reached by walking INTO the namespace, and the nested one is
// two walks deep.
import legacy = require('@tt/legacy');

// The same module reached the other way, as a namespace import. Both forms must land on
// the SAME declarations — if they disagree, the disagreement is in the interop rule and
// nowhere else.
import * as legacyStar from '@tt/legacy';

export function packOnce(input: string): string {
  return legacy.pack(input);               // -> legacy-pack.d.ts  pack
}

export function packViaStar(input: string): string {
  return legacyStar.pack(input);           // -> the SAME declaration as above
}

export function bundleUp(items: readonly string[]): number {
  const bundle = new legacy.Bundle();      // -> legacy-pack.d.ts  Bundle (ctor)
  for (const item of items) bundle.add(item);  // -> Bundle.add
  return bundle.count();                   // -> Bundle.count
}

// A NESTED namespace: two containment hops from the module's export.
export function packDeep(input: string): string {
  return legacy.nested.deepPack(input);    // -> legacy-pack.d.ts  nested.deepPack
}
