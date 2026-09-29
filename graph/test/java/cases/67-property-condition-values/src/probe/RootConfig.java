package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RootConfig {
    // two types named Dup declare ROOT with different values; the qualified
    // reference names one of them: app.alt.enabled
    @Bean
    @ConditionalOnProperty(prefix = probe.alt.Dup.ROOT, name = "enabled", havingValue = "true")
    public Widget altBean() { return new Widget(); }

    // near miss: `Dup.ROOT` can denote either, so it stays unresolved (undecided)
    // rather than picking one of the two values
    @Bean
    @ConditionalOnProperty(prefix = Dup.ROOT, name = "enabled", havingValue = "true")
    public Widget dupBean() { return new Widget(); }
}
