package pkg;

import kit.Pump;
import org.junit.Test;

public class TapTest {
    @Test
    public void drains() { assert "drip".equals(Pump.drain(new Tap())); }
}
