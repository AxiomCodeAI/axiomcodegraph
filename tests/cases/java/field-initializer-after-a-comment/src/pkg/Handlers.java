package pkg;

public final class Handlers {
    private Handlers() { }

    public static final Handler UPPER =
        // a comment between the `=` and the initializer, as a formatter or an author leaves one
        new Handler() {
            @Override
            public String handle(String s) { return Shout.loud(s); }
        };

    // control: the same shape with no comment
    public static final Handler LOWER =
        new Handler() {
            @Override
            public String handle(String s) { return Shout.soft(s); }
        };
}
