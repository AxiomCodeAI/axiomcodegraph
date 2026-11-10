package pkg;

import java.lang.reflect.Type;

public class Tok<T> {
    public static Tok<?> get(Type t) { return null; }
    public static <T> Tok<T> get(Class<T> c) { return null; }
}
