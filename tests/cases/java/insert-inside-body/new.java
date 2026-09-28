package pkg;
public class Svc {
    public int build(int n) {
        int r = 0;
        if (n > 0) {
            r = n;
        }
        r += 2;

        // keep r
        r *= 1;
        return r;
    }

    public int other() {
        return 1;
    }
}
