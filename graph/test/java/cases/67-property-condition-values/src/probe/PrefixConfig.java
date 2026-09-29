package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PrefixConfig {
    // interface constant (implicitly static final) as the prefix: app.const.enabled
    @Bean
    @ConditionalOnProperty(prefix = Keys.PREFIX, name = "enabled", havingValue = "true")
    public Widget constBean() { return new Widget(); }

    // interface constants for both prefix and name
    @Bean
    @ConditionalOnProperty(prefix = Keys.PREFIX, name = Keys.ENABLED)
    public Widget constNameBean() { return new Widget(); }

    // class constant, written static final
    @Bean
    @ConditionalOnProperty(prefix = ClassKeys.PREFIX, name = "enabled", havingValue = "true")
    public Widget classConstBean() { return new Widget(); }

    // control: the literal prefix
    @Bean
    @ConditionalOnProperty(prefix = "app.const", name = "enabled", havingValue = "true")
    public Widget literalBean() { return new Widget(); }

    // near miss: a non-final static field is not a constant; no key is resolved from it
    @Bean
    @ConditionalOnProperty(prefix = ClassKeys.MUTABLE_PREFIX, name = "enabled", havingValue = "true")
    public Widget mutableBean() { return new Widget(); }
}
