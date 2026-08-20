package com.test.integration;

import java.io.Closeable;
import java.io.IOException;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Stream;

@interface Cached {
    int ttl() default 60;
    String key() default "";
}

@interface Validated {}

@interface NotNull {}

@interface Size {
    int min() default 0;
    int max() default Integer.MAX_VALUE;
}

public class ComplexMethodsIntegration<T extends Serializable & Comparable<T>> {
    
    // Complex generic method with multiple type params and bounds
    @Cached(ttl = 300, key = "transform-cache")
    public <U extends Number & Comparable<U>, V extends Collection<? extends U>> 
        Map<String, List<U>> transformCollection(
            @NotNull V input,
            @Validated Function<U, String> keyMapper,
            Predicate<? super U> filter
        ) throws IOException, IllegalArgumentException {
        return null;
    }
    
    // Method with recursive bounds and complex wildcards
    public <E extends Comparable<? super E>> List<E> sort(
        List<? extends E> items,
        BiFunction<? super E, ? super E, Integer> comparator
    ) {
        return null;
    }
    
    // Method with deeply nested generics
    public Map<String, Map<Integer, List<Optional<T>>>> getNestedData(
        @Size(min = 1, max = 100) String key,
        Map<String, ? extends List<? super T>> source
    ) {
        return null;
    }
    
    // Varargs with complex generic type
    @SafeVarargs
    public final <R extends Serializable> List<R> combine(
        Function<T, R> mapper,
        @NotNull T... items
    ) {
        return null;
    }
    
    // Method with intersection type bound and closeable
    public <R extends Runnable & Closeable & Serializable> void executeTask(
        R task,
        @Size(max = 1000) int timeout
    ) throws Exception {
        try {
            task.run();
        } finally {
            task.close();
        }
    }
    
    // Complex constructor
    public ComplexMethodsIntegration(
        @NotNull T initialValue,
        Map<String, ? extends T> cache,
        Predicate<T> validator
    ) {}
    
    // Static factory with complex bounds
    public static <T extends Serializable & Comparable<T>> 
        ComplexMethodsIntegration<T> create(
            @Validated T seed,
            Function<T, T> transformer
        ) {
        return null;
    }
}

abstract class AbstractProcessor<E extends Exception> {
    
    // Abstract method with exception type parameter
    public abstract <T, R> R process(
        T input,
        Function<T, R> handler
    ) throws E;
    
    // Method with stream and complex lambda types
    protected <T> Stream<T> filterAndMap(
        Stream<? extends T> input,
        Predicate<? super T> filter,
        Function<? super T, ? extends T> mapper
    ) {
        return input.filter(filter).map(mapper);
    }
}

interface FluentBuilder<Self extends FluentBuilder<Self, T>, T> {
    
    // Recursive generic method
    Self with(@NotNull String key, T value);
    
    // Build method with type parameter
    <R extends T> R build(Class<R> type);
    
    // Default method with complex signature
    default <U extends Comparable<? super U>> Self sorted(
        Function<T, U> keyExtractor
    ) {
        return null;
    }
}

record ComplexRecord<T extends Serializable>(
    @NotNull T value,
    @Size(min = 0, max = 10) List<T> items,
    Map<String, ? extends T> lookup
) {
    // Compact constructor with validation
    public ComplexRecord {
        if (value == null) throw new IllegalArgumentException("value required");
    }
    
    // Record method with generics
    public <R> Optional<R> transform(Function<T, R> mapper) {
        return Optional.ofNullable(value).map(mapper);
    }
}
