package shop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Near miss: the same shape as MailProperties, registered by nothing. */
@ConfigurationProperties(prefix = "app.queue")
public class QueueProperties {
    private int depth;
    public int getDepth() { return depth; }
    public void setDepth(int depth) { this.depth = depth; }
}
