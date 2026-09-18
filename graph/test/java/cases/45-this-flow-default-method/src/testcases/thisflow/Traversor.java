package testcases.thisflow;

/** The single place the visitor's callbacks are invoked, on a PARAMETER receiver. */
final class Traversor {
  static void traverse(Visitor visitor, Node root) {
    visitor.head(root, 0);
    for (Node child : root.children) traverse(visitor, child);
    visitor.tail(root, 0);
  }
}
