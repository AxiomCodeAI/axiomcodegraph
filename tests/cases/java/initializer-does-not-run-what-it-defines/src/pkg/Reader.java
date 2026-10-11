package pkg;

public class Reader {
    static Access ACCESS;

    static {
        // the initializer builds the accessor; its method runs only when someone calls it
        ACCESS = new Access() {
            @Override
            public String promote(String s) { return Upper.of(s); }
        };
        Tables.prime();
    }

    public static String peek() { return "peek"; }
}
