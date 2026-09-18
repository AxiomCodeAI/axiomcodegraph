package probe;

import dep.AlwaysGate;
import dep.FallbackGate;
import dep.PrimaryGate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * CONDITIONAL BEANS: a property key decides which of several beans the container
 * creates. A bean whose condition is false is never instantiated and its methods are
 * never reached, but nothing in the graph records the condition, so both arms of the
 * same key are reported as live and equally reachable.
 *
 * The controls are `AlwaysGate` and `alwaysOn`, which carry no condition.
 */
@Service
public class Gateway {

    @Autowired private PrimaryGate primary;
    @Autowired private FallbackGate fallback;
    @Autowired private AlwaysGate always;

    /** SUBJECT A: reaches the arm selected when the key is true. */
    public String viaPrimary(String r) {
        return primary.route(r);
    }

    /** SUBJECT B: reaches the arm selected when the key is false. Never both. */
    public String viaFallback(String r) {
        return fallback.route(r);
    }

    /** CONTROL: reaches an unconditional bean. */
    public String viaAlways(String r) {
        return always.route(r);
    }
}
