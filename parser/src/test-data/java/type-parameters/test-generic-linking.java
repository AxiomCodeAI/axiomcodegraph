package com.axiom.test.generics;

/**
 * Type-parameter linking test.
 *
 * `GenericLinking` declares three type parameters K, V, T. The bound of V
 * (`V extends K`) references the SIBLING type parameter K, so its bound
 * TypeReference must carry kind TYPE_VARIABLE and link (typeParameterLinkHash)
 * to a declared TypeParameter. Positions must be contiguous 0..n-1 per owner.
 */
public class GenericLinking<K extends Comparable<K>, V extends K, T> {

    private K key;
    private V value;
    private T tag;
}

/** A second generic type in the same file, to verify positions are per-owner. */
class Pair<A, B> {

    private A first;
    private B second;
}
