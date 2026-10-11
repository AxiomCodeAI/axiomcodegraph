package pkg;

import org.junit.Test;

public class PeekTest {
    @Test
    public void peeks() { assert Reader.peek().equals("peek"); }
}
