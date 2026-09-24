package a;

// The header's Builder is a.Builder: a member type is in scope in the class body, not in
// its extends / implements clause (JLS 6.3). The nested Builder of the same name must not
// take its place.
public class DiffLike<T> implements Builder<String> {
    public static final class Builder<T> {
        public DiffLike<T> build() { return new DiffLike<>(); }
    }

    @Override
    public String build() { return "d"; }

    // Inside the body the nested type IS the one in scope.
    static DiffLike<String> make() { return new Builder<String>().build(); }
}
