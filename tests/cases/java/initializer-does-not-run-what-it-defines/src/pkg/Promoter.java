package pkg;

public final class Promoter {
    private Promoter() { }

    static String promote(String s) { return Reader.ACCESS.promote(s); }
}
