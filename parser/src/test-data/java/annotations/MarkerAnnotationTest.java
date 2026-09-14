package com.test.annotations;

@Deprecated
public class MarkerAnnotationTest {
    
    @SuppressWarnings
    private String value;
    
    @Deprecated
    public void deprecatedMethod() {}
    
    @Override
    public String toString() {
        return "MarkerAnnotationTest";
    }
}

@FunctionalInterface
interface MarkerInterface {
    void execute();
}
