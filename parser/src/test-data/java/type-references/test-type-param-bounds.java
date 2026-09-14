package com.test.typereferences;

import java.io.Serializable;
import java.util.List;

class SimpleBox<T extends Number> { }

class MultipleBounds<T extends Number & Comparable<T> & Serializable> { }

class ComplexBounds<
    T extends List<String>,
    U extends Comparable<U> & Cloneable,
    V extends Number & Serializable
> { }

class RecursiveBound<T extends Comparable<T>> { }
