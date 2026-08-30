// Every call here crosses the boundary through HERITAGE rather than through an import of
// the member itself. The member is never named in this file's imports.
import { Base, Middle, Sink, Closeable, drain } from "../lib/base";

export class ClientChild extends Base {
  // Overrides a library member, so `super.describe()` must reach the LIBRARY declaration
  // and must not fan back to this override.
  describe(): string {
    return `client:${super.describe()}`;
  }
}

export class TwoHops extends Middle {
  // Nothing declared here. `inheritedOnly` is two classes up, in the library.
  label(): string {
    return this.describe();
  }
}

export class ClientSink implements Sink, Closeable {
  write(chunk: string): number {
    return chunk.length;
  }
  close(): void {}
}

// (1) an inherited library member on a client receiver, never overridden
export function callInherited(c: ClientChild): number {
  return c.inheritedOnly();
}

// (2) the overridden member — the client's, not the library's
export function callOverridden(c: ClientChild): string {
  return c.describe();
}

// (3) two hops up, through a library intermediate
export function callTwoHops(t: TwoHops): number {
  return t.inheritedOnly();
}

// (4) a member declared on the library INTERMEDIATE, not the base
export function callMiddle(t: TwoHops): string {
  return t.middleOnly();
}

// (5) a client implementation reached from a LIBRARY-typed parameter
export function viaLibraryInterface(s: Sink): number {
  return s.write('x');
}

// (6) the client class handed to a library function that takes the interface
export function handOff(): number {
  return drain(new ClientSink());
}
