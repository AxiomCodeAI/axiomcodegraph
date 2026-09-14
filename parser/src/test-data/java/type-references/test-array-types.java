package com.test.typereferences;

import java.util.List;

class ArrayBound<T extends List<String[]>> { }

class PrimitiveArrayBound<T extends List<int[]>> { }

class MultiDimensionalArray<T extends List<String[][]>> { }

class MixedArrays<
    T extends List<String[]>,
    U extends List<int[]>,
    V extends List<Object[][]>
> { }

class ArraySuperclass extends ArrayList<String[]> { }

class ArrayList<E> { }
