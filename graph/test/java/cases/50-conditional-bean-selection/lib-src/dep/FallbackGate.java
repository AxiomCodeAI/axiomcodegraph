package dep;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;

/** The other arm of the same key. Exactly one of the two exists at runtime. */
@Configuration
@ConditionalOnProperty(name = "app.gate.enabled", havingValue = "false")
public class FallbackGate {
    public String route(String request) {
        return "fallback:" + request;
    }
}
