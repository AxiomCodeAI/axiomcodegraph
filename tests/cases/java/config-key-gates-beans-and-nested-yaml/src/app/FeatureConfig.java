package app;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
@Configuration
public class FeatureConfig {
    @Configuration @ConditionalOnProperty(name = "feature.mode", havingValue = "a")
    static class ModeA { @Bean public Engine engineA() { return new FastEngine(); } }
    @Configuration @ConditionalOnProperty(name = "feature.mode", havingValue = "b")
    static class ModeB { @Bean public Engine engineB() { return new SlowEngine(); } }
    @Bean @ConditionalOnProperty(name = "feature.fast")
    public Engine fastEngine() { return new FastEngine(); }
}
