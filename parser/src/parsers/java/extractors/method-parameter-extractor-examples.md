# MethodParameterExtractor - Examples

This document shows concrete examples of what the MethodParameterExtractor extracts from Java source code.

## Overview

The MethodParameterExtractor identifies and extracts **method parameter metadata** - every parameter in method and constructor declarations, including their types, modifiers, and associated type references.

## What It Extracts

For each method parameter, it captures:
- **paramName**: The parameter name
- **position**: Zero-indexed position in parameter list
- **parameterBaseType**: Simple type name without generics (e.g., `List`, `String[]`)
- **parameterTypeName**: Full type with generics (e.g., `List<User>`)
- **potentialQualifiedName**: Resolved fully qualified name (e.g., `java.util.List`)
- **isAmbiguous**: Whether the qualified name could be from star imports
- **isFinal**: Whether parameter has `final` modifier
- **isVarArgs**: Whether parameter is varargs (`...`)
- **isReceiverParameter**: Whether it's a receiver parameter (`this`)

Additionally, it extracts:
- **TypeReferences** for each parameter's type (including generics, wildcards, arrays)
- **TypeAnnotations** on parameters (e.g., `@NotNull`, `@Valid`)
- **AnnotationArguments** for annotations with values

---

## Example 1: Simple Parameters

### Input Java Code
```java
package com.example.service;

public class UserService {
    public void createUser(String name, int age) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    parameterTypeName    potentialQualifiedName    isFinal    isVarArgs
name         0           String               String               java.lang.String          false      false
age          1           int                  int                  (null)                    false      false
```

**Capabilities Demonstrated**:
- ✅ Extracts parameter names and positions
- ✅ Handles primitive types (no qualified name)
- ✅ Resolves java.lang types automatically

---

## Example 2: Generic Parameters

### Input Java Code
```java
package com.example.service;

import java.util.List;
import java.util.Map;

public class DataService {
    public void process(List<String> items, Map<String, Integer> scores) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    parameterTypeName           potentialQualifiedName
items        0           List                 List<String>                java.util.List
scores       1           Map                  Map<String, Integer>        java.util.Map
```

### Extracted TypeReferences
```csv
typeName    kind            context        ownerKind       position
List        PARAMETERIZED   METHOD_PARAM   METHOD_PARAM    0
String      CLASS           TYPE_ARGUMENT  METHOD_PARAM    0
Map         PARAMETERIZED   METHOD_PARAM   METHOD_PARAM    0
String      CLASS           TYPE_ARGUMENT  METHOD_PARAM    0
Integer     CLASS           TYPE_ARGUMENT  METHOD_PARAM    1
```

**Capabilities Demonstrated**:
- ✅ Extracts generic type parameters
- ✅ Creates TypeReferences for generic arguments
- ✅ Tracks nested type structure

---

## Example 3: Final Parameters

### Input Java Code
```java
package com.example.model;

public class ImmutableBuilder {
    public ImmutableBuilder(final String id, final int version) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    isFinal    isVarArgs
id           0           String               true       false
version      1           int                  true       false
```

**Capabilities Demonstrated**:
- ✅ Detects `final` modifier on parameters
- ✅ Works with constructor parameters

---

## Example 4: Varargs Parameters

### Input Java Code
```java
package com.example.util;

public class Logger {
    public void log(String format, Object... args) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    parameterTypeName    isVarArgs
format       0           String               String               false
args         1           Object[]             Object[]             true
```

**Capabilities Demonstrated**:
- ✅ Detects varargs parameters
- ✅ Converts `Object...` to `Object[]` for accurate type representation
- ✅ Preserves isVarArgs flag for distinction from regular arrays

---

## Example 5: Wildcard Parameters

### Input Java Code
```java
package com.example.service;

import java.util.List;

public class DataProcessor {
    public void processNumbers(List<? extends Number> numbers) { }
    public void addItems(List<? super Integer> list) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    parameterTypeName
numbers      0           List                 List<? extends Number>
list         0           List                 List<? super Integer>
```

### Extracted TypeReferences
```csv
typeName    kind        context        variance    boundTypeName
List        PARAM...    METHOD_PARAM   -           -
?           WILDCARD    TYPE_ARGUMENT  EXTENDS     Number
Number      CLASS       WILDCARD_BOUND -           -

List        PARAM...    METHOD_PARAM   -           -
?           WILDCARD    TYPE_ARGUMENT  SUPER       Integer
Integer     CLASS       WILDCARD_BOUND -           -
```

**Capabilities Demonstrated**:
- ✅ Handles bounded wildcards (`? extends`, `? super`)
- ✅ Creates nested TypeReferences for wildcard bounds
- ✅ Tracks wildcard variance

---

## Example 6: Annotated Parameters

### Input Java Code
```java
package com.example.controller;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public class UserController {
    public void updateUser(@NotNull String id, @Size(min = 1, max = 100) String name) { }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    potentialQualifiedName
id           0           String               java.lang.String
name         1           String               java.lang.String
```

### Extracted TypeAnnotations
```csv
annotationName    context                  ownerHash
NotNull           PARAMETER_DECLARATION    METHOD_PARAMETER_xxx
Size              PARAMETER_DECLARATION    METHOD_PARAMETER_yyy
```

### Extracted AnnotationArguments
```csv
annotationHash               argumentName    argumentValue
TYPE_ANNOTATION_yyy          min             1
TYPE_ANNOTATION_yyy          max             100
```

**Capabilities Demonstrated**:
- ✅ Extracts annotations on parameters
- ✅ Captures annotation arguments
- ✅ Links annotations to parameter hashes

---

## Example 7: Receiver Parameters (Java 8+)

### Input Java Code
```java
package com.example.model;

public class Outer {
    public class Inner {
        public void process(Outer Outer.this) { }
    }
}
```

### Extracted MethodParameters
```csv
paramName    position    parameterBaseType    isReceiverParameter
this         0           Outer                true
```

**Capabilities Demonstrated**:
- ✅ Detects receiver parameters
- ✅ Handles qualified receiver types

---

## Example 8: Record Component Parameters

### Input Java Code
```java
package com.example.model;

import jakarta.validation.constraints.NotBlank;

public record User(@NotBlank String name, int age, String... aliases) { }
```

### Extracted MethodParameters (for canonical constructor)
```csv
paramName    position    parameterBaseType    parameterTypeName    isVarArgs
name         0           String               String               false
age          1           int                  int                  false
aliases      2           String[]             String[]             true
```

### Extracted TypeAnnotations
```csv
annotationName    context                  ownerHash
NotBlank          PARAMETER_DECLARATION    METHOD_PARAMETER_xxx
```

**Capabilities Demonstrated**:
- ✅ Extracts record components as constructor parameters
- ✅ Handles varargs in records
- ✅ Captures annotations on record components

---

## Example 9: Complex Nested Generics

### Input Java Code
```java
package com.example.service;

import java.util.Map;
import java.util.List;
import java.util.function.Function;

public class TransformService {
    public void transform(
        Map<String, List<Integer>> data,
        Function<List<Integer>, Map<String, Double>> transformer
    ) { }
}
```

### Extracted MethodParameters
```csv
paramName      position    parameterBaseType    parameterTypeName
data           0           Map                  Map<String, List<Integer>>
transformer    1           Function             Function<List<Integer>, Map<String, Double>>
```

### Extracted TypeReferences (simplified)
```csv
# For 'data' parameter:
Map → String, List → Integer

# For 'transformer' parameter:
Function → List → Integer
         → Map → String, Double
```

**Capabilities Demonstrated**:
- ✅ Handles deeply nested generics
- ✅ Preserves complete type structure
- ✅ Creates proper TypeReference hierarchy

---

## Summary

### Parameter Types Supported

| Type | Example | Extracted |
|------|---------|-----------|
| Simple | `String name` | ✅ |
| Primitive | `int count` | ✅ |
| Generic | `List<T> items` | ✅ |
| Wildcard | `List<? extends Number>` | ✅ |
| Array | `String[] args` | ✅ |
| Varargs | `String... args` | ✅ |
| Final | `final String id` | ✅ |
| Annotated | `@NotNull String` | ✅ |
| Receiver | `Outer.this` | ✅ |
| Record component | `record(String name)` | ✅ |

### Contexts Used

- **METHOD_PARAM**: Primary context for parameter type references

### Owner Kinds

- **METHOD_PARAM**: Links TypeReferences to MethodParameter entities

### Integration

The MethodParameterExtractor is called by:
- **TypeMethodExtractor**: For regular method and constructor parameters
- **Record processing**: For record component parameters (canonical constructor)
