package dep;

import org.springframework.context.annotation.Configuration;

/** CONTROL: a configuration with no condition on it. Unconditionally live. */
@Configuration
public class AlwaysGate {
    public String route(String request) {
        return "always:" + request;
    }
}
