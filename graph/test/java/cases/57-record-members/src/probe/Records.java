package probe;

import dep.Point;

/** No compact constructor: the canonical one is synthesized, kind CONSTRUCTOR. */
record Plain(String id, Point origin) { }

/** A COMPACT constructor, kind COMPACT_CONSTRUCTOR, and the only candidate for `new`. */
record Compact(String id, Point origin) {
    Compact {
        if (id == null) {
            id = "";
        }
    }

    /** Hand written beside the accessors, so it is the control for SUBJECT C. */
    String label() {
        return id;
    }
}

/** The canonical constructor written out in full, kind CONSTRUCTOR. */
record Explicit(String id, Point origin) {
    Explicit(String id, Point origin) {
        this.id = id;
        this.origin = origin;
    }
}

public class Records {

    /** SUBJECT A: construction through a COMPACT constructor. */
    public Object viaCompact(Point p) {
        return new Compact("a", p);
    }

    /** CONTROLS for A: the two spellings that already resolved. */
    public Object viaOthers(Point p) {
        Object a = new Plain("a", p);
        return new Explicit("b", p);
    }

    /** SUBJECT B: a call chained onto a record accessor's result. */
    public int chained(Plain o) {
        return o.origin().x();
    }

    /**
     * SUBJECT C, the DISCRIMINATING one: a HAND-WRITTEN method on the result of a
     * record accessor. It failed for the same reason B did, which proves the missing
     * piece is the accessor's RETURN TYPE and not the callee.
     */
    public String chainedHandWritten(Plain o) {
        return o.origin().describe();
    }

    /** CONTROL for B and C: a declared intermediate always resolved. */
    public int viaLocal(Plain o) {
        Point p = o.origin();
        return p.x();
    }

    /** CONTROL: the accessor itself, and a hand-written record member. */
    public String direct(Compact c) {
        return c.id() + c.label();
    }
}
