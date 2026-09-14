package com.test.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
@interface Named {
    String value();
}

@Retention(RetentionPolicy.RUNTIME)
@interface Priority {
    int value();
}

@Named("MainClass")
@Priority(100)
public class SingleValueAnnotationTest {
    
    @Named("importantField")
    private String data;
    
    @Priority(50)
    public void process() {}
    
    @SuppressWarnings("unchecked")
    public void suppressedMethod() {}
}
