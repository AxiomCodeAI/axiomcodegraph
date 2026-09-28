package probe.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** CONTROL: a bean by stereotype before this change. */
@Component
@ConfigurationProperties(prefix = "app.cache")
public class CacheProperties {
    private int size;

    public int getSize() { return size; }

    public void setSize(int size) { this.size = size; }
}
