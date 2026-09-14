package com.test.annotations;

@interface Target {
    ElementType[] value();
}

enum ElementType {
    TYPE, FIELD, METHOD, PARAMETER, CONSTRUCTOR
}

@Target(ElementType.TYPE)
public @interface SingleElementArray { }

@Target({ ElementType.TYPE, ElementType.METHOD, ElementType.FIELD })
public @interface MultiElementArray { }

@Target({ ElementType.TYPE })
class ExplicitSingleArray { }

@Target({ ElementType.TYPE, ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER, ElementType.CONSTRUCTOR })
class AllElements { }
