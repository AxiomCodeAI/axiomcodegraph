package pkg;

public final class Holder {
    private Holder() { }

    // only calls an INSTANCE method of a Catalog it is handed: the type was initialized, and the instance built,
    // by whoever made it
    static String first(Catalog c) { return c.name(0); }
}
