package com.test.annotations;

@interface Retention {
    RetentionPolicy value();
}

@interface Target {
    ElementType[] value();
}

enum RetentionPolicy {
    SOURCE, CLASS, RUNTIME
}

enum ElementType {
    TYPE, FIELD, METHOD, PARAMETER
}

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface MyAnnotation { }

@Retention(RetentionPolicy.SOURCE)
public @interface SourceAnnotation { }

@Target({ ElementType.TYPE, ElementType.METHOD })
public @interface MultiTargetAnnotation { }

@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.TYPE, ElementType.FIELD, ElementType.METHOD })
public @interface CompleteAnnotation { }
