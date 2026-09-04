package torture;

// f10 — VALUE FLOW. Every way a receiver's type arrives somewhere other than its declaration:
// reassignment, a ternary, a switch expression, a cast, an array element, a field written twice,
// a parameter, and a return value fed straight into another call.

import java.util.ArrayList;
import java.util.List;

public class F10Flow {

    interface Engine { String run(); }
    static class Fast implements Engine { public String run() { return "fast"; } }
    static class Slow implements Engine { public String run() { return "slow"; } }

    private Engine field = new Fast();
    private final Engine[] pool = new Engine[]{ new Fast(), new Slow() };

    void rewrite() { field = new Slow(); }              // a SECOND write: the field is now either

    String viaField() { return field.run(); }
    String viaTernary(boolean b) { Engine e = b ? new Fast() : new Slow(); return e.run(); }
    String viaSwitchExpr(int k) {
        Engine e = switch (k) { case 0 -> new Fast(); default -> new Slow(); };
        return e.run();
    }
    String viaReassignment(boolean b) { Engine e = new Fast(); if (b) e = new Slow(); return e.run(); }
    String viaArrayElement(int i) { return pool[i].run(); }
    String viaCast(Object o) { return ((Engine) o).run(); }
    String viaParameter(Engine e) { return e.run(); }
    String viaReturnValue() { return make(true).run(); }
    String viaListElement() { List<Engine> xs = new ArrayList<>(); xs.add(new Fast()); return xs.get(0).run(); }
    String viaChainedReturn() { return make(true).run().trim(); }   // library call on a client return
    static Engine make(boolean fast) { return fast ? new Fast() : new Slow(); }
}
