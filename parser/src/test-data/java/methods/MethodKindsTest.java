package com.test.methods;

import java.io.IOException;

public class MethodKindsTest {
    
    // Instance method
    public void instanceMethod() {}
    
    // Static method
    public static void staticMethod() {}
    
    // Final method
    public final void finalMethod() {}
    
    // Synchronized method
    public synchronized void synchronizedMethod() {}
    
    // Native method
    public native int nativeMethod();
    
    // Constructor
    public MethodKindsTest() {}
    
    // Overloaded constructor
    public MethodKindsTest(String name) {}
    
    // Method with throws
    public void throwingMethod() throws IOException, IllegalArgumentException {}
    
    // Private method
    private void privateMethod() {}
    
    // Protected method
    protected void protectedMethod() {}
    
    // Package-private method
    void packageMethod() {}
    
    // Static initializer
    static {
        System.out.println("Static init");
    }
    
    // Instance initializer
    {
        System.out.println("Instance init");
    }
}

abstract class AbstractMethodTest {
    // Abstract method
    public abstract void abstractMethod();
    
    // Concrete method in abstract class
    public void concreteMethod() {}
}

interface InterfaceMethodTest {
    // Abstract interface method
    void interfaceMethod();
    
    // Default method
    default void defaultMethod() {
        System.out.println("default");
    }
    
    // Static interface method
    static void staticInterfaceMethod() {}
}

@interface AnnotationMethodTest {
    // Annotation elements
    String name();
    int priority() default 0;
    String[] tags() default {};
}
