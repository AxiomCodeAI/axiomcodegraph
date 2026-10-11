package pkg;

import org.junit.Test;

public class RouterTest {
    @Test
    public void routesUpper() { assert "X".equals(new Router().route(Handlers.UPPER, "x")); }

    @Test
    public void routesLower() { assert "x".equals(new Router().route(Handlers.LOWER, "X")); }
}
