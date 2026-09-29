package probe;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OtherConfig {
    // boolean property condition, havingValue defaults to true: false -> excluded
    @Bean @ConditionalOnBooleanProperty(name = "app.bool.off")
    public Widget boolBean() { return new Widget(); }

    // true -> selected
    @Bean @ConditionalOnBooleanProperty("app.bool.on")
    public Widget boolOnBean() { return new Widget(); }

    // havingValue = false against false -> selected
    @Bean @ConditionalOnBooleanProperty(name = "app.bool.off", havingValue = false)
    public Widget boolInvertedBean() { return new Widget(); }

    // a condition the analysis does not model: declared undecided, never dropped
    @Bean @ConditionalOnWebApplication
    public Widget webBean() { return new Widget(); }

    // control: decided property condition
    @Bean @ConditionalOnProperty(name = "app.bool.off", havingValue = "true")
    public Widget propBean() { return new Widget(); }

    // control: an already-listed opaque condition keeps its own reason
    @Bean @ConditionalOnClass(name = "com.example.Missing")
    public Widget classBean() { return new Widget(); }

    // near miss: an annotation that is not a condition gives no condition row
    @Bean @ConditionalLogging
    public Widget plainBean() { return new Widget(); }
}
