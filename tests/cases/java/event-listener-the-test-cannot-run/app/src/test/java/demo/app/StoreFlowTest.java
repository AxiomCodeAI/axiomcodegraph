package demo.app;

import demo.core.Recorder;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;

public class StoreFlowTest {
    @Test
    public void storesWhatIsRecorded() {
        StaticApplicationContext context = new StaticApplicationContext();
        context.refresh();
        new Recorder(context).record("y");
    }
}
