package probe;

public final class ClassKeys {
    public static final String PREFIX = "app.const";

    // not final: its value at runtime is whatever last assigned it, so it resolves to nothing
    public static String MUTABLE_PREFIX = "app.const";

    private ClassKeys() {
    }
}
