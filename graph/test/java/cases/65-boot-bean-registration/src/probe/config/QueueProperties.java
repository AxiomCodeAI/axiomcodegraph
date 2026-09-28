package probe.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** CONTROL: registered by nothing, and outside the properties scan. Stays unsatisfied. */
@ConfigurationProperties("app.queue")
public class QueueProperties {
    private int depth;

    public int getDepth() { return depth; }

    public void setDepth(int depth) { this.depth = depth; }
}
