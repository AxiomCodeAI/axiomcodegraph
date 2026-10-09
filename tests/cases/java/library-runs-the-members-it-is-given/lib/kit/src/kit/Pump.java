package kit;

public final class Pump {
    private Pump() { }

    // the library calls the client's override: no call to it is written in the client
    public static String drain(Source s) { return s.next(); }
}
