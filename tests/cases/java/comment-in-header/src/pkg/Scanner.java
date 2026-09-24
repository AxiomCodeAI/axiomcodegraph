package pkg;

public class Scanner {
    public String scan(String root, int depth) {
        return root + depth;
    }

    public String resolve(String name) {
        return name;
    }

    public static void main(String[] args) {
        Scanner s = new Scanner();
        s.scan(".", 1);
        s.resolve("x");
    }
}
