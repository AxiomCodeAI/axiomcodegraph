package testcases.thisflow;

/** A tree node; the traversor walks it and hands every node to the visitor. */
class Node {
  final Node[] children;
  Node(Node... children) { this.children = children; }
  int size() { return children.length; }
}
