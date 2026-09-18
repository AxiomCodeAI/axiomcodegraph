package probe;

import dep.Point;

public class Uses {
    /** SUBJECT: the name the processor actually declares. */
    public Double prefixed(Point p) {
        p.setDepth(1.0);
        return p.getDepth();
    }

    /** CONTROL: a field whose next character is lowercase keeps the prefix. */
    public String notStripped(Point p) {
        return p.getMode();
    }

    /** CONTROL: an unprefixed field is unaffected. */
    public int plain(Point p) {
        return p.getSize();
    }
}
