package probe.boot;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** SUBJECT: a spring.factories initializer: registered and called, not a bean. */
public class WidgetInitializer implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext ctx) {
        WidgetWire.init();
    }
}
