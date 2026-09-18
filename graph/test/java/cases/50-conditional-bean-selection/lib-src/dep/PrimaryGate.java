package dep;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;

/**
 * Stands in for an auto-configuration library that ships two mutually exclusive
 * configurations on ONE key. The consumer's property file picks exactly one; the
 * container instantiates that one and never sees the other.
 */
@Configuration
@ConditionalOnProperty(name = "app.gate.enabled", havingValue = "true")
public class PrimaryGate {
    public String route(String request) {
        return "primary:" + request;
    }
}
