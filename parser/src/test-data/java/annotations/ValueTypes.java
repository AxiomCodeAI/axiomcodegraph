package com.test.annotations;

@interface AllTypes {
    String stringVal();
    int intVal();
    long longVal();
    float floatVal();
    boolean boolVal();
    char charVal();
    Class<?> classVal();
    RetentionPolicy enumVal();
    int exprVal();
    Nested nestedVal();
}

@interface Nested { }

enum RetentionPolicy {
    SOURCE, CLASS, RUNTIME
}

@AllTypes(
    stringVal = "test",
    intVal = 42,
    longVal = 999L,
    floatVal = 3.14f,
    boolVal = true,
    charVal = 'x',
    classVal = String.class,
    enumVal = RetentionPolicy.RUNTIME,
    exprVal = 60 * 1000,
    nestedVal = @Nested
)
public class ValueTypes { }
