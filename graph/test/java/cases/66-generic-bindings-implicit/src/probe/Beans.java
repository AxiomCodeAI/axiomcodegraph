package probe;

public final class Beans {
    public static <T> T get(Class<T> type) {
        return null;
    }

    public static <T> T named(String name, Class<T> type) {
        return null;
    }

    /** NEAR MISS: a Class parameter that is not Class<T> binds nothing. */
    public static Object raw(Class<?> type) {
        return null;
    }
}
