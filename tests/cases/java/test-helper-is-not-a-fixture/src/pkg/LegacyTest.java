package pkg;

import junit.framework.TestCase;

public class LegacyTest extends TestCase {
    protected void setUp() { Shared.boot(); }

    protected void tearDown() { Shared.close(); }

    public void testOne() { }

    public void testTwo() { }
}
