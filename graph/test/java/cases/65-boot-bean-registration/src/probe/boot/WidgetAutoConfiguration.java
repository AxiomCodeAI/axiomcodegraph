package probe.boot;

import org.springframework.boot.autoconfigure.AutoConfiguration;

/** SUBJECT: named in AutoConfiguration.imports, so a bean with its constructor reached. */
@AutoConfiguration
public class WidgetAutoConfiguration {
    public WidgetAutoConfiguration() {
        WidgetWire.open();
    }
}
