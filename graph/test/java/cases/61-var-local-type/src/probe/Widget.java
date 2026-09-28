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

    @Override
    public int hashCode() {
        return 1;
    }
}
