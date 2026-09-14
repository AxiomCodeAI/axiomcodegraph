package com.test.methods;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.annotation.ElementType;

@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.PARAMETER, ElementType.TYPE_PARAMETER})
@interface Validated {}

@Retention(RetentionPolicy.RUNTIME)
@interface Cached {
    int ttl() default 60;
    String key() default "";
}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
@interface NotNull {}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
@interface Size {
    int min() default 0;
    int max() default Integer.MAX_VALUE;
}

public class MethodAnnotationsTest {
    
    // Method-level annotations
    @Deprecated
    public void deprecatedMethod() {}
    
    @Override
    public String toString() {
        return "MethodAnnotationsTest";
    }
    
    @SuppressWarnings("unchecked")
    public void suppressedMethod() {}
    
    // Multiple method annotations
    @Deprecated
    @SuppressWarnings("deprecation")
    public void multiAnnotatedMethod() {}
    
    // Annotation with named arguments
    @Cached(ttl = 300, key = "user-cache")
    public String getCachedData() {
        return null;
    }
    
    // Parameter annotations
    public void paramAnnotations(@NotNull String name, @Size(min = 1, max = 100) String value) {}
    
    // Multiple parameter annotations
    public void multiParamAnnotations(
        @NotNull @Size(min = 1) String required,
        @Validated Object data
    ) {}
    
    // Method type parameter annotations
    public <@Validated T> T validatedGeneric(T input) {
        return input;
    }
    
    // Combined method, parameter, and type parameter annotations
    @Cached(ttl = 60)
    public <@Validated T> void fullAnnotated(
        @NotNull T input,
        @Size(min = 0, max = 10) String limit
    ) {}
    
    // SafeVarargs annotation
    @SafeVarargs
    public final <T> void safeVarargs(T... items) {}
}

class ConstructorAnnotationsTest {
    
    // Annotated constructor
    @Deprecated
    public ConstructorAnnotationsTest() {}
    
    // Constructor with annotated parameters
    public ConstructorAnnotationsTest(@NotNull String name, @Size(max = 50) String description) {}
}

interface InterfaceAnnotationsTest {
    
    // Annotated default method
    @Deprecated
    default void deprecatedDefault() {}
    
    // Abstract method with parameter annotations
    void process(@NotNull String data);
}
