package app;

public class Widget {
    public String name() {
        return label("w");
    }

    String label(String s) {
        return s.trim();
    }
}
