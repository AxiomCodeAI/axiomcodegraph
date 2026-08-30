// An ABSTRACT base with a concrete override, and a `super` call. `super.describe()` is
// non-virtual: it names exactly one body, and a fan that sends it back to the override
// invents a self-recursion the program does not have.
export abstract class Node {
  abstract describe(): string;

  label(): string {
    return `<${this.describe()}>`;
  }
}

export class LeafNode extends Node {
  describe(): string {
    return 'leaf';
  }
}

export class TaggedLeaf extends LeafNode {
  describe(): string {
    return `tagged:${super.describe()}`;
  }
}
