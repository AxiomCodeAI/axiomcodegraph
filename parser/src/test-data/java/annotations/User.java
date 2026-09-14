package com.test.annotations;

@interface Table {
    String name();
    String schema() default "";
}

@interface Column {
    String name();
    boolean nullable() default true;
    int length() default 255;
}

@Table(name = "users", schema = "public")
public class User { }

@Column(name = "id", nullable = false, length = 36)
class IdColumn { }

@Table(name = "orders")
class OrderWithDefault { }
