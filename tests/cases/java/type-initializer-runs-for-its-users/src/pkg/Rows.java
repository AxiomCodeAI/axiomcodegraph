package pkg;

import java.util.Collections;
import java.util.Map;

public final class Rows {
    private Rows() { }

    // runs only from Table's static field initializer
    static Map<String, String> load() { return Collections.singletonMap("k", "v"); }
}
