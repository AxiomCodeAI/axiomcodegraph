package pkg;

import java.util.HashMap;
import java.util.Map;

public final class Defaults {
    private Defaults() { }

    // runs only from Registry's static field initializer: no method calls it
    static Map<String, String> build() {
        Map<String, String> m = new HashMap<>();
        m.put("a", "1");
        return m;
    }
}
