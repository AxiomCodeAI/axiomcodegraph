package com.test.annotations;

@interface Timeout {
    int value();
}

@interface Priority {
    int value();
}

@Timeout(5000)
public class TimedClass { }

@Priority(10)
class PriorityClass { }

@Timeout(3000)
@Priority(5)
class MultipleSingleValue { }
