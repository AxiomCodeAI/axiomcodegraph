package shop.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WidgetConfig {
    @Bean
    public Widget widget() { return new Widget(); }
}
