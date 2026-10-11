package app.init;

import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BootConfig {
    @Bean
    public ServletRegistrationBean<BootServlet> bootServlet() {
        return new ServletRegistrationBean<>(new BootServlet(), "/boot");
    }
}
