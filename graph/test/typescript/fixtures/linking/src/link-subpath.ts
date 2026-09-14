// SUBPATH EXPORTS. `@tt/subpath` has no `main` and no `types`: an "exports" map is the
// only thing that maps either specifier to a file, and `@tt/subpath/deep` names a path
// segment that does not exist on disk.
import { rootEntry } from '@tt/subpath';
import { deepEntry, DeepWorker } from '@tt/subpath/deep';

// Types with no runtime declaration file of their own, from a package that ships only a
// .js file. The declaration is in @types/plainjs, which this client never names.
import { shout, Megaphone } from 'plainjs';

export function callRoot(input: string): string {
  return rootEntry(input);                 // -> subpath-root.d.ts  rootEntry
}

export function callDeep(input: string): string {
  return deepEntry(input);                 // -> subpath-deep.d.ts  deepEntry
}

export function spinDeep(n: number): number {
  return new DeepWorker().spin(n);         // -> subpath-deep.d.ts  DeepWorker.spin
}

export function callShout(input: string): string {
  return shout(input);                     // -> plain-types.d.ts  shout  (@types package)
}

export function amplify(input: string): string {
  return new Megaphone().amplify(input, 3); // -> plain-types.d.ts  Megaphone.amplify
}
