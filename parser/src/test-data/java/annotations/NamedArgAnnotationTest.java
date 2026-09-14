package com.test.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
@interface Config {
    String name();
    int priority() default 0;
    String description() default "";
}

@Config(name = "MainService", priority = 10, description = "Primary service")
public class NamedArgAnnotationTest {
    
    @Config(name = "field1", priority = 5)
    private String data;
    
    @Config(name = "processor", description = "Processes data")
    public void process() {}
}
