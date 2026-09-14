// Namespaces, nested namespaces, and `export =`. A namespace member is reached
// THROUGH its namespace and must not leak into module scope.

namespace outer {
  export function pack(): string {
    return "outer";
  }
  export namespace inner {
    export function deepPack(): string {
      return "inner";
    }
    export class Node {
      visit(): string {
        return "v";
      }
    }
  }
}

export = outer;
