package probe;

public class Service {
    public void fail() {
        throw new IllegalStateException("x");
    }
}
