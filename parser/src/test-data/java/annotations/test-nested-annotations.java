package com.test.annotations;

@interface Something {
    Other meta();
}

@interface Other { }

@interface SofaService {
    Class<?> interfaceType();
    SofaServiceBinding bindings();
}

@interface SofaServiceBinding {
    String bindingType();
}

class UserService { }

@Something(meta = @Other)
public class SimpleNested { }

@SofaService(
    interfaceType = UserService.class,
    bindings = @SofaServiceBinding(bindingType = "bolt")
)
public class ServiceImpl { }

@interface Complex {
    Nested nested();
}

@interface Nested {
    String value();
}

@Complex(nested = @Nested("test"))
class ComplexNested { }
