package pkg;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.function.Function;

public class Dispatch {
    public static Object dispatch(String event, Map<String, Object> doc) throws Exception {
        Method m = Handlers.class.getMethod(event, Map.class);
        return m.invoke(null, doc);
    }

    public static Object runTable(Map<String, Function<Map<String, Object>, Object>> table, String key, Map<String, Object> doc) {
        return table.get(key).apply(doc);
    }

    public static Object purge(Map<String, Object> doc) throws Exception {
        Method m = Handlers.class.getMethod("onPurge", Map.class);
        return m.invoke(null, doc);
    }

    public static Object saveAndAudit(Map<String, Object> doc) {
        return Handlers.audit(doc);
    }
}
