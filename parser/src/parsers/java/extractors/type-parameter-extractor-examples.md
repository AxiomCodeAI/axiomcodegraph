# TypeParameterExtractor - Examples

This document shows concrete examples of what the TypeParameterExtractor can extract from Java source code.

## Overview

The TypeParameterExtractor identifies and extracts **generic type parameters** - the `<T>`, `<E>`, `<K, V>` declarations that enable compile-time type safety and code reusability in Java.

## What It Extracts

For each type parameter, it captures:
- **Name**: T, E, K, V, etc.
- **Position**: Order in parameter list (0, 1, 2, ...)
- **Context**: Where declared (TYPE or METHOD)
- **Owner**: Hash of the type or method that declares it
- **Bounds**: Upper bounds (extends clauses)
- **Annotations**: Annotations applied to the type parameter (Java 8+)
- **Annotation Arguments**: Arguments of annotations, including class references
- **Location**: startLine, endLine

---

## Example 1: Simple Generic Class

### Input Java Code
```java
package com.example.container;

public class Box<T> {
    private T value;
    
    public T getValue() {
        return value;
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
ownerHash: TYPE_REGISTRY_<hash_of_Box>
bounds: (none)
```

**Capabilities Demonstrated**:
- ✅ Extracts unbounded type parameter
- ✅ Associates with owning type
- ✅ Tracks position in parameter list

---

## Example 2: Multiple Type Parameters

### Input Java Code
```java
package com.example.collections;

public class Pair<K, V> {
    private K key;
    private V value;
    
    public K getKey() { return key; }
    public V getValue() { return value; }
}
```

### Extracted TypeParameters
```csv
1. name: K
   position: 0
   context: TYPE
   ownerHash: TYPE_REGISTRY_<hash_of_Pair>

2. name: V
   position: 1
   context: TYPE
   ownerHash: TYPE_REGISTRY_<hash_of_Pair>
```

**Capabilities Demonstrated**:
- ✅ Extracts multiple parameters
- ✅ Maintains correct position order

---

## Example 3: Bounded Type Parameter (Single Bound)

### Input Java Code
```java
package com.example.math;

public class Calculator<T extends Number> {
    public double sum(T a, T b) {
        return a.doubleValue() + b.doubleValue();
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
bounds: ["Number"]
```

**Note**: The bound "Number" creates a TypeReference that links to the Number class.

**Capabilities Demonstrated**:
- ✅ Extracts bounded type parameters
- ✅ Captures extends clause
- ✅ Creates type reference for bound

---

## Example 4: Multiple Bounds (Interface Constraints)

### Input Java Code
```java
package com.example.sorting;

public class Sorter<T extends Comparable<T> & Serializable> {
    public void sort(List<T> items) {
        Collections.sort(items);
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
bounds: ["Comparable<T>", "Serializable"]
```

**Note**: Both bounds create separate TypeReference entries.

**Capabilities Demonstrated**:
- ✅ Handles multiple bounds with `&`
- ✅ Extracts parameterized bounds (Comparable<T>)
- ✅ Maintains bound order

---

## Example 5: Recursive Type Bound

### Input Java Code
```java
package com.example.comparable;

public class RecursiveBound<T extends Comparable<T>> {
    public T max(T a, T b) {
        return a.compareTo(b) > 0 ? a : b;
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
bounds: ["Comparable<T>"]
```

**Note**: The recursive reference `Comparable<T>` is properly handled.

**Capabilities Demonstrated**:
- ✅ Handles self-referential bounds
- ✅ Common pattern: `T extends Comparable<T>`

---

## Example 6: Generic Method

### Input Java Code
```java
package com.example.util;

public class ArrayUtils {
    
    public static <T> T[] reverse(T[] array) {
        // implementation
        return array;
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: METHOD
ownerHash: METHOD_<hash_of_reverse>
bounds: (none)
```

**Capabilities Demonstrated**:
- ✅ Extracts method-level type parameters
- ✅ Distinguishes METHOD context from TYPE context
- ✅ Associates with owning method

---

## Example 7: Generic Method with Bounds

### Input Java Code
```java
package com.example.collections;

public class CollectionUtils {
    
    public static <T extends Comparable<T>> T findMax(Collection<T> items) {
        return Collections.max(items);
    }
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: METHOD
bounds: ["Comparable<T>"]
```

**Capabilities Demonstrated**:
- ✅ Bounded method type parameters
- ✅ Works same as class-level bounds

---

## Example 8: Multiple Method Type Parameters

### Input Java Code
```java
package com.example.converter;

public class Converter {
    
    public static <S, T> T convert(S source, Function<S, T> mapper) {
        return mapper.apply(source);
    }
}
```

### Extracted TypeParameters
```csv
1. name: S
   position: 0
   context: METHOD

2. name: T
   position: 1
   context: METHOD
```

**Capabilities Demonstrated**:
- ✅ Multiple method parameters
- ✅ Position tracking

---

## Example 9: Nested Generic Types

### Input Java Code
```java
package com.example.nested;

public class OuterGeneric<T> {
    
    public class InnerGeneric<U> {
        private T outerValue;
        private U innerValue;
    }
}
```

### Extracted TypeParameters
```csv
1. name: T
   position: 0
   context: TYPE
   ownerHash: TYPE_REGISTRY_<hash_of_OuterGeneric>

2. name: U
   position: 0
   context: TYPE
   ownerHash: TYPE_REGISTRY_<hash_of_InnerGeneric>
```

**Capabilities Demonstrated**:
- ✅ Handles nested generic types
- ✅ Each type has its own parameters
- ✅ Parameters scoped to their owner

---

## Example 10: Generic Interface

### Input Java Code
```java
package com.example.factory;

public interface Factory<T> {
    T create();
    void destroy(T instance);
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
ownerHash: TYPE_REGISTRY_<hash_of_Factory_interface>
```

**Capabilities Demonstrated**:
- ✅ Works with interfaces
- ✅ Same extraction as classes

---

## Example 11: Wildcard Bounds (Not Type Parameters)

### Input Java Code
```java
package com.example.collections;

public class WildcardExample {
    
    public void process(List<? extends Number> numbers) {
        // Wildcard, not a type parameter
    }
}
```

### Extracted TypeParameters
```csv
(none - wildcards are TypeReferences, not TypeParameters)
```

**Important**: `? extends Number` is a **wildcard**, extracted by TypeReferenceExtractor, not TypeParameterExtractor.

**Capabilities Demonstrated**:
- ✅ Correctly distinguishes type parameters from wildcards
- ✅ No false extraction of wildcards

---

## Example 12: Complex Bounded Parameter

### Input Java Code
```java
package com.example.advanced;

public class AdvancedContainer<T extends List<? extends Serializable> & Comparable<T>> {
    private T value;
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
bounds: ["List<? extends Serializable>", "Comparable<T>"]
```

**Capabilities Demonstrated**:
- ✅ Handles complex parameterized bounds
- ✅ Preserves wildcard syntax in bounds
- ✅ Multiple complex bounds

---

## Example 13: Generic Record (Java 14+)

### Input Java Code
```java
package com.example.dto;

public record Wrapper<T>(T value, String metadata) {
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
ownerHash: TYPE_REGISTRY_<hash_of_Wrapper_record>
```

**Capabilities Demonstrated**:
- ✅ Supports modern Java records
- ✅ Works with record declarations

---

## Example 14: Three Type Parameters

### Input Java Code
```java
package com.example.triple;

public class Triple<A, B, C> {
    private A first;
    private B second;
    private C third;
}
```

### Extracted TypeParameters
```csv
1. name: A
   position: 0

2. name: B
   position: 1

3. name: C
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Handles arbitrary number of parameters
- ✅ Position tracking for many parameters

---

## Example 15: Generic Enum (Edge Case)

### Input Java Code
```java
package com.example.enums;

public enum Operation {
    PLUS {
        public <T extends Number> double apply(T a, T b) {
            return a.doubleValue() + b.doubleValue();
        }
    };
    
    public abstract <T extends Number> double apply(T a, T b);
}
```

### Extracted TypeParameters
```csv
(Method-level T parameters from apply methods)
name: T
context: METHOD
bounds: ["Number"]
```

**Note**: Enum constants can have generic methods, which have extractable type parameters.

**Capabilities Demonstrated**:
- ✅ Handles method parameters in enums
- ✅ Works in complex enum structures

---

## Example 16: Type Parameter with Annotation (Java 8+)

### Input Java Code
```java
package com.inventory.auth.domain;

public class GenericsTortureTest<@TypeAnno("Outer") T> {
    private T value;
}
```

### Extracted TypeParameter
```csv
name: T
position: 0
context: TYPE
ownerHash: TYPE_REGISTRY_<hash_of_GenericsTortureTest>
bounds: (none)
```

### Extracted TypeAnnotation
```csv
annotationName: TypeAnno
kind: SINGLE_VALUE
context: TYPE_PARAMETER
ownerHash: TYPE_PARAMETER_<hash_of_T>
typeParameterHash: TYPE_PARAMETER_<hash_of_T>
position: 0
depth: 0
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: "Outer"
valueType: STRING_LITERAL
position: 0
parentAnnotationHash: TYPE_ANNOTATION_<hash_of_TypeAnno>
```

**Capabilities Demonstrated**:
- ✅ Extracts annotations on type parameters
- ✅ TYPE_PARAMETER context for annotations
- ✅ Links annotation to type parameter via hash
- ✅ Extracts annotation arguments with correct parent linkage

---

## Example 17: Multiple Annotations on Type Parameters

### Input Java Code
```java
package com.inventory.auth.domain;

public class ValidatedContainer<
    @Validated(validator = StringValidator.class) S,
    @Validated(validator = NumberValidator.class, groups = ValidationGroup.class) N
> {
    private S stringValue;
    private N numberValue;
}
```

### Extracted TypeParameters
```csv
1. name: S
   position: 0
   context: TYPE

2. name: N
   position: 1
   context: TYPE
```

### Extracted TypeAnnotations
```csv
1. annotationName: Validated
   kind: NAMED_ARGUMENTS
   context: TYPE_PARAMETER
   ownerHash: TYPE_PARAMETER_<hash_of_S>
   typeParameterHash: TYPE_PARAMETER_<hash_of_S>
   position: 0

2. annotationName: Validated
   kind: NAMED_ARGUMENTS
   context: TYPE_PARAMETER
   ownerHash: TYPE_PARAMETER_<hash_of_N>
   typeParameterHash: TYPE_PARAMETER_<hash_of_N>
   position: 0
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: validator
   argumentValue: StringValidator
   valueType: CLASS_REFERENCE
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated_on_S>

2. argumentName: validator
   argumentValue: NumberValidator
   valueType: CLASS_REFERENCE
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated_on_N>

3. argumentName: groups
   argumentValue: ValidationGroup
   valueType: CLASS_REFERENCE
   position: 1
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated_on_N>
```

### Extracted TypeReferences (from annotation arguments)
```csv
1. typeName: StringValidator
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash>

2. typeName: NumberValidator
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash>

3. typeName: ValidationGroup
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash>
```

**Capabilities Demonstrated**:
- ✅ Multiple type parameters with different annotations
- ✅ Named annotation arguments (validator, groups)
- ✅ Class reference arguments extracted
- ✅ Type references created for class literals in annotation arguments
- ✅ Correct position tracking for multiple arguments

---

## Example 18: Nested Annotations on Type Parameters

### Input Java Code
```java
package com.inventory.auth.domain;

public class NestedAnnotationTest<
    @Wrapper(value = "NestedValue", inner = @TypeAnno("Inner")) K
> {
    private K key;
}
```

### Extracted TypeParameter
```csv
name: K
position: 0
context: TYPE
```

### Extracted TypeAnnotations
```csv
1. annotationName: Wrapper
   kind: NESTED
   context: TYPE_PARAMETER
   ownerHash: TYPE_PARAMETER_<hash_of_K>
   typeParameterHash: TYPE_PARAMETER_<hash_of_K>
   position: 0
   depth: 0

2. annotationName: TypeAnno
   kind: SINGLE_VALUE
   context: TYPE_PARAMETER
   ownerHash: TYPE_PARAMETER_<hash_of_K>
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Wrapper>
   depth: 1
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: value
   argumentValue: "NestedValue"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Wrapper>

2. argumentName: inner
   argumentValue: TypeAnno
   valueType: NESTED_ANNOTATION
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Wrapper>
   nestedAnnotationHash: TYPE_ANNOTATION_<hash_of_TypeAnno>

3. argumentName: value
   argumentValue: "Inner"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_TypeAnno>
```

**Capabilities Demonstrated**:
- ✅ Nested annotations on type parameters
- ✅ Parent-child annotation linking via parentAnnotationHash
- ✅ Depth tracking (0 for outer, 1 for nested)
- ✅ Arguments from both outer and nested annotations
- ✅ NESTED_ANNOTATION value type

---

## Example 19: Mixed Simple and Complex Annotations

### Input Java Code
```java
package com.inventory.auth.domain;

public class MixedAnnotations<
    @TypeAnno("Simple") A,
    @Validated(validator = CustomValidator.class, groups = ValidationGroup.class, message = "Invalid") C
> {
    private A first;
    private C second;
}
```

### Extracted TypeParameters
```csv
1. name: A
   position: 0

2. name: C
   position: 1
```

### Extracted TypeAnnotations
```csv
1. annotationName: TypeAnno
   kind: SINGLE_VALUE
   context: TYPE_PARAMETER
   typeParameterHash: TYPE_PARAMETER_<hash_of_A>
   position: 0

2. annotationName: Validated
   kind: NAMED_ARGUMENTS
   context: TYPE_PARAMETER
   typeParameterHash: TYPE_PARAMETER_<hash_of_C>
   position: 0
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: value
   argumentValue: "Simple"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_TypeAnno>

2. argumentName: validator
   argumentValue: CustomValidator
   valueType: CLASS_REFERENCE
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated>

3. argumentName: groups
   argumentValue: ValidationGroup
   valueType: CLASS_REFERENCE
   position: 1
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated>

4. argumentName: message
   argumentValue: "Invalid"
   valueType: STRING_LITERAL
   position: 2
   parentAnnotationHash: TYPE_ANNOTATION_<hash_of_Validated>
```

**Capabilities Demonstrated**:
- ✅ Mix of SINGLE_VALUE and NAMED_ARGUMENTS annotations
- ✅ Multiple arguments with different value types
- ✅ Correct position tracking across different annotations
- ✅ No argument cross-contamination between type parameters

---

## Example 20: Type Parameter with Annotation AND Bound

### Input Java Code
```java
package com.inventory.auth.domain;

public class ComplexBounds<
    R extends @TypeAnno("Bound") Number & Comparable<R> & Serializable
> {
    private R value;
}
```

### Extracted TypeParameter
```csv
name: R
position: 0
context: TYPE
bounds: ["Number", "Comparable<R>", "Serializable"]
```

### Extracted TypeAnnotation
```csv
(none - annotation on the bound type, not the type parameter)
```

### Extracted TypeReferences (from bounds)
```csv
1. typeName: Number
   context: TYPE_PARAM_BOUND
   ownerKind: TYPE_PARAMETER
   ownerHash: TYPE_PARAMETER_<hash_of_R>

2. typeName: Comparable
   context: TYPE_PARAM_BOUND
   (with type argument R)

3. typeName: Serializable
   context: TYPE_PARAM_BOUND
```

**Note**: `@TypeAnno("Bound")` is a **type use annotation** on the bound `Number`, not a type parameter annotation. This is currently NOT extracted as it requires separate type use annotation extraction logic.

**Capabilities Demonstrated**:
- ✅ Extracts all bounds including annotated types
- ✅ Unwraps `annotated_type` nodes to find actual type
- ✅ Multiple bounds with `&` separator
- ⚠️ Type use annotations on bounds are not extracted (future feature)

---

## Summary of Extraction Capabilities

### ✅ Fully Supported

- **Unbounded parameters**: `<T>`, `<E>`, `<K, V>`
- **Single bounds**: `<T extends Number>`
- **Multiple bounds**: `<T extends Comparable<T> & Serializable>`
- **Recursive bounds**: `<T extends Comparable<T>>`
- **Complex bounds**: Parameterized types as bounds
- **Annotated bounds**: `<T extends @Anno Number>` (type extracted, annotation not)
- **Multiple parameters**: Any number of parameters
- **Type context**: Class, interface, enum, record, annotation
- **Method context**: Static and instance methods
- **Nested types**: Inner and static nested generic types
- **Type parameter annotations**: `<@Anno T>`, `<@Validated(validator=X.class) T>`
- **Annotation arguments**: String literals, class references, nested annotations
- **Annotation argument type references**: Class literals in annotation arguments

### 🎯 Key Distinctions

**Type Parameters vs Wildcards**:
- `<T>` in `class Box<T>` → **TypeParameter** ✅
- `<?>` in `List<?>` → **TypeReference (wildcard)** ❌
- `<? extends T>` → **TypeReference (wildcard)** ❌

**Context Tracking**:
- Class/Interface: `context = TYPE`
- Method: `context = METHOD`

### 📊 Additional Data

Type parameters generate related extractions:
- **Bounds** create TypeReference entries linking to bound types
- **Annotations** create TypeAnnotation entries with TYPE_PARAMETER context
- **Annotation arguments** create AnnotationArgumentReference entries
- **Class reference arguments** create TypeReference entries with TYPE_PARAMETER_ANNOTATION context
- **Usage** of parameters creates TypeReference entries (extracted by TypeReferenceExtractor)
- **Position** enables ordered reconstruction

### 🔗 Coordination with Other Extractors

- **TypeRegistryExtractor** calls TypeParameterExtractor for each type
- **AnnotationExtractor** is used internally for type parameter annotations
- **Bounds** are processed by TypeReferenceExtractor
- **Usage** of type parameters tracked by TypeReferenceExtractor
- **Type references in annotation arguments** are extracted and linked

### 🔗 Linkage and Data Relationships

**Type Parameter → Annotations:**
- Each `TypeParameter` has a unique hash
- `TypeAnnotation` entries with `context=TYPE_PARAMETER` link to the type parameter via `typeParameterHash`
- Multiple annotations can be applied to a single type parameter

**Annotations → Arguments:**
- Each `TypeAnnotation` has a unique hash
- `AnnotationArgumentReference` entries link to their annotation via `parentAnnotationHash`
- Arguments are ordered by `position`

**Arguments → Type References:**
- For class literal arguments (e.g., `validator = StringValidator.class`):
  - `AnnotationArgumentReference` has `valueType=CLASS_REFERENCE`
  - `TypeReference` entry created with `context=TYPE_PARAMETER_ANNOTATION`
  - `TypeReference.ownerKind=ANNOTATION_ARGUMENT` (for direct linkability)
  - `TypeReference.ownerHash` points to the `AnnotationArgumentReference` hash

**Complete Traversal Path:**
```
TypeParameter
    ↓ (via typeParameterHash)
TypeAnnotation (context=TYPE_PARAMETER)
    ↓ (via parentAnnotationHash)
AnnotationArgumentReference (valueType=CLASS_REFERENCE)
    ↓ (via typeReferenceOwnerHash)
TypeReference (context=TYPE_PARAMETER_ANNOTATION, ownerKind=ANNOTATION_ARGUMENT)
```

**Reverse Traversal:**
To find which type parameter a TYPE_PARAMETER_ANNOTATION type reference came from:
1. Start with `TypeReference` (context=TYPE_PARAMETER_ANNOTATION)
2. Use `ownerHash` → find `AnnotationArgumentReference`
3. Use `parentAnnotationHash` → find `TypeAnnotation`
4. Use `typeParameterHash` → find `TypeParameter`

### ⚠️ Current Limitations

**Type Use Annotations on Bounds**:
```java
<R extends @TypeAnno("Bound") Number>  // @TypeAnno NOT extracted
```
Annotations on the bound type itself (type use annotations) are not currently extracted. Only annotations on the type parameter declaration are supported:
```java
<@TypeAnno R extends Number>  // @TypeAnno IS extracted ✅
```

Type use annotation extraction would require broader changes to support annotations on all type references (fields, method signatures, etc.).
