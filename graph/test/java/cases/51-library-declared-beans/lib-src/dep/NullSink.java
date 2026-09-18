package dep;

import org.springframework.stereotype.Component;

/** CONTROL F, arm two: two beans fit `Sink`, so the slot must stay a fan, not narrow. */
@Component
public class NullSink implements Sink {
    @Override
    public void write(String line) {
    }
}
