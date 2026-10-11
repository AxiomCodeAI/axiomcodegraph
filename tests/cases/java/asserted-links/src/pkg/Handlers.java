package pkg;

import java.util.Map;

public class Handlers {
    public static Map<String, Object> onSave(Map<String, Object> doc) {
        return audit(doc);
    }

    public static Map<String, Object> onLoad(Map<String, Object> doc) {
        return doc;
    }

    public static Map<String, Object> onPurge(Map<String, Object> doc) {
        return doc;
    }

    public static Map<String, Object> audit(Map<String, Object> doc) {
        doc.put("audited", true);
        return doc;
    }
}
