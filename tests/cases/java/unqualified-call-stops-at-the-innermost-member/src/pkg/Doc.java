package pkg;

public class Doc {
    public void charset(String c) { }
    public void reset() { }

    public static class Settings {
        public Settings charset(String c) { return this; }
        public Settings() { charset("utf-8"); }
    }

    // control: a name the inner class does not have is still the outer one's
    public class Inner {
        void go() { reset(); }
    }

    // a member inherited by the inner class shadows the outer one too
    public static class Base { void reset() { } }
    public static class Child extends Base {
        void go() { reset(); }
    }
}
