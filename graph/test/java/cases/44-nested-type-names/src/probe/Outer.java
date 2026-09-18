package probe;

/**
 * Nested types of every placement, each registered by its full chain (probe.Outer.Inner,
 * probe.Outer.Inner.Deep, probe.Outer.Mode, probe.Outer.Builder). A second Builder lives in
 * Other, so a name that used to flatten to probe.Builder twice now names one type each.
 */
public class Outer {

    public static class Inner {
        String tag() { return "inner"; }

        /** Reached through its outer as a qualifier: Outer.Inner.build(). */
        static Inner build() { return new Inner(); }

        public static class Deep {
            String deep() { return "deep"; }
        }
    }

    public enum Mode {
        FAST, SLOW;
        String label() { return name().toLowerCase(); }
    }

    public static class Builder {
        static Builder create() { return new Builder(); }
        Outer build() { return new Outer(); }
    }
}
