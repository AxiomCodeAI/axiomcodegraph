package pkg;

import java.util.Collections;
import java.util.Map;

public final class Seeds {
    private Seeds() { }

    static Map<String, String> load() { return Collections.singletonMap("k", "v"); }
}
