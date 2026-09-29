package app.settings;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class WidgetCache {
    private final int ttl;
    private final long ttlMillis;
    private final int size;
    @Value("${widget.label}") private String label;   // control: on a field

    // the construct: a key on a constructor parameter, stored in fields
    public WidgetCache(@Value("${widget.ttl}") int ttl, int size) {
        this.ttl = ttl;
        this.ttlMillis = ttl * 1000L;
        this.size = size;                              // near miss: a plain parameter
    }

    public String put(String id) { return id + "@" + expiry(); }
    public String tag(String id) { return id + "/" + label; }
    public long millis() { return ttlMillis; }
    public int capacity() { return size; }
    public int shadow() { int ttl = 5; return ttl; }  // near miss: a local named like the field
    private long expiry() { return System.currentTimeMillis() + ttl * 1000L; }
}
