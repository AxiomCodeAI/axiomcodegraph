package dep;

import java.util.HashMap;
import java.util.Map;

/** A library generic whose type argument the client supplies — the substitution the engine has to
 *  carry through a return type it did not declare. */
public class Registry<T> {
    private final Map<String, T> byName = new HashMap<>();
    public void put(String k, T v) { byName.put(k, v); }
    public T get(String k) { return byName.get(k); }
}
