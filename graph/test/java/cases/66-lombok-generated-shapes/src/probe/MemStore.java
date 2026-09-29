package probe;

public class MemStore implements Store {
    public void put(String key) {
    }

    public Store child(String name) {
        return this;
    }
}
