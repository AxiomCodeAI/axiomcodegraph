package pkg;

public class Scanner {
    public String scan(/* edited */ String root, int depth) { // note
        return root + depth;
    }

    public String resolve(String name, boolean strict) {
        return name;
    }

    public static void main(String[] args) {
        Scanner s = new Scanner();
        s.scan(".", 1);
        s.resolve("x");
    }
}
