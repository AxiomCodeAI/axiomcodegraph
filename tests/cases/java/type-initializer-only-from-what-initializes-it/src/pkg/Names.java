package pkg;

import java.util.Arrays;
import java.util.List;

public final class Names {
    private Names() { }

    static List<String> fresh() { return Arrays.asList("a", "b"); }
}
