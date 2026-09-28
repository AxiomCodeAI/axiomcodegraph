package shop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.mail")
public class MailProperties {
    private String host;
    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }
}
