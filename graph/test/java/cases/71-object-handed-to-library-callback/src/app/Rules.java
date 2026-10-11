package app;

class Rules {
    static boolean valid(String s) { return !s.isEmpty(); }
    static boolean known(String s) { return s.length() > 1; }
    static int shorter(String a, String b) { return a.length() - b.length(); }
    static int helper(String a) { return a.length(); }
    static String shown(String a) { return a; }
    static boolean local(String a) { return a.isEmpty(); }
    static String loud(String a) { return a.toUpperCase(); }
    static String soft(String a) { return a.toLowerCase(); }
}
