package probe;

public class Widget implements AutoCloseable {
    public static Widget create() {
        return new Widget();
    }

    public void paint() {
    }

    @Override
    public void close() {
    }
}
