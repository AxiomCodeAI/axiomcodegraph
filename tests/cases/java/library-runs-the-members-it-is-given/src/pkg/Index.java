package pkg;

import java.util.HashMap;
import java.util.Map;

public class Index {
    private final Map<Key, Integer> counts = new HashMap<>();

    public int put(String name) { return counts.merge(new Key(name), 1, Integer::sum); }
}
