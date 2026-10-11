package pkg;

import java.util.Map;

public final class Registry {
    // the static initializer runs on the first use of Registry, so a throw in build() fails every user
    static final Map<String, String> TABLE = Defaults.build();

    private Registry() { }

    public static String find(String key) { return TABLE.get(key); }
}
