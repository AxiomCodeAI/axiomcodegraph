package app;

import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * A settings holder: config-bound fields reached only through accessors an annotation
 * processor declares. `hand` is the CONTROL, a getter written out in source over a field
 * bound the same way, so the two differ only in where the accessor came from.
 */
@Getter
@Component
public class Settings {

    /** SUBJECT A: read only through the generated getter. */
    @Value("${app.endpoint.url}")
    private String endpointUrl;

    /** SUBJECT B: a boolean, whose generated accessor is `is` rather than `get`. */
    @Value("${app.retry.enabled}")
    private boolean retryEnabled;

    /** CONTROL: same binding shape, accessor written by hand. */
    @Value("${app.hand.written}")
    private String hand;

    public String getHand() {
        return hand;
    }
}
