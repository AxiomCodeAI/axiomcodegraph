package pkg;

import org.junit.Test;

public class EngineTest {
    @Test
    public void runsAfterBoot() { assert Engine.run() == 1; }
}
