package app;

import java.util.function.Function;

public class Pipeline implements Function<String, String> {
    @Override
    public String apply(String s) {
        return s.trim();
    }
}
