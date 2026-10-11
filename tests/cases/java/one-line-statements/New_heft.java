package a;

public class Box {
    private int size = 1, heft = 2;
    private String label = "b"; private int count = 0;
    static final int LIMIT = 3; static final String NAME = "x";
    protected int lo, hi;

    public int run(int k) {
        int con = k + 1; int dr = k + 2; int rc = k + 3;
        return con + dr + rc + lo + hi + size + weight + count + LIMIT + label.length() + NAME.length();
    }
}
