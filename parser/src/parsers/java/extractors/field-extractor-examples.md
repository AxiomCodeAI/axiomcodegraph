# FieldExtractor - Examples

This document shows concrete examples of what the FieldExtractor can extract from Java source code.

## Overview

The FieldExtractor identifies and extracts **fields** (instance and class variables) from Java classes, interfaces, and enums. It also extracts **type references** for complex field types and **annotations** applied to fields.

## What It Extracts

### FieldRegistry
For each field, it captures:
- **Name**: The field identifier (e.g., `name`, `count`)
- **Field type name**: Full type as written (e.g., `List<String>`, `int[][]`)
- **Field base type**: Stripped type without generics/arrays (e.g., `List`, `int`)
- **Potential qualified name**: Resolved FQN using imports (e.g., `java.util.List`)
- **Is ambiguous**: Whether qualified name resolution was uncertain
- **Access**: PUBLIC_ACCESS, PROTECTED_ACCESS, PRIVATE_ACCESS, PACKAGE_ACCESS
- **Modifiers**: STATIC, FINAL, VOLATILE, TRANSIENT
- **Owner**: Hash of containing type
- **Location**: startLine, endLine

### TypeReference
For complex field types, it captures:
- **Kind**: PRIMITIVE, CLASS, INTERFACE, ARRAY, GENERIC, WILDCARD, TYPE_PARAMETER
- **Context**: FIELD_TYPE
- **Type name**: The referenced type name
- **Dimensions**: For array types
- **Position/Depth**: For nested generics

### Annotations on Fields
Reuses the AnnotationExtractor to capture annotations applied to fields (including TYPE_USE annotations on generic type arguments).

---

## Example 1: Simple Field Declarations

### Input Java Code
```java
package com.example.model;

public class User {
    private String name;
    private int age;
    private boolean active;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType | access | modifiers |
|------|---------------|---------------|--------|-----------|
| name | String | String | PRIVATE_ACCESS | [] |
| age | int | int | PRIVATE_ACCESS | [] |
| active | boolean | boolean | PRIVATE_ACCESS | [] |

### Extracted TypeReferences
| typeName | kind | context | dimensions |
|----------|------|---------|------------|
| String | CLASS | FIELD_TYPE | 0 |
| int | PRIMITIVE | FIELD_TYPE | 0 |
| boolean | PRIMITIVE | FIELD_TYPE | 0 |

**Capabilities Demonstrated**:
- ✅ Extracts simple primitive and class types
- ✅ Detects private access modifier
- ✅ Generates type references for each field type

---

## Example 2: Access Modifiers

### Input Java Code
```java
package com.example.access;

public class ModifierExample {
    public String publicField;
    protected String protectedField;
    private String privateField;
    String packageField;  // package-private (no modifier)
}
```

### Extracted FieldRegistry
| name | access |
|------|--------|
| publicField | PUBLIC_ACCESS |
| protectedField | PROTECTED_ACCESS |
| privateField | PRIVATE_ACCESS |
| packageField | PACKAGE_ACCESS |

**Capabilities Demonstrated**:
- ✅ Detects all four access levels
- ✅ Package-private (no explicit modifier) correctly identified

---

## Example 3: Field Modifiers (static, final, volatile, transient)

### Input Java Code
```java
package com.example.modifiers;

public class ModifiedFields {
    public static final String CONSTANT = "value";
    private static int instanceCount;
    private final String immutableValue;
    private volatile boolean shutdownRequested;
    private transient Connection cachedConnection;
    private static volatile boolean initialized;
}
```

### Extracted FieldRegistry
| name | access | modifiers |
|------|--------|-----------|
| CONSTANT | PUBLIC_ACCESS | [STATIC, FINAL] |
| instanceCount | PRIVATE_ACCESS | [STATIC] |
| immutableValue | PRIVATE_ACCESS | [FINAL] |
| shutdownRequested | PRIVATE_ACCESS | [VOLATILE] |
| cachedConnection | PRIVATE_ACCESS | [TRANSIENT] |
| initialized | PRIVATE_ACCESS | [STATIC, VOLATILE] |

**Capabilities Demonstrated**:
- ✅ Extracts STATIC, FINAL, VOLATILE, TRANSIENT modifiers
- ✅ Handles combinations of modifiers
- ✅ Preserves order of modifiers

---

## Example 4: Generic Types

### Input Java Code
```java
package com.example.generics;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public class GenericFields {
    private List<String> stringList;
    private Map<String, Integer> stringIntMap;
    private Optional<User> optionalUser;
    private Map<String, List<Integer>> nestedGeneric;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType | potentialQualifiedName |
|------|---------------|---------------|------------------------|
| stringList | List<String> | List | java.util.List |
| stringIntMap | Map<String, Integer> | Map | java.util.Map |
| optionalUser | Optional<User> | Optional | java.util.Optional |
| nestedGeneric | Map<String, List<Integer>> | Map | java.util.Map |

### Extracted TypeReferences
| typeName | kind | position | depth |
|----------|------|----------|-------|
| List | GENERIC | 0 | 0 |
| String | CLASS | 0 | 1 |
| Map | GENERIC | 0 | 0 |
| String | CLASS | 0 | 1 |
| Integer | CLASS | 1 | 1 |
| Map | GENERIC | 0 | 0 |
| String | CLASS | 0 | 1 |
| List | GENERIC | 1 | 1 |
| Integer | CLASS | 0 | 2 |

**Capabilities Demonstrated**:
- ✅ Extracts generic container types
- ✅ Extracts type arguments (nested TypeReferences)
- ✅ Tracks position within type arguments
- ✅ Tracks depth for nested generics
- ✅ Resolves qualified names via imports

---

## Example 5: Array Types

### Input Java Code
```java
package com.example.arrays;

public class ArrayFields {
    private int[] intArray;
    private String[][] stringMatrix;
    private int[][][] threeDimArray;
    private List<String>[] arrayOfLists;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType |
|------|---------------|---------------|
| intArray | int[] | int |
| stringMatrix | String[][] | String |
| threeDimArray | int[][][] | int |
| arrayOfLists | List<String>[] | List |

### Extracted TypeReferences
| typeName | kind | dimensions |
|----------|------|------------|
| int | ARRAY | 1 |
| String | ARRAY | 2 |
| int | ARRAY | 3 |
| List | ARRAY | 1 |
| String | CLASS | 0 |

**Capabilities Demonstrated**:
- ✅ Extracts array types with correct dimension count
- ✅ Identifies base type correctly
- ✅ Handles multi-dimensional arrays
- ✅ Handles generic arrays

---

## Example 6: C-Style Array Declarations

### Input Java Code
```java
package com.example.cstyle;

public class CStyleArrays {
    private int cStyleIntArray[];
    private String cStyleStringArray[];
    private int cStyleMultiDim[][];
    private int mixedStyle[];  // brackets after variable name
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType |
|------|---------------|---------------|
| cStyleIntArray | int[] | int |
| cStyleStringArray | String[] | String |
| cStyleMultiDim | int[][] | int |
| mixedStyle | int[] | int |

### Extracted TypeReferences
| typeName | kind | dimensions |
|----------|------|------------|
| int | ARRAY | 1 |
| String | ARRAY | 1 |
| int | ARRAY | 2 |
| int | ARRAY | 1 |

**Capabilities Demonstrated**:
- ✅ Handles C-style array declarations (`int myArray[]`)
- ✅ Appends dimensions from variable_declarator to type
- ✅ Correctly identifies dimension count for C-style
- ✅ Creates proper ARRAY TypeReference

---

## Example 7: Wildcard Types

### Input Java Code
```java
package com.example.wildcards;

import java.util.List;
import java.util.Map;

public class WildcardFields {
    private List<?> unboundedWildcard;
    private List<? extends Number> upperBounded;
    private List<? super Integer> lowerBounded;
    private Map<String, ? extends Number> mapWithWildcard;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType |
|------|---------------|---------------|
| unboundedWildcard | List<?> | List |
| upperBounded | List<? extends Number> | List |
| lowerBounded | List<? super Integer> | List |
| mapWithWildcard | Map<String, ? extends Number> | Map |

### Extracted TypeReferences
| typeName | kind | boundType |
|----------|------|-----------|
| List | GENERIC | |
| ? | WILDCARD | UNBOUNDED |
| List | GENERIC | |
| ? extends Number | WILDCARD | UPPER |
| List | GENERIC | |
| ? super Integer | WILDCARD | LOWER |

**Capabilities Demonstrated**:
- ✅ Extracts unbounded wildcards (`?`)
- ✅ Extracts upper-bounded wildcards (`? extends T`)
- ✅ Extracts lower-bounded wildcards (`? super T`)
- ✅ Wildcards in complex generic types

---

## Example 8: Multi-Declaration Statements

### Input Java Code
```java
package com.example.multi;

public class MultiDeclaration {
    private int x, y, z;
    private String firstName, lastName;
    public static final int WIDTH = 100, HEIGHT = 200;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | access | modifiers |
|------|---------------|--------|-----------|
| x | int | PRIVATE_ACCESS | [] |
| y | int | PRIVATE_ACCESS | [] |
| z | int | PRIVATE_ACCESS | [] |
| firstName | String | PRIVATE_ACCESS | [] |
| lastName | String | PRIVATE_ACCESS | [] |
| WIDTH | int | PUBLIC_ACCESS | [STATIC, FINAL] |
| HEIGHT | int | PUBLIC_ACCESS | [STATIC, FINAL] |

**Capabilities Demonstrated**:
- ✅ Extracts each variable from multi-declaration
- ✅ Same type applied to all variables
- ✅ Same modifiers applied to all variables

---

## Example 9: Annotated Fields

### Input Java Code
```java
package com.example.annotated;

import javax.annotation.Nullable;
import com.fasterxml.jackson.annotation.JsonProperty;

public class AnnotatedFields {
    @JsonProperty("user_name")
    private String name;
    
    @Nullable
    @Deprecated
    private String legacyField;
    
    @JsonProperty(value = "user_age", required = true)
    private int age;
}
```

### Extracted FieldRegistry
| name | fieldTypeName |
|------|---------------|
| name | String |
| legacyField | String |
| age | int |

### Extracted TypeAnnotations (via AnnotationExtractor)
| annotationName | context | ownerHash |
|----------------|---------|-----------|
| JsonProperty | FIELD | (hash of name field) |
| Nullable | FIELD | (hash of legacyField) |
| Deprecated | FIELD | (hash of legacyField) |
| JsonProperty | FIELD | (hash of age field) |

### Extracted AnnotationArgumentReferences
| argumentName | argumentValue | parentAnnotation |
|--------------|---------------|------------------|
| value | "user_name" | JsonProperty on name |
| value | "user_age" | JsonProperty on age |
| required | true | JsonProperty on age |

**Capabilities Demonstrated**:
- ✅ Extracts field annotations
- ✅ Multiple annotations on same field
- ✅ Links annotations to correct field via hash
- ✅ Extracts annotation arguments

---

## Example 10: Type-Use Annotations (Java 8+)

### Input Java Code
```java
package com.example.typeuse;

import org.checkerframework.checker.nullness.qual.NonNull;
import org.checkerframework.checker.nullness.qual.Nullable;
import java.util.List;
import java.util.Map;

public class TypeUseAnnotations {
    private @NonNull String notNullString;
    private List<@NonNull String> listOfNotNull;
    private Map<@NonNull String, @Nullable Integer> annotatedMap;
}
```

### Extracted FieldRegistry
| name | fieldTypeName |
|------|---------------|
| notNullString | @NonNull String |
| listOfNotNull | List<@NonNull String> |
| annotatedMap | Map<@NonNull String, @Nullable Integer> |

### Extracted TypeAnnotations (TYPE_USE context)
| annotationName | context | depth |
|----------------|---------|-------|
| NonNull | TYPE_USE | 0 |
| NonNull | TYPE_USE | 1 |
| NonNull | TYPE_USE | 1 |
| Nullable | TYPE_USE | 1 |

**Capabilities Demonstrated**:
- ✅ Extracts TYPE_USE annotations on type arguments
- ✅ Links TYPE_USE annotations to TypeReferences
- ✅ Handles multiple TYPE_USE annotations in generics

---

## Example 11: Interface Constants

### Input Java Code
```java
package com.example.constants;

public interface Constants {
    String APP_NAME = "MyApp";
    int MAX_CONNECTIONS = 100;
    double PI = 3.14159;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | access | modifiers |
|------|---------------|--------|-----------|
| APP_NAME | String | PUBLIC_ACCESS | [STATIC, FINAL] |
| MAX_CONNECTIONS | int | PUBLIC_ACCESS | [STATIC, FINAL] |
| PI | double | PUBLIC_ACCESS | [STATIC, FINAL] |

**Capabilities Demonstrated**:
- ✅ Interface fields are implicitly `public static final`
- ✅ Handles `constant_declaration` nodes in interfaces
- ✅ Correct access and modifiers applied

---

## Example 12: Fully Qualified Type Names

### Input Java Code
```java
package com.example.fqn;

public class FullyQualifiedTypes {
    private java.util.List<java.lang.String> fullyQualifiedList;
    private java.util.Map<java.lang.String, java.lang.Integer> fullyQualifiedMap;
    private java.util.concurrent.ConcurrentHashMap<String, Object> concurrentMap;
}
```

### Extracted FieldRegistry
| name | fieldTypeName | fieldBaseType | potentialQualifiedName |
|------|---------------|---------------|------------------------|
| fullyQualifiedList | java.util.List<java.lang.String> | java.util.List | java.util.List |
| fullyQualifiedMap | java.util.Map<java.lang.String, java.lang.Integer> | java.util.Map | java.util.Map |
| concurrentMap | java.util.concurrent.ConcurrentHashMap<String, Object> | java.util.concurrent.ConcurrentHashMap | java.util.concurrent.ConcurrentHashMap |

**Capabilities Demonstrated**:
- ✅ Handles fully qualified type names in source
- ✅ Base type extraction for scoped types
- ✅ Qualified name preserved correctly

---

## Tree-Sitter Node Structure

For reference, here's how tree-sitter parses field declarations:

```
class_declaration
├── modifiers (public)
├── "class"
├── identifier: "Example"
└── class_body
    ├── "{"
    ├── field_declaration
    │   ├── modifiers
    │   │   ├── private
    │   │   ├── static
    │   │   └── final
    │   ├── type_identifier: "String"  (or generic_type, array_type, etc.)
    │   └── variable_declarator
    │       ├── identifier: "name"
    │       ├── "="
    │       └── string_literal: "\"value\""
    ├── field_declaration (multi-declaration)
    │   ├── modifiers
    │   │   └── private
    │   ├── integral_type: "int"
    │   ├── variable_declarator
    │   │   └── identifier: "x"
    │   ├── ","
    │   ├── variable_declarator
    │   │   └── identifier: "y"
    │   ├── ","
    │   └── variable_declarator
    │       └── identifier: "z"
    └── "}"
```

### C-Style Arrays
```
field_declaration
├── modifiers
│   └── private
├── integral_type: "int"
└── variable_declarator
    ├── identifier: "myArray"
    └── dimensions: "[][]"
```

---

## Type Node Types

The extractor recognizes these type node types:

| Node Type | Example |
|-----------|---------|
| `type_identifier` | `String`, `MyClass` |
| `scoped_type_identifier` | `java.util.List`, `com.example.User` |
| `generic_type` | `List<String>`, `Map<K, V>` |
| `array_type` | `String[]`, `int[][]` |
| `integral_type` | `int`, `long`, `short`, `byte` |
| `floating_point_type` | `float`, `double` |
| `boolean_type` | `boolean` |

---

## Base Type Extraction Examples

| Full Type Name | Extracted Base Type |
|----------------|---------------------|
| `String` | `String` |
| `List<String>` | `List` |
| `Map<String, Integer>` | `Map` |
| `String[]` | `String` |
| `int[][]` | `int` |
| `@NonNull String` | `String` |
| `String @NonNull []` | `String` |
| `List<@NonNull String>` | `List` |
| `java.util.List<String>` | `java.util.List` |

---

## Related Extractors

- **TypeReferenceExtractor**: Extracts detailed type references for complex types
- **AnnotationExtractor**: Extracts annotations on fields and TYPE_USE annotations
- **TypeRegistryExtractor**: Extracts the parent type declaration
- **EnumConstantExtractor**: Handles enum constant extraction (separate from fields)
