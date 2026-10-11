package pkg;

import java.util.Map;

public final class Table {
    // read directly by the test: reading a static field initializes the type first
    public static final Map<String, String> ROWS = Rows.load();

    private Table() { }
}
