package com.inventory.auth.examples;

import java.io.Serializable;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.Collections;

/**
 * Test file for generic method patterns including:
 * - Self-referential return types
 * - Recursive generics
 * - Intersection types
 * - Static generic methods
 */
public class GenericMethodPatterns {

    public <T extends Comparable<T>> T selfBoundedReturn(T input) {
        return input;
    }

    public <T extends Comparable<? super T>> T superBoundedReturn(T input) {
        return input;
    }

    public <T extends List<T>> T recursiveListReturn() {
        return null;
    }

    public <T extends Comparable<T> & Serializable> T intersectionReturn(T a, T b) {
        return a.compareTo(b) > 0 ? a : b;
    }

    public <T extends Serializable & Comparable<T> & Cloneable> T tripleIntersectionReturn(T value) {
        return value;
    }

    public <T extends Number & Comparable<T>> T numberComparableIntersection(T a, T b) {
        return a.compareTo(b) >= 0 ? a : b;
    }

    public static <T extends Comparable<? super T>> T staticGenericMethod(List<T> list) {
        return Collections.max(list);
    }

    public static <K, V extends Comparable<? super V>> Map.Entry<K, V> staticMapEntry(K key, V value) {
        return new Map.Entry<K, V>() {
            public K getKey() { return key; }
            public V getValue() { return value; }
            public V setValue(V value) { throw new UnsupportedOperationException(); }
        };
    }

    public static <T> List<T> staticListCreator(T... elements) {
        List<T> list = new ArrayList<>();
        for (T elem : elements) {
            list.add(elem);
        }
        return list;
    }

    public <T extends U, U> T genericWithDependency(T t, U u) {
        return t;
    }

    public <T, U extends T> U reverseDependency(T t, U u) {
        return u;
    }

    public <T extends Comparable<T>, U extends T> U boundedDependency(T t, U u) {
        return u;
    }

    public <T> T unboundedGeneric(T input) {
        return input;
    }

    public <T, U, V> Map<T, Map<U, V>> tripleGenericNested(T key1, U key2, V value) {
        Map<U, V> innerMap = new java.util.HashMap<>();
        innerMap.put(key2, value);
        Map<T, Map<U, V>> outerMap = new java.util.HashMap<>();
        outerMap.put(key1, innerMap);
        return outerMap;
    }

    public <T extends Comparable<T>> List<T> selfBoundedList(T... elements) {
        List<T> list = new ArrayList<>();
        for (T elem : elements) {
            list.add(elem);
        }
        return list;
    }

    public static <T extends Enum<T>> T staticEnumMethod(Class<T> enumType, String name) {
        return Enum.valueOf(enumType, name);
    }

    public <T extends Number> T[] genericNumberArray(T... numbers) {
        return numbers;
    }

    public <T> T genericReturnWithWildcardParam(List<? extends T> list) {
        return list.isEmpty() ? null : list.get(0);
    }

    public <T> void genericWithMultipleWildcards(
            List<? extends T> source,
            List<? super T> destination) {
        for (T item : source) {
            destination.add(item);
        }
    }
}
