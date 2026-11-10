package pkg;

import java.io.Reader;

public class Parser {
    static El parse(Reader r) { return new Leaf(); }
}
