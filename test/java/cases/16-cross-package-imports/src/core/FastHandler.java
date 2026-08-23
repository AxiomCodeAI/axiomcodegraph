package core;

public class FastHandler implements Handler {
    @Override public String handle(String s) { return mark(s); }
    private static String mark(String s) { return "fast:" + s; }
}
