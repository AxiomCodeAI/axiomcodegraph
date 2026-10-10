package pkg;

import java.util.List;
import java.util.Map;

public final class Catalog {
    // static initializer: runs when Catalog is initialized (new, a static method, a static field)
    static final Map<String, String> ROWS = Seeds.load();

    // instance initializer: runs inside every constructor of Catalog
    private final List<String> names = Names.fresh();

    public Catalog() { }

    public static Catalog open() { return new Catalog(); }

    public static String row(String key) { return ROWS.get(key); }

    public String name(int i) { return names.get(i); }
}
