package probe.boot;

import probe.service.Mailer;

/** SUBJECT: a spring.factories EnableAutoConfiguration value on a continued line; its constructor is injected. */
public class LegacyAutoConfiguration {
    private final Mailer mailer;

    public LegacyAutoConfiguration(Mailer mailer) {
        this.mailer = mailer;
        WidgetWire.legacy();
    }
}
