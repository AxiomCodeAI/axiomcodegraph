# TypeReferenceExtractor - Examples

This document shows concrete examples of what the TypeReferenceExtractor can extract from Java source code.

## Overview

The TypeReferenceExtractor identifies and extracts **type usage** - every place in the code where types are referenced: field types, method signatures, inheritance, generic arguments, array types, wildcards, and more.

## What It Extracts

For each type reference, it captures:
- **Type name**: Simple or qualified type name
- **Kind**: CLASS, PRIMITIVE, ARRAY, PARAMETERIZED, TYPE_VARIABLE, WILDCARD
- **Context**: Where it appears (FIELD_TYPE, RETURN_TYPE, PARAMETER_TYPE, etc.)
- **Owner**: What contains this reference (field, method, type parameter bound, etc.)
- **Position**: Order in parameter lists or generic arguments
- **Wildcard variance**: EXTENDS or SUPER for wildcards
- **Generic arguments**: Nested type references for parameterized types
- **Array dimensions**: For array types

---

## Example 1: Simple Field Type

### Input Java Code
```java
package com.example.model;

public class User {
    private String username;
    private int age;
}
```

### Extracted TypeReferences
```csv
1. typeName: String
   kind: CLASS
   context: FIELD_TYPE
   ownerKind: FIELD
   position: 0

2. typeName: int
   kind: PRIMITIVE
   context: FIELD_TYPE
   ownerKind: FIELD
   position: 0
```

**Capabilities Demonstrated**:
- ✅ Extracts field type references
- ✅ Distinguishes CLASS vs PRIMITIVE
- ✅ Tracks FIELD_TYPE context

---

## Example 2: Method Return Type and Parameters

### Input Java Code
```java
package com.example.service;

public class Calculator {
    
    public double add(int a, int b) {
        return a + b;
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: double
   kind: PRIMITIVE
   context: RETURN_TYPE
   ownerKind: METHOD_RETURN

2. typeName: int
   kind: PRIMITIVE
   context: PARAMETER_TYPE
   ownerKind: METHOD_PARAMETER
   position: 0

3. typeName: int
   kind: PRIMITIVE
   context: PARAMETER_TYPE
   ownerKind: METHOD_PARAMETER
   position: 1
```

**Capabilities Demonstrated**:
- ✅ Extracts return types
- ✅ Extracts parameter types
- ✅ Tracks parameter position

---

## Example 3: Generic Type (Parameterized)

### Input Java Code
```java
package com.example.collections;

public class ListHolder {
    private List<String> items;
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   context: FIELD_TYPE
   ownerKind: FIELD
   (has nested type argument reference)

2. typeName: String
   kind: CLASS
   context: GENERIC_ARGUMENT
   position: 0
   parentReference: (reference to List above)
```

**Capabilities Demonstrated**:
- ✅ Identifies parameterized types
- ✅ Extracts generic type arguments
- ✅ Creates nested reference hierarchy

---

## Example 4: Multiple Generic Arguments (Map)

### Input Java Code
```java
package com.example.cache;

public class Cache {
    private Map<String, User> userCache;
}
```

### Extracted TypeReferences
```csv
1. typeName: Map
   kind: PARAMETERIZED
   context: FIELD_TYPE

2. typeName: String
   kind: CLASS
   context: GENERIC_ARGUMENT
   position: 0
   (key type)

3. typeName: User
   kind: CLASS
   context: GENERIC_ARGUMENT
   position: 1
   (value type)
```

**Capabilities Demonstrated**:
- ✅ Handles multiple type arguments
- ✅ Maintains argument position order

---

## Example 5: Nested Generics

### Input Java Code
```java
package com.example.complex;

public class ComplexHolder {
    private List<Map<String, Integer>> complexData;
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   
2. typeName: Map
   kind: PARAMETERIZED
   context: GENERIC_ARGUMENT
   position: 0
   parentReference: (List above)
   
3. typeName: String
   kind: CLASS
   context: GENERIC_ARGUMENT
   position: 0
   parentReference: (Map above)
   
4. typeName: Integer
   kind: CLASS
   context: GENERIC_ARGUMENT
   position: 1
   parentReference: (Map above)
```

**Capabilities Demonstrated**:
- ✅ Handles arbitrarily nested generics
- ✅ Maintains parent-child relationships
- ✅ Correct position tracking at each level

---

## Example 6: Array Type

### Input Java Code
```java
package com.example.arrays;

public class ArrayExample {
    private String[] names;
    private int[][] matrix;
}
```

### Extracted TypeReferences
```csv
1. typeName: String[]
   kind: ARRAY
   context: FIELD_TYPE
   arrayDimensions: 1
   elementType: String

2. typeName: int[][]
   kind: ARRAY
   context: FIELD_TYPE
   arrayDimensions: 2
   elementType: int
```

**Capabilities Demonstrated**:
- ✅ Identifies array types
- ✅ Tracks array dimensions
- ✅ Extracts element type

---

## Example 7: Wildcard - Unbounded

### Input Java Code
```java
package com.example.wildcards;

public class WildcardExample {
    
    public void process(List<?> items) {
        // unbounded wildcard
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   
2. typeName: ?
   kind: WILDCARD
   context: GENERIC_ARGUMENT
   variance: (none/unbounded)
```

**Capabilities Demonstrated**:
- ✅ Detects wildcard types
- ✅ Handles unbounded wildcards

---

## Example 8: Wildcard - Upper Bound (extends)

### Input Java Code
```java
package com.example.bounds;

public class BoundedWildcard {
    
    public void processNumbers(List<? extends Number> numbers) {
        // upper bounded wildcard
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   
2. typeName: ? extends Number
   kind: WILDCARD
   context: GENERIC_ARGUMENT
   variance: EXTENDS
   bound: Number
   
3. typeName: Number
   kind: CLASS
   context: WILDCARD_BOUND
```

**Capabilities Demonstrated**:
- ✅ Captures EXTENDS variance
- ✅ Extracts wildcard bound
- ✅ Creates reference for bound type

---

## Example 9: Wildcard - Lower Bound (super)

### Input Java Code
```java
package com.example.bounds;

public class LowerBounded {
    
    public void addIntegers(List<? super Integer> numbers) {
        // lower bounded wildcard
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   
2. typeName: ? super Integer
   kind: WILDCARD
   variance: SUPER
   bound: Integer
   
3. typeName: Integer
   kind: CLASS
   context: WILDCARD_BOUND
```

**Capabilities Demonstrated**:
- ✅ Captures SUPER variance
- ✅ Handles lower bounds

---

## Example 10: Inheritance (extends)

### Input Java Code
```java
package com.example.inheritance;

public class UserService extends BaseService {
    // implementation
}
```

### Extracted TypeReferences
```csv
typeName: BaseService
kind: CLASS
context: INHERITANCE
ownerKind: EXTENDS_CLAUSE
```

**Capabilities Demonstrated**:
- ✅ Extracts superclass references
- ✅ INHERITANCE context
- ✅ EXTENDS_CLAUSE owner

---

## Example 11: Interface Implementation

### Input Java Code
```java
package com.example.interfaces;

public class ArrayList<E> implements List<E>, Serializable {
    // implementation
}
```

### Extracted TypeReferences
```csv
1. typeName: List
   kind: PARAMETERIZED
   context: INHERITANCE
   ownerKind: IMPLEMENTS_CLAUSE
   
2. typeName: E (type variable)
   kind: TYPE_VARIABLE
   context: GENERIC_ARGUMENT
   
3. typeName: Serializable
   kind: CLASS
   context: INHERITANCE
   ownerKind: IMPLEMENTS_CLAUSE
```

**Capabilities Demonstrated**:
- ✅ Multiple interface implementations
- ✅ IMPLEMENTS_CLAUSE owner
- ✅ Generic interfaces
- ✅ Type variable usage

---

## Example 12: Sealed Class - Permits Clause (Java 15+)

### Input Java Code
```java
package com.example.sealed;

public sealed class Shape 
    permits Circle, Rectangle, Triangle {
    // implementation
}

final class Circle extends Shape {
}

final class Rectangle extends Shape {
}

final class Triangle extends Shape {
}
```

### Extracted TypeReferences
```csv
1. typeName: Circle
   kind: CLASS
   context: PERMITS
   ownerKind: TYPE
   position: 0

2. typeName: Rectangle
   kind: CLASS
   context: PERMITS
   ownerKind: TYPE
   position: 1

3. typeName: Triangle
   kind: CLASS
   context: PERMITS
   ownerKind: TYPE
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Extracts permits clause types (sealed classes)
- ✅ PERMITS context
- ✅ TYPE owner kind
- ✅ Position tracking for multiple permitted subtypes
- ✅ Modern Java 15+ feature support

---

## Example 13: Type Variable Usage

### Input Java Code
```java
package com.example.generics;

public class Box<T> {
    private T value;
    
    public T getValue() {
        return value;
    }
    
    public void setValue(T newValue) {
        this.value = newValue;
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: T
   kind: TYPE_VARIABLE
   context: FIELD_TYPE
   
2. typeName: T
   kind: TYPE_VARIABLE
   context: RETURN_TYPE
   
3. typeName: T
   kind: TYPE_VARIABLE
   context: PARAMETER_TYPE
```

**Capabilities Demonstrated**:
- ✅ Identifies type variable usage
- ✅ Distinguishes from class references
- ✅ Tracks usage contexts

---

## Example 14: Type Parameter Bounds

### Input Java Code
```java
package com.example.bounds;

public class Comparable<T extends Number & Serializable> {
    private T value;
}
```

### Extracted TypeReferences
```csv
1. typeName: Number
   kind: CLASS
   context: TYPE_PARAMETER_BOUND
   ownerKind: TYPE_PARAMETER_BOUND
   position: 0
   
2. typeName: Serializable
   kind: CLASS
   context: TYPE_PARAMETER_BOUND
   ownerKind: TYPE_PARAMETER_BOUND
   position: 1
```

**Capabilities Demonstrated**:
- ✅ Extracts bounds from type parameters
- ✅ Multiple bounds tracked
- ✅ TYPE_PARAMETER_BOUND context

---

## Example 15: Constructor Parameters

### Input Java Code
```java
package com.example.constructors;

public class User {
    
    public User(String name, int age, Address address) {
        // constructor
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: String
   kind: CLASS
   context: PARAMETER_TYPE
   ownerKind: CONSTRUCTOR_PARAMETER
   position: 0
   
2. typeName: int
   kind: PRIMITIVE
   context: PARAMETER_TYPE
   ownerKind: CONSTRUCTOR_PARAMETER
   position: 1
   
3. typeName: Address
   kind: CLASS
   context: PARAMETER_TYPE
   ownerKind: CONSTRUCTOR_PARAMETER
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Constructor parameter extraction
- ✅ CONSTRUCTOR_PARAMETER owner kind

---

## Example 16: Throws Clause

### Input Java Code
```java
package com.example.exceptions;

public class FileProcessor {
    
    public void readFile(String path) throws IOException, FileNotFoundException {
        // implementation
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: IOException
   kind: CLASS
   context: EXCEPTION_TYPE
   ownerKind: THROWS_CLAUSE
   position: 0
   
2. typeName: FileNotFoundException
   kind: CLASS
   context: EXCEPTION_TYPE
   ownerKind: THROWS_CLAUSE
   position: 1
```

**Capabilities Demonstrated**:
- ✅ Extracts exception types
- ✅ THROWS_CLAUSE owner
- ✅ EXCEPTION_TYPE context

---

## Example 17: Local Variable Types

### Input Java Code
```java
package com.example.locals;

public class LocalExample {
    
    public void process() {
        String name = "test";
        List<Integer> numbers = new ArrayList<>();
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: String
   kind: CLASS
   context: LOCAL_VARIABLE_TYPE
   ownerKind: LOCAL_VARIABLE
   
2. typeName: List
   kind: PARAMETERIZED
   context: LOCAL_VARIABLE_TYPE
   
3. typeName: Integer
   kind: CLASS
   context: GENERIC_ARGUMENT
   
4. typeName: ArrayList
   kind: PARAMETERIZED
   (from new ArrayList<>())
```

**Capabilities Demonstrated**:
- ✅ Local variable type extraction
- ✅ LOCAL_VARIABLE context
- ✅ Diamond operator handling

---

## Example 18: Cast Expressions

### Input Java Code
```java
package com.example.casts;

public class CastExample {
    
    public void process(Object obj) {
        String str = (String) obj;
        List<String> list = (List<String>) obj;
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: Object
   kind: CLASS
   context: PARAMETER_TYPE
   
2. typeName: String
   kind: CLASS
   context: CAST_TYPE
   
3. typeName: List
   kind: PARAMETERIZED
   context: CAST_TYPE
   
4. typeName: String
   kind: CLASS
   context: GENERIC_ARGUMENT
```

**Capabilities Demonstrated**:
- ✅ Extracts cast type references
- ✅ CAST_TYPE context
- ✅ Generic casts

---

## Example 19: instanceof Checks

### Input Java Code
```java
package com.example.instanceof;

public class TypeCheck {
    
    public boolean isString(Object obj) {
        return obj instanceof String;
    }
}
```

### Extracted TypeReferences
```csv
1. typeName: String
   kind: CLASS
   context: INSTANCEOF_TYPE
```

**Capabilities Demonstrated**:
- ✅ instanceof type extraction
- ✅ INSTANCEOF_TYPE context

---

## Example 20: Generic Array Creation

### Input Java Code
```java
package com.example.arrays;

public class GenericArray<T> {
    private List<T>[] arrayOfLists;
}
```

### Extracted TypeReferences
```csv
1. typeName: List<T>[]
   kind: ARRAY
   arrayDimensions: 1
   
2. typeName: List
   kind: PARAMETERIZED
   (element type)
   
3. typeName: T
   kind: TYPE_VARIABLE
   context: GENERIC_ARGUMENT
```

**Capabilities Demonstrated**:
- ✅ Generic array types
- ✅ Combines ARRAY + PARAMETERIZED
- ✅ Nested type structure

---

## Example 21: Record Components

### Input Java Code
```java
package com.example.records;

public record User(String name, int age, List<String> emails) {
}
```

### Extracted TypeReferences
```csv
1. typeName: String
   kind: CLASS
   context: RECORD_COMPONENT_TYPE
   
2. typeName: int
   kind: PRIMITIVE
   context: RECORD_COMPONENT_TYPE
   
3. typeName: List
   kind: PARAMETERIZED
   context: RECORD_COMPONENT_TYPE
   
4. typeName: String
   kind: CLASS
   context: GENERIC_ARGUMENT
```

**Capabilities Demonstrated**:
- ✅ Record component extraction
- ✅ RECORD_COMPONENT_TYPE context
- ✅ Modern Java support

---

---

## Summary of Extraction Capabilities

### ✅ Type Kinds

- **CLASS**: Regular class references
- **PRIMITIVE**: int, boolean, char, etc.
- **ARRAY**: Any array type with dimensions
- **PARAMETERIZED**: Generic types with arguments
- **TYPE_VARIABLE**: T, E, K, V usage
- **WILDCARD**: ?, ? extends, ? super

### ✅ Contexts

- **FIELD_TYPE**: Field declarations
- **RETURN_TYPE**: Method return types
- **PARAMETER_TYPE**: Method/constructor parameters
- **LOCAL_VARIABLE_TYPE**: Local variables
- **GENERIC_ARGUMENT**: Type arguments in generics
- **INHERITANCE**: extends/implements clauses
- **PERMITS**: permits clause (sealed types)
- **TYPE_PARAMETER_BOUND**: Bounds on type parameters (e.g., `<T extends Number>`)
- **TYPE_PARAMETER_ANNOTATION**: Class references in type parameter annotations (e.g., `<@Validated(validator=X.class) T>`)
- **WILDCARD_BOUND**: Bounds on wildcards
- **EXCEPTION_TYPE**: Throws clauses
- **CAST_TYPE**: Type casts
- **INSTANCEOF_TYPE**: instanceof checks
- **RECORD_COMPONENT_TYPE**: Record components
- **ANNOTATION_PARAM**: Type references in annotation arguments (general)

### ✅ Owner Kinds

- **FIELD**: Field declarations
- **METHOD_RETURN**: Method return
- **METHOD_PARAMETER**: Method parameters
- **CONSTRUCTOR_PARAMETER**: Constructor parameters
- **LOCAL_VARIABLE**: Local variables
- **EXTENDS_CLAUSE**: Superclass
- **IMPLEMENTS_CLAUSE**: Interfaces
- **TYPE_PARAMETER**: Type parameter declarations
- **ANNOTATION_ARGUMENT**: Annotation argument values (for class literals in annotations)
- **THROWS_CLAUSE**: Exception declarations

### 🎯 Special Handling

**Wildcards**:
- Unbounded: `<?>`
- Upper bound: `<? extends T>` (EXTENDS variance)
- Lower bound: `<? super T>` (SUPER variance)

**Arrays**:
- Tracks dimensions (1D, 2D, 3D, etc.)
- Extracts element type
- Handles generic arrays

**Nested Generics**:
- Unlimited nesting depth
- Parent-child relationships maintained
- Position tracking at each level

**Annotated Types**:
- Unwraps `annotated_type` nodes to extract the actual type
- Example: `<T extends @Anno Number>` extracts `Number` as the bound
- Type use annotations on the type itself are not currently extracted

### 📊 Coordination

TypeReferenceExtractor is called by:
- **TypeRegistryExtractor** - for superclass/interfaces
- **TypeParameterExtractor** - for type parameter bounds
- **AnnotationExtractor** - for class literal and enum constant references in annotation arguments

It creates hierarchical reference structures for complex types like `Map<String, List<Integer>>`.

---

## Example: Type References from Type Parameter Annotations

### Input Java Code
```java
package com.inventory.auth.domain;

public class ValidatedContainer<
    @Validated(validator = StringValidator.class, groups = ValidationGroup.class) S
> {
    private S value;
}
```

### Extracted TypeReferences (from annotation arguments)
```csv
1. typeName: StringValidator
   kind: CLASS
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash_of_validator_arg>
   position: 0
   depth: 0

2. typeName: ValidationGroup
   kind: CLASS
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash_of_groups_arg>
   position: 0
   depth: 0
```

**Key Points**:
- These are extracted from **class literal arguments** in annotations on type parameters
- Context is `TYPE_PARAMETER_ANNOTATION` (distinguishes these from regular annotation arguments)
- Owner is `ANNOTATION_ARGUMENT` - the immediate source that contains the class literal
- This allows direct linkage: `TypeReference` → `AnnotationArgument` → `Annotation` → `TypeParameter`
- Position is 0 because each is a single class reference within its argument

**Linkage Path**:
To find the type parameter from a TYPE_PARAMETER_ANNOTATION type reference:
1. Use `typeReferenceOwnerHash` to find the `AnnotationArgumentReference`
2. Use `parentAnnotationHash` from the argument to find the `TypeAnnotation`
3. Use `typeParameterHash` from the annotation to find the `TypeParameter`

This design keeps direct linkability while the context provides semantic meaning.
