package com.example.test;

import java.io.Serializable;

@interface Deprecated { }

@interface SuppressWarnings {
    String[] value();
}

@interface NonNull { }

@interface Validated {
    Class<?>[] groups() default {};
}

class ValidationGroup { }

class BaseClass<T> { }

class SubClass1 extends CompleteExample<Number, String> { }

class SubClass2 extends CompleteExample<Integer, String> { }

@Deprecated
@SuppressWarnings("unchecked")
public sealed class CompleteExample<
    @NonNull T extends Number & Comparable<T>,
    @Validated(groups = ValidationGroup.class) U
> extends BaseClass<T>
  implements Serializable, Comparable<CompleteExample<T, U>>
  permits SubClass1, SubClass2 {
}
