// HERITAGE THAT CROSSES THE STAGING BOUNDARY. A client type extending or implementing a
// LIBRARY type is the shape `type_ancestor` has to carry from one IR root to another, and
// on remeda that relation held 1,106 lib->lib rows against 4 client->lib. Four is either
// correct for that project or a hole; nothing in the suite could tell the difference.
//
// Every member below exists to be reached from a CLIENT subclass: one inherited and not
// overridden, one overridden (so `super` has somewhere to go), one two hops up, and one
// arriving through an interface rather than a class.
export class Base {
  describe(): string {
    return 'base';
  }
  inheritedOnly(): number {
    return 1;
  }
}

export class Middle extends Base {
  middleOnly(): string {
    return 'middle';
  }
}

export interface Sink {
  write(chunk: string): number;
}

export interface Closeable {
  close(): void;
}

// A library function taking the library interface, so a CLIENT implementation has to be
// reachable from a library-typed receiver — the fan in the other direction.
export declare function drain(s: Sink): number;
