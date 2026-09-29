package app.settings;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// control: @ConfigurationProperties on the type itself
@Component
@ConfigurationProperties(prefix = "app.plain")
public class PlainProperties {
    private String endpoint;
    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
}
