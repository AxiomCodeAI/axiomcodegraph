package app;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIf;
import org.junit.jupiter.api.condition.EnabledIf;

class SyncTest {
    @Test
    @DisabledIf("app.Conditions#onCi")
    void syncs() { }

    @Test
    void reflects() throws Exception { Conditions.class.getMethod("weekend"); }

    @Test
    @EnabledIf("app.Weather#holiday")
    void elsewhere() { }
}
