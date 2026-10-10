package probe;

public interface Store {
    void put(String key);

    Store child(String name);
}
