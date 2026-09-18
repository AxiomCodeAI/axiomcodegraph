package probe;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** SUBJECT D: a profile, which is the same question asked with a different annotation. */
@Component
@Profile("batch")
public class ProfiledOnly {
    public String handle() {
        return "batch";
    }
}
