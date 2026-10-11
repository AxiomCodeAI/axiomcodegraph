package app.beans;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {
    @Bean(initMethod = "start", destroyMethod = "stop")
    public Pool pool() { return new Pool(); }

    @Bean
    public Plain plain() { return new Plain(); }
}
