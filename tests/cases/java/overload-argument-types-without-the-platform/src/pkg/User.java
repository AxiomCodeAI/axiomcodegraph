package pkg;

import java.io.StringReader;

// no JDK staged: every argument below is typed by the expression itself
public class User {
    void concat(Sink s, int n) { s.log("total " + n); }
    void literal(Sink s) { s.read(Node.class); }
    void creation(Sink s) { s.load(new StringReader("x")); }
    void caught(Sink s) { try { s.load("x"); } catch (RuntimeException e) { s.wrap(e); } }
    void classLit(Sink s) { s.kind(String.class); }
    void castChar(Sink s, int c) { s.add((char) c); }
    void nodeArg(Sink s, Node n) { s.take(n); }
    // control: a call's result is not read for its type, so both take overloads stay
    void callArg(Sink s, StringBuilder b) { s.take(b.toString()); }
}
