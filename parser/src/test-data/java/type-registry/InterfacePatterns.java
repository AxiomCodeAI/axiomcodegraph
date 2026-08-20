package com.inventory.auth.examples;

import java.util.*;
import java.io.Serializable;

/**
 * Test file for interface patterns including:
 * - Default methods with generics
 * - Static interface methods
 * - Multiple interface inheritance
 */
public class InterfacePatterns {

    public interface GenericInterface<T> {
        T getValue();

        void setValue(T value);

        default <U> Map<T, U> defaultGenericMethod(T t, U u) {
            Map<T, U> map = new HashMap<>();
            map.put(t, u);
            return map;
        }

        default T getOrDefault(T defaultValue) {
            T current = getValue();
            return current != null ? current : defaultValue;
        }

        static <T> GenericInterface<T> create(T initialValue) {
            return new GenericInterface<T>() {
                private T value = initialValue;

                @Override
                public T getValue() {
                    return value;
                }

                @Override
                public void setValue(T value) {
                    this.value = value;
                }
            };
        }

        static <T, U> Map<T, U> staticHelper(T key, U value) {
            Map<T, U> map = new HashMap<>();
            map.put(key, value);
            return map;
        }
    }

    public interface BoundedGenericInterface<T extends Comparable<T>> {
        T compare(T a, T b);

        default T max(T a, T b) {
            return a.compareTo(b) >= 0 ? a : b;
        }

        default <U extends T> U boundedDefault(U value) {
            return value;
        }

        static <T extends Comparable<T>> T staticMax(T a, T b) {
            return a.compareTo(b) >= 0 ? a : b;
        }
    }

    public interface MultipleTypeParamsInterface<K, V> {
        Map<K, V> getMap();

        default <U> Map<K, Map<V, U>> nestedDefault(K key, V value, U extra) {
            Map<V, U> inner = new HashMap<>();
            inner.put(value, extra);
            Map<K, Map<V, U>> outer = new HashMap<>();
            outer.put(key, inner);
            return outer;
        }

        static <K, V> Map<K, V> staticCreate() {
            return new HashMap<>();
        }
    }

    public interface ExtendingInterface<T> extends GenericInterface<T> {
        void additionalMethod(T value);

        default <U> List<T> defaultListMethod(T... elements) {
            List<T> list = new ArrayList<>();
            for (T elem : elements) {
                list.add(elem);
            }
            return list;
        }

        @Override
        default T getOrDefault(T defaultValue) {
            return GenericInterface.super.getOrDefault(defaultValue);
        }
    }

    public interface IntersectionInterface<T extends Serializable & Comparable<T>> {
        T process(T input);

        default T processWithDefault(T input, T defaultValue) {
            return input != null ? input : defaultValue;
        }

        default <U extends T> U genericProcess(U value) {
            return value;
        }
    }

    public static class ImplementingClass<T> implements GenericInterface<T> {
        private T value;

        @Override
        public T getValue() {
            return value;
        }

        @Override
        public void setValue(T value) {
            this.value = value;
        }

        public <U> Map<T, List<U>> customMethod(T key, U... values) {
            Map<T, List<U>> map = new HashMap<>();
            List<U> list = new ArrayList<>();
            for (U val : values) {
                list.add(val);
            }
            map.put(key, list);
            return map;
        }
    }

    public static class MultipleInterfaces<T, U> 
            implements GenericInterface<T>, MultipleTypeParamsInterface<T, U> {
        private T value;
        private Map<T, U> map = new HashMap<>();

        @Override
        public T getValue() {
            return value;
        }

        @Override
        public void setValue(T value) {
            this.value = value;
        }

        @Override
        public Map<T, U> getMap() {
            return map;
        }
    }

    public interface FunctionalWithGenerics<T, R> {
        R apply(T input);

        default <U> FunctionalWithGenerics<T, U> andThen(FunctionalWithGenerics<R, U> after) {
            return (T t) -> after.apply(apply(t));
        }

        static <T> FunctionalWithGenerics<T, T> identity() {
            return t -> t;
        }
    }

    public interface WildcardInterface {
        List<?> getWildcardList();

        Map<? extends Number, ? super Integer> getWildcardMap();

        default <T> List<? extends T> defaultWildcard(T... elements) {
            List<T> list = new ArrayList<>();
            for (T elem : elements) {
                list.add(elem);
            }
            return list;
        }
    }
}
