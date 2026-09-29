package app;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
@Component
public class Greeter {
    @Value("${greet.prefix}") private String prefix;
    @Value("${greet.suffix}") private String suffix;
    public String greet(String n) { return prefix + n + suffix; }
}
