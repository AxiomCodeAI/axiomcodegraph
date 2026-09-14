package com.axiom.test.generics;

import java.util.List;
import java.util.Map;

/**
 * Method-type-parameter linking test (populates the previously empty
 * method-type-parameters category).
 *
 * Every method type parameter must link (methodRegistryLinkHash) to its OWN
 * method, with contiguous positions 0..n-1. `consume` is overloaded with
 * different type-parameter arities (1 vs 2); each overload's type parameters
 * must link only to that overload. Bounded parameters must report hasBounds.
 */
public class GenericMethodLinking {

    public <T> T identity(T x) {
        return x;
    }

    public <K, V> Map<K, V> pair(K k, V v) {
        return Map.of(k, v);
    }

    public <T extends Comparable<T>> T max(List<T> items) {
        return items.get(0);
    }

    // second type parameter bounded by the first
    public <A, B extends A> B narrow(A a, B b) {
        return b;
    }

    // overloaded generic methods: 1 vs 2 type parameters
    public <T> void consume(T t) { }

    public <T, U> void consume(T t, U u) { }
}
