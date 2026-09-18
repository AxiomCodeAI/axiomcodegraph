package testcases.thisflow;

public class Driver {
  public static void main(String[] args) {
    Node root = new Node(new Node(), new Node(new Node()));
    // passed to the parameter DIRECTLY: these flow in as argument types
    Traversor.traverse(new V1(), root);
    Traversor.traverse(new V2(), root);
    Traversor.traverse(new V3(), root);
    Traversor.traverse(new V4(), root);
    Traversor.traverse(new V5(), root);
    Traversor.traverse(new V6(), root);
    Traversor.traverse(new V7(), root);
    Traversor.traverse(new V8(), root);
    Traversor.traverse(new V9(), root);
    Traversor.traverse(new V10(), root);
    // arriving as `this` through the interface default method: the receiver of traverse()
    new V11().traverse(root);
    new V12().traverse(root);
    new V13().traverse(root);
    new V14().traverse(root);
    new V15().traverse(root);
    new V16().traverse(root);
    new V17().traverse(root);
    new V18().traverse(root);
    new V19().traverse(root);
    new V20().traverse(root);
    // through a receiverless call chain: go() -> traverse() -> Traversor.traverse(this, ..)
    new V23().go(root);
    // never instantiated and never handed to the traversor: V21 and V22 keep zero callers
  }
}
