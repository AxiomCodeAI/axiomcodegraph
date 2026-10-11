package pkg;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;
import org.junit.Test;

public class DispatchTest {
    @Test
    public void save() throws Exception {
        assert Dispatch.dispatch("onSave", new HashMap<>()) != null;
    }

    @Test
    public void table() {
        Map<String, Function<Map<String, Object>, Object>> t = new HashMap<>();
        t.put("load", Handlers::onLoad);
        assert Dispatch.runTable(t, "load", new HashMap<>()) != null;
    }
}
