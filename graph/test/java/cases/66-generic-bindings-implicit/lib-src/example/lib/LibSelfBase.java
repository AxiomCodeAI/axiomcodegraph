package example.lib;

public abstract class LibSelfBase<S extends LibSelfBase<S>> {
    public final S withTimeout(long millis) {
        return null;
    }
}
