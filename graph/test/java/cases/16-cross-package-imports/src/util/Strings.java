package util;

public class Strings {
    public static String trim(String s)  { return s.trim(); }
    public static String pad(String s)   { return " " + s + " "; }
    public static String shout(String s) { return same(s) + "!"; }
    private static String same(String s) { return s; }
    // resolves to util.Config (same package, no import) — the other half of the collision test
    public static String which() { return Config.load(); }
}
