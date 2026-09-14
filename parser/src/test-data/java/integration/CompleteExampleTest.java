package com.test.integration;

import java.util.List;
import java.util.Map;
import java.io.Serializable;

@Deprecated
public class CompleteExampleTest<T extends Serializable> {
    
    @SuppressWarnings("unused")
    private List<String> items;
    
    private Map<String, T> cache;
    
    public CompleteExampleTest() {}
    
    public CompleteExampleTest(List<String> items) {
        this.items = items;
    }
    
    @Override
    public String toString() {
        return "CompleteExampleTest";
    }
    
    public <U extends Number> U transform(T input, Class<U> targetType) {
        return null;
    }
    
    public void processAll(String... args) {}
}

interface Processor<E> {
    void process(E element);
}

abstract class AbstractHandler {
    public abstract void handle();
}
