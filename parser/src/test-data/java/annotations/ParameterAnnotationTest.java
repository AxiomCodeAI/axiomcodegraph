package com.inventory.auth.examples;

import java.util.List;

public class ParameterAnnotationTest {
    
    // Simple parameter annotation
    public void methodWithAnnotatedParam(@Deprecated String name) {
        System.out.println(name);
    }
    
    // Multiple parameter annotations
    public void methodWithMultipleAnnotations(
        @Deprecated String first,
        @SuppressWarnings("unchecked") List<String> items
    ) {
        System.out.println(first + items);
    }
    
    // Varargs with annotation
    @SafeVarargs
    public final <T> void methodWithAnnotatedVarargs(T... values) {
        System.out.println(values);
    }
}
