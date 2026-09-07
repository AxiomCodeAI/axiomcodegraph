package fn;

/** A library functional interface with a two-parameter SAM. */
public interface BiFn<T, U, R> {
    R apply(T t, U u);
}
