package pkg;

import org.junit.Test;

public class FormatterTest {
    @Test
    public void renders() { assert new Formatter().render("x").equals("x"); }

    @Test
    public void widens() { assert new Formatter().widest(1, 2) == 2; }
}
