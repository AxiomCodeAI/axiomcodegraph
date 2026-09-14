package com.test.typereferences;

import java.util.List;

class UnboundedWildcard<T extends List<?>> { }

class UpperBoundedWildcard<T extends List<? extends Number>> { }

class LowerBoundedWildcard<T extends List<? super Integer>> { }

class ComplexWildcard<T extends List<? extends Comparable<? super String>>> { }

class MultipleWildcards<
    T extends List<? extends Number>,
    U extends List<? super Integer>,
    V extends List<?>
> { }
