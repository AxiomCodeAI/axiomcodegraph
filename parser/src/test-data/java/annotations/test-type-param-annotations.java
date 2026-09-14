package com.test.annotations;

@interface NonNull { }

@interface Validated {
    Class<?> validator() default Object.class;
}

class SizeValidator { }

class SimpleTypeParamAnnotation<@NonNull T> { }

class ParameterizedTypeParamAnnotation<@Validated(validator = SizeValidator.class) U> { }

class MultipleTypeParamsWithAnnotations<
    @NonNull T,
    @Validated(validator = SizeValidator.class) U,
    V
> { }

class MixedAnnotatedAndUnannotated<
    @NonNull T extends Number,
    U,
    @Validated(validator = SizeValidator.class) V extends Comparable<V>
> { }
