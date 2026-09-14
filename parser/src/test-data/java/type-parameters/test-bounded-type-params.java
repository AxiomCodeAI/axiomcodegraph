package com.test.typeparameters;

import java.io.Serializable;

class SingleBound<T extends Number> { }

class MultipleBounds<T extends Number & Comparable<T>> { }

class ComplexBounds<T extends Comparable<T> & Serializable & Cloneable> { }

class MixedBounds<
    T extends Number,
    U extends Comparable<U>,
    V extends Serializable & Cloneable
> { }
