package dep;

import org.springframework.stereotype.Component;

/**
 * SUBJECT A: a stereotype on a DEPENDENCY type. The container registers it, so an
 * injection point declared as `Greeter` is satisfied by it and by nothing else.
 */
@Component
public class PoliteGreeter implements Greeter {
    @Override
    public String greet(String who) {
        return "hello " + who;
    }
}
