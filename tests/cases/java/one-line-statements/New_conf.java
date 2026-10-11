package a;

import java.util.List;
import java.util.Map;

public class Conf {
    static final Map<String, Integer> SETTINGS = Map.of(
        "retries", 4,
        "timeout", 10);
    static final int LIMIT = 1;

    int get() {
        return SETTINGS.get("retries") + LIMIT;
    }
}
