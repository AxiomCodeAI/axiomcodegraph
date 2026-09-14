package com.test.typereferences;

import java.util.List;
import java.util.Map;
import java.util.Set;

class SimpleGeneric<T extends List<String>> { }

class DoubleNested<T extends Map<String, List<Integer>>> { }

class TripleNested<T extends Map<String, Map<Integer, List<Boolean>>>> { }

class ComplexNested<T extends List<Map<String, Set<Integer>>>> { }

class MultiParamNested<
    T extends Map<String, Integer>,
    U extends List<Map<T, String>>,
    V extends Set<List<U>>
> { }
