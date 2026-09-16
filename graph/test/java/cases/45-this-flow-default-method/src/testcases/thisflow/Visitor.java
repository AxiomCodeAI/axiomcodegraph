package testcases.thisflow;

/**
 * The visitor contract, with a default method that re-enters the traversor passing `this`.
 * Its fan (22 implementors, Visitors.java) is wider than the default --dispatch-cap of 20, so
 * `v.head(..)` / `v.tail(..)` inside Traversor are fan_capped: the CHA fan is refused and only
 * the types that FLOW into the parameter resolve. An implementor that reaches the parameter as
 * `this` through this default method must be one of them (#702).
 */
interface Visitor {
  void head(Node node, int depth);
  void tail(Node node, int depth);
  /** the shape under test: `this` inside an interface default method, passed as an argument */
  default void traverse(Node root) { Traversor.traverse(this, root); }
}

/** An abstract implementor whose helper calls the default method WITHOUT a receiver. */
abstract class AbstractVisitor implements Visitor {
  void go(Node root) { traverse(root); }   // receiverless: the receiver is `this`
}
