package app;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
@Configuration @ConditionalOnProperty(prefix = "app.web", name = "enabled", matchIfMissing = true)
public class WebConfig { @Bean public Engine webEngine() { return new FastEngine(); } }
