package com.test.methods;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

public class MethodParamsTest {
    
    // Simple parameters
    public void simpleParams(String name, int age) {}
    
    // Final parameters
    public void finalParams(final String id, final int count) {}
    
    // Generic parameters
    public void genericParams(List<String> items, Map<String, Integer> scores) {}
    
    // Wildcard parameters
    public void wildcardParams(List<? extends Number> numbers, List<? super Integer> integers) {}
    
    // Array parameters
    public void arrayParams(String[] names, int[][] matrix) {}
    
    // Varargs parameters
    public void varargParams(String format, Object... args) {}
    
    // Mixed complex parameters
    public void complexParams(
        final List<Map<String, ? extends Number>> data,
        Function<String, Integer> transformer,
        String... tags
    ) {}
    
    // Primitive parameters
    public void primitiveParams(byte b, short s, int i, long l, float f, double d, boolean bool, char c) {}
    
    // Nested generic parameters
    public void nestedGenerics(Map<String, List<Map<Integer, String>>> deepNested) {}
    
    // Multiple varargs methods (overloaded)
    public void process(int... numbers) {}
    public void process(String... strings) {}
    
    // Complex wildcard with nested bounds
    public void complexWildcard(
        Map<? extends Comparable<? super String>, List<? extends Number>> data
    ) {}
    
    // Functional interface parameters with complex generics
    public void functionalParams(
        java.util.function.BiFunction<? super String, ? extends Number, ? extends List<String>> biFunc,
        java.util.function.Predicate<? super Map<String, ?>> predicate,
        java.util.function.Consumer<List<? extends Comparable<?>>> consumer
    ) {}
    
    // Parameter with bounded type from class type param
    public <T extends Number> void boundedParam(
        List<? extends T> items,
        java.util.function.Function<T, ? extends Comparable<? super T>> mapper
    ) {}
    
    // Complex array with generic element type
    public void genericArrayParam(List<String>[] arrayOfLists, Map<String, Integer>[][] nestedArrays) {}
    
    // Stream and Optional parameters
    public void streamParams(
        java.util.stream.Stream<? extends Number> numbers,
        java.util.Optional<Map<String, List<Integer>>> optionalData
    ) {}
}

class RecordParamsTest {
    // Record with parameters
    record Person(String name, int age) {}
    
    // Record with varargs
    record TaggedItem(String id, String... tags) {}
    
    // Record with generics
    record Container<T>(T value, List<T> items) {}
}
