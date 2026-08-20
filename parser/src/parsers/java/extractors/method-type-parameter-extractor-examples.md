# MethodTypeParameterExtractor - Examples

This document shows concrete examples of what the MethodTypeParameterExtractor extracts from Java source code.

## Overview

The MethodTypeParameterExtractor identifies and extracts **method-level generic type parameters** - the type variables declared on individual methods (e.g., `<T>`, `<K, V>`) as opposed to class-level type parameters.

## What It Extracts

For each method type parameter, it captures:
- **typeParamName**: The type parameter name (e.g., `T`, `E`, `K`)
- **position**: Zero-indexed position in the type parameter list
- **methodRegistryLinkHash**: Hash linking to the owning method
- **typeRegistryLinkHash**: Hash linking to the containing type
- **hasBounds**: Whether the parameter has bounds (`extends`)

Additionally, it extracts:
- **TypeReferences** for bounds (using `METHOD_TYPE_PARAM_BOUND` context)
- **TypeAnnotations** on type parameters (e.g., `@NonNull T`)

---

## Example 1: Simple Unbounded Type Parameter

### Input Java Code
```java
package com.example.util;

public class Converter {
    public <T> T identity(T input) {
        return input;
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           false        METHOD_REGISTRY_xxx
```

**Capabilities Demonstrated**:
- ✅ Extracts simple type parameter declarations
- ✅ Tracks position in parameter list
- ✅ Links to owning method

---

## Example 2: Multiple Type Parameters

### Input Java Code
```java
package com.example.util;

public class MapUtils {
    public <K, V> void putAll(Map<K, V> source, Map<K, V> target) { }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
K                0           false        METHOD_REGISTRY_xxx
V                1           false        METHOD_REGISTRY_xxx
```

**Capabilities Demonstrated**:
- ✅ Extracts multiple type parameters
- ✅ Tracks correct positions

---

## Example 3: Single Bounded Type Parameter

### Input Java Code
```java
package com.example.service;

import java.util.List;

public class ShapeService {
    public <T extends Shape> double calculateArea(List<T> shapes) {
        return shapes.stream().mapToDouble(Shape::getArea).sum();
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           true         METHOD_REGISTRY_xxx
```

### Extracted TypeReferences
```csv
typeName    kind     context                  ownerKind           boundKind
Shape       CLASS    METHOD_TYPE_PARAM_BOUND  METHOD_TYPE_PARAM   EXTENDS
```

**Capabilities Demonstrated**:
- ✅ Detects bounded type parameters
- ✅ Creates TypeReference for bounds
- ✅ Uses METHOD_TYPE_PARAM_BOUND context

---

## Example 4: Multiple Bounds (Intersection Types)

### Input Java Code
```java
package com.example.service;

import java.io.Closeable;

public class ResourceHandler {
    public <T extends Runnable & Closeable> void execute(T resource) {
        try {
            resource.run();
        } finally {
            resource.close();
        }
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           true         METHOD_REGISTRY_xxx
```

### Extracted TypeReferences
```csv
typeName     kind        context                  ownerKind           position
Runnable     INTERFACE   METHOD_TYPE_PARAM_BOUND  METHOD_TYPE_PARAM   0
Closeable    INTERFACE   METHOD_TYPE_PARAM_BOUND  METHOD_TYPE_PARAM   1
```

**Capabilities Demonstrated**:
- ✅ Handles intersection types (multiple bounds with `&`)
- ✅ Creates separate TypeReference for each bound
- ✅ Tracks bound positions

---

## Example 5: Recursive Bounds

### Input Java Code
```java
package com.example.util;

public class Comparisons {
    public <T extends Comparable<T>> T max(T a, T b) {
        return a.compareTo(b) >= 0 ? a : b;
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           true         METHOD_REGISTRY_xxx
```

### Extracted TypeReferences
```csv
typeName      kind            context                  depth    typeArgument
Comparable    PARAMETERIZED   METHOD_TYPE_PARAM_BOUND  0        -
T             TYPE_VARIABLE   TYPE_ARGUMENT            1        (of Comparable)
```

**Capabilities Demonstrated**:
- ✅ Handles recursive/self-referential bounds
- ✅ Preserves parameterized bound types
- ✅ Tracks nested type arguments in bounds

---

## Example 6: Annotated Type Parameters

### Input Java Code
```java
package com.example.service;

import java.io.Serializable;

public class DataService {
    public <@NonNull T extends Serializable> void save(T data) { }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           true         METHOD_REGISTRY_xxx
```

### Extracted TypeAnnotations
```csv
annotationName    context               ownerHash
NonNull           TYPE_PARAMETER        METHOD_TYPE_PARAMETER_xxx
```

### Extracted TypeReferences
```csv
typeName        kind        context                  ownerKind
Serializable    INTERFACE   METHOD_TYPE_PARAM_BOUND  METHOD_TYPE_PARAM
```

**Capabilities Demonstrated**:
- ✅ Extracts annotations on method type parameters
- ✅ Uses TYPE_PARAMETER context for annotations
- ✅ Still extracts bounds alongside annotations

---

## Example 7: Generic Static Method

### Input Java Code
```java
package com.example.factory;

public class Factory {
    public static <T> T create(Class<T> clazz) throws Exception {
        return clazz.getDeclaredConstructor().newInstance();
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           false        METHOD_REGISTRY_xxx
```

**Capabilities Demonstrated**:
- ✅ Works with static methods
- ✅ Type parameter used in return type, parameter, and method body

---

## Example 8: Multiple Parameters with Mixed Bounds

### Input Java Code
```java
package com.example.service;

import java.util.Collection;
import java.util.function.Function;

public class TransformService {
    public <T, U extends Number, V extends Collection<U>> V transform(
        Collection<T> input,
        Function<T, U> mapper,
        V output
    ) {
        input.stream().map(mapper).forEach(output::add);
        return output;
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
T                0           false        METHOD_REGISTRY_xxx
U                1           true         METHOD_REGISTRY_xxx
V                2           true         METHOD_REGISTRY_xxx
```

### Extracted TypeReferences
```csv
typeName      kind            context                  position    typeArgument
Number        CLASS           METHOD_TYPE_PARAM_BOUND  0           -
Collection    PARAMETERIZED   METHOD_TYPE_PARAM_BOUND  0           -
U             TYPE_VARIABLE   TYPE_ARGUMENT            0           (of Collection)
```

**Capabilities Demonstrated**:
- ✅ Handles mix of bounded and unbounded type parameters
- ✅ Supports bounds referencing other method type parameters
- ✅ Preserves parameterized bounds

---

## Example 9: Exception Type Parameter

### Input Java Code
```java
package com.example.service;

public class ExceptionHandler {
    public <E extends Exception> void handle(E exception, Class<E> exceptionType) 
        throws E {
        // re-throw after logging
        throw exception;
    }
}
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds    methodRegistryLinkHash
E                0           true         METHOD_REGISTRY_xxx
```

### Extracted TypeReferences
```csv
typeName     kind     context                  ownerKind
Exception    CLASS    METHOD_TYPE_PARAM_BOUND  METHOD_TYPE_PARAM
```

**Capabilities Demonstrated**:
- ✅ Handles exception type parameters
- ✅ Type parameter used in throws clause
- ✅ Extracts Exception as bound

---

## Difference from TypeParameterExtractor

| Aspect | TypeParameterExtractor | MethodTypeParameterExtractor |
|--------|------------------------|------------------------------|
| **Scope** | Class/Interface level | Method level |
| **Declaration** | `class Foo<T>` | `<T> void method()` |
| **Context** | TYPE_PARAM_BOUND | METHOD_TYPE_PARAM_BOUND |
| **Links to** | typeRegistryLinkHash | methodRegistryLinkHash |
| **Entity** | TypeParameter | MethodTypeParameter |

### Example Showing Both

```java
public class Container<T> {                      // TypeParameter: T
    public <U extends T> void add(U item) { }    // MethodTypeParameter: U
}
```

---

## Summary

### Type Parameter Types Supported

| Type | Example | Extracted |
|------|---------|-----------|
| Simple | `<T>` | ✅ |
| Multiple | `<K, V>` | ✅ |
| Single bound | `<T extends Number>` | ✅ |
| Multiple bounds | `<T extends A & B>` | ✅ |
| Recursive bound | `<T extends Comparable<T>>` | ✅ |
| Annotated | `<@NonNull T>` | ✅ |
| Exception type | `<E extends Exception>` | ✅ |

### Contexts Used

- **METHOD_TYPE_PARAM_BOUND**: For type references in bounds

### Owner Kinds

- **METHOD_TYPE_PARAM**: Links TypeReferences to MethodTypeParameter entities

### Integration

The MethodTypeParameterExtractor is called by:
- **TypeMethodExtractor**: For all method declarations with type parameters
