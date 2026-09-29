package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * havingValue is compared ignoring case, and so is the implicit "false" test when
 * havingValue is omitted. A .properties value arrives verbatim; a YAML boolean is
 * already normalised by the reader.
 */
@Configuration
public class CaseConfig {
    // yml true vs "TRUE": selected
    @Bean @ConditionalOnProperty(name = "app.flag", havingValue = "TRUE")
    public Widget upperBean() { return new Widget(); }

    // control: same key, matching case: selected
    @Bean @ConditionalOnProperty(name = "app.flag", havingValue = "true")
    public Widget lowerBean() { return new Widget(); }

    // control: a different value in any case stays excluded
    @Bean @ConditionalOnProperty(name = "app.flag", havingValue = "FALSE")
    public Widget refutedBean() { return new Widget(); }

    // properties "FALSE", no havingValue: excluded
    @Bean @ConditionalOnProperty(name = "app.off")
    public Widget offBean() { return new Widget(); }

    // properties "True", no havingValue: selected
    @Bean @ConditionalOnProperty(name = "app.mixed")
    public Widget mixedBean() { return new Widget(); }

    // properties "Fast" vs "fast": selected; vs "slow": excluded (near miss)
    @Bean @ConditionalOnProperty(name = "app.mode", havingValue = "fast")
    public Widget fastBean() { return new Widget(); }

    @Bean @ConditionalOnProperty(name = "app.mode", havingValue = "slow")
    public Widget slowBean() { return new Widget(); }
}
