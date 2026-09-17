package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** SUBJECT C: the same construct inside the application rather than a dependency. */
@Component
@ConditionalOnProperty(name = "app.local.mode", havingValue = "fast", matchIfMissing = true)
public class LocalPrimary {
    public String handle() {
        return "fast";
    }
}
