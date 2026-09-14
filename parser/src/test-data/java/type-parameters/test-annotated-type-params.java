package com.test.typeparameters;

import java.lang.annotation.*;

@interface NonNull { }

@interface Validated {
    Class<?> validator() default Object.class;
    Class<?>[] groups() default {};
}

class ValidationGroup { }

class SizeValidator { }

class MarkerAnnotation<@NonNull T> { }

class SingleArgAnnotation<@Validated(validator = SizeValidator.class) U> { }

class MultiArgAnnotation<@Validated(validator = SizeValidator.class, groups = ValidationGroup.class) V> { }

class MultipleAnnotations<
    @NonNull @Validated(validator = SizeValidator.class) T
> { }

class MixedAnnotatedParams<
    @NonNull T extends Number,
    @Validated(groups = ValidationGroup.class) U,
    V extends Comparable<V>
> { }
