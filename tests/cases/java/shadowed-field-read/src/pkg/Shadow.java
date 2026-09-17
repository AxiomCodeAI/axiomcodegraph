package pkg;
public class Shadow {
    private Object value;
    private int count;

    public int hashCode() {
        if (value == null) {
            return 31;
        }
        long value = 7L;
        return (int) value;
    }

    public int plain() { return count + 1; }
    public int after() { int count = 2; return count; }
}
