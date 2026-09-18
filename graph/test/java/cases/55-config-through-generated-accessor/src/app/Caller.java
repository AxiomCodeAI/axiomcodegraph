package app;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Every read of a settings value goes through an accessor, which is the ordinary idiom. */
@Service
public class Caller {

    @Autowired private Settings settings;

    /** Reaches app.endpoint.url through the GENERATED getter. */
    public String useEndpoint() {
        return settings.getEndpointUrl();
    }

    /** Reaches app.retry.enabled through the generated `is` accessor. */
    public boolean useRetry() {
        return settings.isRetryEnabled();
    }

    /** CONTROL: reaches app.hand.written through the hand-written getter. */
    public String useHand() {
        return settings.getHand();
    }
}
