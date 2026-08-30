// The receiver FORMS. Each of these is a different expression shape reaching the
// same member, and each is a separate way for resolution to fail.

export class Node {
  visit(): string {
    return "v";
  }
  next?: Node;
}

export class Holder {
  readonly node = new Node();
  readonly list: Node[] = [];
  readonly map: Record<string, Node> = {};
  make(): Node {
    return new Node();
  }
}

export function drive(h: Holder, maybe: Node | undefined): string {
  const parts: string[] = [];
  parts.push(h.node.visit());          // property access
  parts.push(h.make().visit());        // call return as receiver
  parts.push(h.list[0]!.visit());      // element access, numeric index
  parts.push(h.map["k"]!.visit());     // element access, string index
  parts.push(maybe?.visit() ?? "");    // optional chaining
  parts.push(maybe!.visit());          // non-null assertion
  parts.push((h.node as Node).visit()); // type assertion
  parts.push(new Node().visit());       // freshly constructed receiver
  return parts.join("");
}

// ── client -> library ────────────────────────────────────────────────────────
import { Graph, Vertex } from "../lib/graph";

export function useLibrary(g: Graph, maybe: Vertex | undefined): string {
  // The same receiver forms, every one of them crossing into the library IR.
  return g.root.touch()
    + g.find().touch()
    + g.all[0]!.touch()
    + (maybe?.touch() ?? "")
    + new Vertex().touch();
}
