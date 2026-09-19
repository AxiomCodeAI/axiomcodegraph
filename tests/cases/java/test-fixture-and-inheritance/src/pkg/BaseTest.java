package pkg;

import org.junit.Before;

// A base class with the fixture and NO test of its own. Its setUp runs before every test in every
// subclass, so the change it reaches is reached by all of them.
public abstract class BaseTest {
    protected int seen;

    @Before
    public void setUp() { seen = new Service().touch(); }
}
