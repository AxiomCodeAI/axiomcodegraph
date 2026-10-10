package pkg;

public class Formatter {
    // a local of a platform type built with `new`: its calls are the platform's, never a client toString
    String render(String s) {
        final StringBuilder sb = new StringBuilder();
        sb.append(s);
        return sb.toString();
    }

    // a static call on a platform type: never a client max
    int widest(int a, int b) { return Math.max(a, b); }
}
