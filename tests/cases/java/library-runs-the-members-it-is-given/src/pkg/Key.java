package pkg;

public final class Key {
    private final String name;

    Key(String name) { this.name = name; }

    // run by the HashMap the key is put into: no call is written on a Key receiver
    @Override
    public int hashCode() { return name.hashCode(); }

    @Override
    public boolean equals(Object o) { return o instanceof Key && ((Key) o).name.equals(name); }
}
