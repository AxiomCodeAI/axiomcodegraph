package probe;

/**
 * A provider named in META-INF/services is instantiated by the platform, which then calls
 * the service interface's methods on it. Neither is visible in the source: nothing writes
 * `new UpperCodec()` and nothing calls `encode` on it, so without reading the descriptor a
 * provider is a DEAD ROOT — no constructor edge in, no method reachable.
 *
 * `Unregistered` is the control: same shape, same interface, NOT named in any descriptor,
 * so it must NOT become an entry point.
 */
public class Plugins {

    public interface Codec {
        String encode(String s);
    }

    public static class UpperCodec implements Codec {
        public UpperCodec() { }
        @Override public String encode(String s) { return helper(s); }
        private String helper(String s) { return s.toUpperCase(); }
    }

    public static class ReverseCodec implements Codec {
        @Override public String encode(String s) { return s; }
    }

    /** never registered — reachable only if something in source uses it */
    public static class Unregistered implements Codec {
        @Override public String encode(String s) { return s; }
    }
}
