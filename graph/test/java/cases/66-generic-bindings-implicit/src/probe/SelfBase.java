package probe;

public abstract class SelfBase<S extends SelfBase<S>> {
    public final S withTimeout(long millis) {
        return null;
    }
}
