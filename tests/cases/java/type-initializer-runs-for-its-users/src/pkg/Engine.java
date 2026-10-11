package pkg;

public final class Engine {
    static {
        Boot.init();
    }

    public static int run() { return Boot.ready; }
}
