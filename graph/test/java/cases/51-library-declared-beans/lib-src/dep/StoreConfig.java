package dep;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** SUBJECT C: a @Bean FACTORY METHOD on a dependency @Configuration class. */
@Configuration
public class StoreConfig {

    @Bean
    public WidgetCache widgetCache() {
        return new WidgetCache();
    }
}
