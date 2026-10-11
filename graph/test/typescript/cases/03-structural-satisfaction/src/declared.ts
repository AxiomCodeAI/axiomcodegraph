// Brings Pub in through a package specifier the engine cannot follow to pub.ts (a
// workspace package whose build output is absent), so the import walk never reaches Pub's
// module. The import still names Pub, and that is the evidence: Declared stays a Pub
// candidate.
// @ts-expect-error the package is not installed in this case
import type { Pub } from "@workspace/pub";

export class Declared implements Pub {
  publish(e: { id: string }): void {}
}

export const declared = new Declared();
