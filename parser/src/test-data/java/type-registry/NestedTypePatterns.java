package com.inventory.auth.examples;

import java.util.Map;
import java.util.HashMap;
import java.util.List;

/**
 * Test file for nested type patterns including:
 * - Outer/inner class type parameter interactions
 * - Type parameter shadowing
 * - Static inner classes with generics
 */
public class NestedTypePatterns<T> {

    private T outerValue;

    public T getOuterValue() {
        return outerValue;
    }

    public <U> Map<T, U> outerMethod(T t, U u) {
        Map<T, U> map = new HashMap<>();
        map.put(t, u);
        return map;
    }

    public class Inner<U> {
        private U innerValue;

        public Map<T, U> combineTypes(T t, U u) {
            Map<T, U> map = new HashMap<>();
            map.put(t, u);
            return map;
        }

        public T getOuterType() {
            return outerValue;
        }

        public U getInnerType() {
            return innerValue;
        }

        public <V> Map<U, V> innerGenericMethod(U u, V v) {
            Map<U, V> map = new HashMap<>();
            map.put(u, v);
            return map;
        }

        public <T> T shadowingMethod(T input) {
            return input;
        }

        public <T, U> Map<T, U> doubleShadowing(T t, U u) {
            Map<T, U> map = new HashMap<>();
            map.put(t, u);
            return map;
        }
    }

    public static class StaticInner<V> {
        private V value;

        public V getValue() {
            return value;
        }

        public <U> Map<V, U> staticInnerMethod(V v, U u) {
            Map<V, U> map = new HashMap<>();
            map.put(v, u);
            return map;
        }

        public <V> V shadowingInStatic(V input) {
            return input;
        }

        public static <W> W staticMethodInStaticClass(W input) {
            return input;
        }
    }

    public class DeepNested<U> {
        public class MoreNested<V> {
            public Map<T, Map<U, V>> tripleTypeParams(T t, U u, V v) {
                Map<U, V> inner = new HashMap<>();
                inner.put(u, v);
                Map<T, Map<U, V>> outer = new HashMap<>();
                outer.put(t, inner);
                return outer;
            }

            public <W> Map<T, Map<U, Map<V, W>>> quadrupleNesting(T t, U u, V v, W w) {
                Map<V, W> level3 = new HashMap<>();
                level3.put(v, w);
                Map<U, Map<V, W>> level2 = new HashMap<>();
                level2.put(u, level3);
                Map<T, Map<U, Map<V, W>>> level1 = new HashMap<>();
                level1.put(t, level2);
                return level1;
            }
        }
    }

    public static class GenericStaticOuter<K, V> {
        public static class GenericStaticInner<T> {
            public <U> Map<T, U> method(T t, U u) {
                Map<T, U> map = new HashMap<>();
                map.put(t, u);
                return map;
            }
        }

        public class NonStaticInner<W> {
            public Map<K, Map<V, W>> combineAll(K k, V v, W w) {
                Map<V, W> inner = new HashMap<>();
                inner.put(v, w);
                Map<K, Map<V, W>> outer = new HashMap<>();
                outer.put(k, inner);
                return outer;
            }
        }
    }

    public static abstract class AbstractNested<T> {
        public abstract <U extends T> U abstractMethodWithBound(U input);
        
        public <V> Map<T, V> concreteMethod(T t, V v) {
            Map<T, V> map = new HashMap<>();
            map.put(t, v);
            return map;
        }
    }

    public static class ConcreteNested<T> extends AbstractNested<T> {
        @Override
        public <U extends T> U abstractMethodWithBound(U input) {
            return input;
        }

        public <U extends T, V> Map<U, V> extendedMethod(U u, V v) {
            Map<U, V> map = new HashMap<>();
            map.put(u, v);
            return map;
        }
    }
}
