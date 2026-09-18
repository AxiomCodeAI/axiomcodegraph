package probe;

public class Item {
    private final String key;
    public Item(String key) { this.key = key; }

    // Two overloads of one name with different return types: the chained
    // receiver must be typed from the overload the arity selects.
    public String name() { return key; }
    public Item name(String ignored) { return this; }

    public Item self() { return this; }

    @Override public boolean equals(Object o) { return o instanceof Item && ((Item) o).key.equals(key); }
}
