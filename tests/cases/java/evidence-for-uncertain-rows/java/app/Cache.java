package app;

import java.util.function.Function;

public class Cache {
    private final Function<String, String> loader;
    private final Store store = new Store();

    public Cache(Function<String, String> loader) {
        this.loader = loader;
    }

    public String read(String id) {
        return store.lookup(id);
    }

    public String load(String id) {
        return loader.apply(id);
    }
}
