package demo.tools;

import demo.core.Recorder;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;

public class ToolsFlowTest {
    @Test
    public void recordsFromADependentModule() {
        StaticApplicationContext context = new StaticApplicationContext();
        context.refresh();
        new Recorder(context).record("t");
    }
}
