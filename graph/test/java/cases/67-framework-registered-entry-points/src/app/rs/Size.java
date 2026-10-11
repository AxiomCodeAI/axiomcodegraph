package app.rs;

public class Size {
    final int n;
    Size(int n) { this.n = n; }
    public static Size valueOf(String s) { return new Size(Integer.parseInt(s)); }
}
