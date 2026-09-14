package com.inventory.auth.examples;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.function.Function;
import java.util.function.Supplier;

public class AllMethodExamples {

    private String instanceField = "Instance Field";
    private static String staticField = "Static Field";

    static {
        System.out.println("Static initializer - executed when class is loaded");
    }

    {
        System.out.println("Instance initializer - executed before constructor");
    }

    public AllMethodExamples() {
    }

    public AllMethodExamples(String value) {
        this.instanceField = value;
    }

    public void publicInstanceMethod() {
        System.out.println("Public instance method");
    }

    protected void protectedMethod() {
        System.out.println("Protected method");
    }

    void packagePrivateMethod() {
        System.out.println("Package-private method");
    }

    private void privateMethod() {
        System.out.println("Private method");
    }

    public static void staticMethod() {
        System.out.println("Static method");
    }

    public final synchronized void finalSynchronizedMethod() {
        System.out.println("Final synchronized method");
    }

    public strictfp double strictfpMethod() {
        return 1.0 / 3.0;
    }

    public int[] methodWithMultipleParams(String param1, int param2, double param3) {
        System.out.println("Multiple params: " + param1 + ", " + param2 + ", " + param3);
        return new int[]{1, 2, 3};
    }

    public void methodWithVarargs(String... args) {
        System.out.println("Varargs: " + Arrays.toString(args));
    }

    public <T, U extends Number> Map<T, U> genericMethodMultipleTypes(T key, U value) {
        Map<T, U> map = new HashMap<>();
        map.put(key, value);
        return map;
    }

    public <T extends Serializable & Comparable<T> & Cloneable> void multipleBoundsMethod(T item) {
        System.out.println("Multiple bounds: " + item);
    }

    public void overloadedMethod() {
        System.out.println("No parameters");
    }

    public void overloadedMethod(String param) {
        System.out.println("String parameter");
    }

    public void overloadedMethod(String param1, int param2, Object... varargs) {
        System.out.println("Multiple params + varargs");
    }

    public <T> T methodThrowsMultipleExceptions(T input) throws IllegalArgumentException, NullPointerException, Exception {
        try {
            if (input == null) throw new NullPointerException();
            return input;
        } catch (NullPointerException e) {
            throw e;
        } finally {
            System.out.println("Finally block");
        }
    }

    public native void nativeMethod();

    public String[][] multiDimensionalArrayReturn() {
        return new String[][]{{"a", "b"}, {"c", "d"}};
    }

    public void wildcardParamsAllTypes(List<?> any, List<? extends Number> upper, List<? super Integer> lower) {
        System.out.println("All wildcard types");
    }

    public void receiverParameter(AllMethodExamples this) {
        System.out.println("Explicit receiver parameter");
    }

    public void deeplyNestedComplexParam(
            List<List<List<String>>> tripleNested,
            Map<String, List<Set<Integer>>> complexMap,
            List<String>[] arrayOfLists) {
        System.out.println("Deep nesting: 3-level list, map-list-set, array of lists");
    }

    public <T extends Comparable<T>, U> Map<T, List<U>> genericNestedWithBounds(T key, U value) {
        Map<T, List<U>> result = new HashMap<>();
        result.put(key, Arrays.asList(value));
        return result;
    }

    public void nestedWildcardsComplex(
            List<? extends List<? extends Number>> nestedWildcard,
            Map<? extends String, ? super Integer> mapWildcard) {
        System.out.println("Nested wildcards with covariant and contravariant");
    }

    public void functionalInterfaceParams(
            Function<String, Function<Integer, Boolean>> nestedFunc,
            Supplier<List<String>> supplier,
            Callable<Map<String, Integer>> callable) throws Exception {
        System.out.println("Multiple functional interfaces: nested function, supplier, callable");
    }

    public <K, V> Map<K, List<Map<Integer, Set<V>>>> complexGenericNestedReturn(K key, V value) {
        Map<K, List<Map<Integer, Set<V>>>> result = new HashMap<>();
        Set<V> set = new HashSet<>();
        set.add(value);
        Map<Integer, Set<V>> innerMap = new HashMap<>();
        innerMap.put(1, set);
        result.put(key, Arrays.asList(innerMap));
        return result;
    }

    public <T extends Number> Class<? extends T> classTypeParamWithBounds(Class<T> clazz, T instance) {
        System.out.println("Class<T extends Number>: " + clazz.getName() + ", instance: " + instance);
        return (Class<? extends T>) instance.getClass();
    }

    public void multipleComplexParams(
            Map<String, List<Integer>> param1,
            List<Map<String, Set<Double>>> param2,
            Function<String, List<Map<Integer, Boolean>>> param3,
            Class<? extends Collection<String>> param4) {
        System.out.println("Method with multiple complex parameters");
    }

    public <T extends Comparable<? super T>, U extends Comparable<? super U>> Map<T, List<U>> recursiveBoundsMultipleTypes(
            List<T> list1,
            Collection<? extends Serializable> input,
            Collection<? super U> output) {
        System.out.println("Recursive bounds on multiple types with bounded wildcards");
        return new HashMap<>();
    }

    public <T, E extends Enum<E>> T[] genericArrayWithEnumAndVarargs(
            T[] array,
            Class<T> componentType,
            Class<E> enumClass,
            List<T>... varargLists) {
        System.out.println("Generic array, enum bound, varargs of lists");
        return array;
    }

    public abstract static class InnerAbstractClass {
        public abstract void abstractMethod();

        public void concreteMethod() {
            System.out.println("Concrete method in abstract class");
        }
    }

    public static class ConcreteInnerClass extends InnerAbstractClass {
        @Override
        public void abstractMethod() {
            System.out.println("Implementation of abstract method");
        }
    }

    @FunctionalInterface
    public interface SimpleFunctionalInterface {
        void singleAbstractMethod();
    }

    public interface InterfaceWithMethods {
        void abstractMethodInInterface();

        default void defaultMethodWithImplementation() {
            System.out.println("Default method with implementation");
        }

        static void staticInterfaceMethod() {
            System.out.println("Static method in interface");
        }
    }

    public String lambdaMethodExample() {
        SimpleFunctionalInterface lambda = () -> System.out.println("Lambda implementation");
        lambda.singleAbstractMethod();
        return "Lambda executed";
    }

    public void methodReferenceExample() {
        List<String> list = Arrays.asList("a", "b", "c");
        list.forEach(System.out::println);
    }

    public AllMethodExamples recursiveBuilderMethod(int count, String value) {
        if (count > 0) {
            this.instanceField = value + count;
            return recursiveBuilderMethod(count - 1, value);
        }
        return this;
    }

    @Deprecated
    public void deprecatedMethod() {
        System.out.println("This method is deprecated");
    }

    @SafeVarargs
    public final <T> void safeVarargsMethod(T... args) {
        System.out.println("Safe varargs method");
    }

    @Override
    public String toString() {
        return "AllMethodExamples{instanceField='" + instanceField + "'}";
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        AllMethodExamples that = (AllMethodExamples) obj;
        return instanceField.equals(that.instanceField);
    }

    @Override
    public int hashCode() {
        return instanceField.hashCode();
    }

    public static enum Status {
        ACTIVE("A") {
            @Override
            public String getDescription() {
                return "Active status";
            }
        },
        INACTIVE("I") {
            @Override
            public String getDescription() {
                return "Inactive status";
            }
        };

        private final String code;

        Status(String code) {
            this.code = code;
        }

        public String getCode() {
            return code;
        }

        public abstract String getDescription();
    }

    public static enum Operation {
        ADD {
            @Override
            public int apply(int a, int b) {
                return a + b;
            }
        },
        SUBTRACT {
            @Override
            public int apply(int a, int b) {
                return a - b;
            }
        },
        MULTIPLY {
            @Override
            public int apply(int a, int b) {
                return a * b;
            }
        };

        public abstract int apply(int a, int b);
    }

    public static @interface MyAnnotation {
        String value();
        int count() default 0;
        Class<?> type() default Object.class;
        String[] tags() default {};
    }

    public static class Outer {
        private String outerField = "Outer";

        public class Inner {
            public void methodAccessingOuter(String msg) {
                System.out.println("Outer field: " + Outer.this.outerField + ", Message: " + msg);
            }
        }

        public void methodWithAnnotatedReceiver(AllMethodExamples.Outer this) {
            System.out.println("Method with receiver parameter: " + this.outerField);
        }
    }

    public static void main(String[] args) {
        AllMethodExamples example = new AllMethodExamples();
        
        System.out.println("=== Basic Methods ===");
        example.publicInstanceMethod();
        staticMethod();
        int[] result = example.methodWithMultipleParams("test", 123, 45.6);
        example.methodWithVarargs("arg1", "arg2", "arg3");
        
        System.out.println("\n=== Generics & Bounds ===");
        Map<String, Integer> genericResult = example.genericMethodMultipleTypes("key", 100);
        System.out.println("Generic result: " + genericResult);
        
        System.out.println("\n=== Overloading ===");
        example.overloadedMethod();
        example.overloadedMethod("param");
        example.overloadedMethod("param", 1, "obj1", "obj2");
        
        System.out.println("\n=== Builder Pattern & Recursion ===");
        AllMethodExamples chained = example.recursiveBuilderMethod(3, "val");
        System.out.println(chained);
        
        System.out.println("\n=== Enums ===");
        Status status = Status.ACTIVE;
        System.out.println("Status: " + status.getDescription());
        Operation op = Operation.ADD;
        System.out.println("Operation result: " + op.apply(5, 3));
        
        System.out.println("\n=== Complex Nested Parameters ===");
        List<List<List<String>>> tripleNested = Arrays.asList(
            Arrays.asList(Arrays.asList("deeply", "nested"))
        );
        Map<String, List<Set<Integer>>> complexMap = new HashMap<>();
        Set<Integer> set = new HashSet<>();
        set.add(1);
        complexMap.put("key", Arrays.asList(set));
        example.deeplyNestedComplexParam(tripleNested, complexMap, null);
        
        System.out.println("\n=== Generic Nested with Bounds ===");
        Map<String, List<Integer>> boundedResult = example.genericNestedWithBounds("key", 42);
        System.out.println("Bounded generic nested: " + boundedResult);
        
        System.out.println("\n=== Wildcards ===");
        example.wildcardParamsAllTypes(Arrays.asList(1, "a"), Arrays.asList(1, 2), Arrays.asList(1, 2, 3));
        
        System.out.println("\n=== Complex Return Types ===");
        Map<String, List<Map<Integer, Set<String>>>> complexReturn = example.complexGenericNestedReturn("k", "v");
        System.out.println("Complex nested return: " + complexReturn);
        
        System.out.println("\n=== Class Types & Reflection ===");
        Class<? extends Integer> classResult = example.classTypeParamWithBounds(Integer.class, 100);
        System.out.println("Class type result: " + classResult);
        
        System.out.println("\n=== Recursive Type Bounds ===");
        example.recursiveBoundsMultipleTypes(Arrays.asList("a", "b"), Arrays.asList(1, 2, 3), Arrays.asList("x"));
    }
}
