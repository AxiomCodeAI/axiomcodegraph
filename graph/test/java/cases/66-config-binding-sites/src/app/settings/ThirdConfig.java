package app.settings;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ThirdConfig {
    // the construct: the prefix binds the type the factory returns
    @Bean
    @ConfigurationProperties(prefix = "app.third")
    public ThirdParty thirdParty() { return new ThirdParty(); }

    // the same, with the prefix as the annotation's value
    @Bean
    @ConfigurationProperties("app.pool")
    public Pool pool() { return new Pool(); }

    // near miss: a factory with no @ConfigurationProperties binds nothing,
    // although app.other.endpoint names a field of the type it returns
    @Bean
    public OtherThing otherThing() { return new OtherThing(); }
}
