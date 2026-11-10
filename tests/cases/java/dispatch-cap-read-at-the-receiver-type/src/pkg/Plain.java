package pkg;

// many implementations: a call on a Lookup is too wide to fan
public final class Plain {
    public static final class L1 implements Lookup { public String lookup(String k) { return "1"; } }
    public static final class L2 implements Lookup { public String lookup(String k) { return "2"; } }
    public static final class L3 implements Lookup { public String lookup(String k) { return "3"; } }
    public static final class L4 implements Lookup { public String lookup(String k) { return "4"; } }
    public static final class L5 implements Lookup { public String lookup(String k) { return Mark.mark(k); } }
    public static final class L6 implements Lookup { public String lookup(String k) { return "6"; } }
    public static final class L7 implements Lookup { public String lookup(String k) { return "7"; } }
    public static final class L8 implements Lookup { public String lookup(String k) { return "8"; } }
    public static final class L9 implements Lookup { public String lookup(String k) { return "9"; } }
    public static final class L10 implements Lookup { public String lookup(String k) { return "10"; } }
    public static final class L11 implements Lookup { public String lookup(String k) { return "11"; } }
    public static final class L12 implements Lookup { public String lookup(String k) { return "12"; } }
    public static final class L13 implements Lookup { public String lookup(String k) { return "13"; } }
    public static final class L14 implements Lookup { public String lookup(String k) { return "14"; } }
    public static final class L15 implements Lookup { public String lookup(String k) { return "15"; } }
    public static final class L16 implements Lookup { public String lookup(String k) { return "16"; } }
    public static final class L17 implements Lookup { public String lookup(String k) { return "17"; } }
    public static final class L18 implements Lookup { public String lookup(String k) { return "18"; } }
    public static final class L19 implements Lookup { public String lookup(String k) { return "19"; } }
    public static final class L20 implements Lookup { public String lookup(String k) { return "20"; } }
    public static final class L21 implements Lookup { public String lookup(String k) { return "21"; } }
    public static final class L22 implements Lookup { public String lookup(String k) { return "22"; } }
    public static final class L23 implements Lookup { public String lookup(String k) { return "23"; } }
    public static final class L24 implements Lookup { public String lookup(String k) { return "24"; } }
}
