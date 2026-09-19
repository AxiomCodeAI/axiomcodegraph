package pkg;

import org.junit.Test;

// Declares a test and nothing else. Everything it depends on arrives through the base class fixture.
public class ChildTest extends BaseTest {
    @Test
    public void usesWhatTheFixturePrepared() { assert seen == 7; }
}
