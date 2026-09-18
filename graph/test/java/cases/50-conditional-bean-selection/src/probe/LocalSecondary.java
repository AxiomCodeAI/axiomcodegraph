package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** The other arm of SUBJECT C's key. */
@Component
@ConditionalOnProperty(name = "app.local.mode", havingValue = "slow")
public class LocalSecondary {
    public String handle() {
        return "slow";
    }
}
