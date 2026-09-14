package com.test.methods;

import java.io.Serializable;
import java.io.Closeable;
import java.util.List;
import java.util.Collection;

public class MethodTypeParamsTest {
    
    // Simple unbounded type parameter
    public <T> T identity(T input) {
        return input;
    }
    
    // Multiple type parameters
    public <K, V> void process(K key, V value) {}
    
    // Single bounded type parameter
    public <T extends Number> double sum(List<T> numbers) {
        return numbers.stream().mapToDouble(Number::doubleValue).sum();
    }
    
    // Multiple bounds (intersection type)
    public <T extends Runnable & Closeable> void executeAndClose(T task) throws Exception {
        try {
            task.run();
        } finally {
            task.close();
        }
    }
    
    // Recursive bound (F-bounded polymorphism)
    public <T extends Comparable<T>> T max(T a, T b) {
        return a.compareTo(b) >= 0 ? a : b;
    }
    
    // Type parameter with parameterized bound
    public <T extends Collection<String>> void processCollection(T collection) {}
    
    // Multiple type parameters with different bounds
    public <T extends Number, U extends Comparable<U>, V> void multipleWithBounds(T num, U comp, V any) {}
    
    // Type parameter used in return type
    public <E extends Exception> E wrapException(String message, Class<E> exceptionType) {
        return null;
    }
    
    // Static method with type parameter
    public static <T> List<T> asList(T... items) {
        return List.of(items);
    }
    
    // Type parameter with Serializable bound
    public <T extends Serializable> void serialize(T object) {}
    
    // Complex nested bounds
    public <T extends Comparable<? super T>> void sortable(List<T> items) {}
    
    // F-bounded polymorphism with complex bounds
    public <B extends Builder<B, T>, T extends Serializable> T build(B builder) {
        return null;
    }
    
    // Type parameter with parameterized intersection bounds
    public <T extends List<String> & Serializable & Comparable<T>> void complexIntersection(T list) {}
    
    // Multiple type params with cross-references
    public <K extends Comparable<? super K>, V extends Collection<? extends K>> 
        java.util.Map<K, V> createSortedMap(V values) {
        return null;
    }
    
    // Exception type parameter with bounds
    public <E extends RuntimeException & Serializable> void throwTyped(Class<E> exType) throws E {}
}

interface Builder<Self extends Builder<Self, T>, T> {
    Self with(String key, Object value);
    T build();
}

class GenericConstructorTest {
    // Generic constructor
    public <T> GenericConstructorTest(T value) {}
    
    // Bounded generic constructor
    public <T extends Number> GenericConstructorTest(T value, int count) {}
    
    // Constructor with multiple bounds
    public <T extends Serializable & Comparable<T>> GenericConstructorTest(List<T> items, Class<T> type) {}
}
