package demo.core;

import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;

public class RecorderTest {
    @Test
    public void recordsThroughAContext() {
        StaticApplicationContext context = new StaticApplicationContext();
        context.refresh();
        new Recorder(context).record("x");
    }
}
