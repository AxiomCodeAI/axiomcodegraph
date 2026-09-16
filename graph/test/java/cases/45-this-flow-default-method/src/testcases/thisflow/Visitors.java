package testcases.thisflow;

/** 22 implementors: over the cap of 20, so the fan at Traversor is refused. Bodies are distinct so nothing is folded. */
class V1 implements Visitor { int n; public void head(Node node, int depth) { n += 1; } public void tail(Node node, int depth) { n -= 1; } }
class V2 implements Visitor { int n; public void head(Node node, int depth) { n += 2; } public void tail(Node node, int depth) { n -= 2; } }
class V3 implements Visitor { int n; public void head(Node node, int depth) { n += 3; } public void tail(Node node, int depth) { n -= 3; } }
class V4 implements Visitor { int n; public void head(Node node, int depth) { n += 4; } public void tail(Node node, int depth) { n -= 4; } }
class V5 implements Visitor { int n; public void head(Node node, int depth) { n += 5; } public void tail(Node node, int depth) { n -= 5; } }
class V6 implements Visitor { int n; public void head(Node node, int depth) { n += 6; } public void tail(Node node, int depth) { n -= 6; } }
class V7 implements Visitor { int n; public void head(Node node, int depth) { n += 7; } public void tail(Node node, int depth) { n -= 7; } }
class V8 implements Visitor { int n; public void head(Node node, int depth) { n += 8; } public void tail(Node node, int depth) { n -= 8; } }
class V9 implements Visitor { int n; public void head(Node node, int depth) { n += 9; } public void tail(Node node, int depth) { n -= 9; } }
class V10 implements Visitor { int n; public void head(Node node, int depth) { n += 10; } public void tail(Node node, int depth) { n -= 10; } }
class V11 implements Visitor { int n; public void head(Node node, int depth) { n += 11; } public void tail(Node node, int depth) { n -= 11; } }
class V12 implements Visitor { int n; public void head(Node node, int depth) { n += 12; } public void tail(Node node, int depth) { n -= 12; } }
class V13 implements Visitor { int n; public void head(Node node, int depth) { n += 13; } public void tail(Node node, int depth) { n -= 13; } }
class V14 implements Visitor { int n; public void head(Node node, int depth) { n += 14; } public void tail(Node node, int depth) { n -= 14; } }
class V15 implements Visitor { int n; public void head(Node node, int depth) { n += 15; } public void tail(Node node, int depth) { n -= 15; } }
class V16 implements Visitor { int n; public void head(Node node, int depth) { n += 16; } public void tail(Node node, int depth) { n -= 16; } }
class V17 implements Visitor { int n; public void head(Node node, int depth) { n += 17; } public void tail(Node node, int depth) { n -= 17; } }
class V18 implements Visitor { int n; public void head(Node node, int depth) { n += 18; } public void tail(Node node, int depth) { n -= 18; } }
class V19 implements Visitor { int n; public void head(Node node, int depth) { n += 19; } public void tail(Node node, int depth) { n -= 19; } }
class V20 implements Visitor { int n; public void head(Node node, int depth) { n += 20; } public void tail(Node node, int depth) { n -= 20; } }
class V21 implements Visitor { int n; public void head(Node node, int depth) { n += 21; } public void tail(Node node, int depth) { n -= 21; } }
class V22 implements Visitor { int n; public void head(Node node, int depth) { n += 22; } public void tail(Node node, int depth) { n -= 22; } }

/** An implementor of the abstract class, reached through the receiverless helper. */
class V23 extends AbstractVisitor { int n; public void head(Node node, int depth) { n += 23; } public void tail(Node node, int depth) { n -= 23; } }
