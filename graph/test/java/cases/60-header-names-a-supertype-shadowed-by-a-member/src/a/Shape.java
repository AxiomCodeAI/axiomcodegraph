package a;

// The same shape through extends, with the member type nested one level deeper.
public class Shape extends Base {
    public static class Holder {
        public static class Base { }
    }
    public static class Base { }

    @Override
    public String name() { return "shape"; }
}
