# TypeRegistryExtractor - Examples

This document shows concrete examples of what the TypeRegistryExtractor can extract from Java source code.

## Overview

The TypeRegistryExtractor identifies and extracts **type declarations** - the fundamental building blocks of Java code: classes, interfaces, enums, records, and annotation types.

## What It Extracts

For each type declaration, it captures:
- **Identity**: name, qualifiedName, fileName
- **Category**: CLASS_TYPE, INTERFACE_TYPE, ENUM_TYPE, RECORD_TYPE, ANNOTATION_TYPE
- **Access**: PUBLIC_ACCESS, PRIVATE_ACCESS, PROTECTED_ACCESS, PACKAGE_ACCESS
- **Modifiers**: STATIC, ABSTRACT, FINAL, SEALED, NON_SEALED
- **Placement**: TOP_LEVEL, STATIC_NESTED, INNER, LOCAL, ANONYMOUS
- **Location**: filePath, startLine, endLine
- **Context**: baseMservPath, serviceVersionLinkHash
- **External flag**: isExternal (whether from project or dependency)

---

## Example 1: Simple Public Class

### Input Java Code
```java
package com.example.service;

public class UserService {
    private String name;
    
    public void saveUser(User user) {
        // implementation
    }
}
```

### Extracted TypeRegistry
```csv
name: UserService
qualifiedName: com.example.service.UserService
fileName: UserService.java
typeCategory: CLASS_TYPE
typeAccess: PUBLIC_ACCESS
typeModifier: (none)
typePlacement: TOP_LEVEL_PLACEMENT
startLine: 3
endLine: 9
isExternal: false
```

**Capabilities Demonstrated**:
- ✅ Extracts package-qualified name
- ✅ Identifies public access
- ✅ Recognizes top-level placement
- ✅ Captures exact line range

---

## Example 2: Abstract Class with Modifiers

### Input Java Code
```java
package com.example.domain;

public abstract class BaseEntity {
    protected Long id;
    
    public abstract void validate();
}
```

### Extracted TypeRegistry
```csv
name: BaseEntity
qualifiedName: com.example.domain.BaseEntity
typeCategory: CLASS_TYPE
typeAccess: PUBLIC_ACCESS
typeModifier: ABSTRACT_MODIFIER
typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Detects abstract modifier
- ✅ Handles inheritance patterns

---

## Example 3: Interface Declaration

### Input Java Code
```java
package com.example.api;

public interface PaymentGateway {
    boolean processPayment(Payment payment);
    void refund(String transactionId);
}
```

### Extracted TypeRegistry
```csv
name: PaymentGateway
qualifiedName: com.example.api.PaymentGateway
typeCategory: INTERFACE_TYPE
typeAccess: PUBLIC_ACCESS
typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Identifies interface types
- ✅ Distinguishes from class types

---

## Example 4: Enum Type

### Input Java Code
```java
package com.example.domain;

public enum OrderStatus {
    PENDING,
    CONFIRMED,
    SHIPPED,
    DELIVERED,
    CANCELLED
}
```

### Extracted TypeRegistry
```csv
name: OrderStatus
qualifiedName: com.example.domain.OrderStatus
typeCategory: ENUM_TYPE
typeAccess: PUBLIC_ACCESS
typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Recognizes enum declarations
- ✅ Extracts enum as a type registry

---

## Example 5: Record Type (Java 14+)

### Input Java Code
```java
package com.example.dto;

public record UserDTO(String username, String email, int age) {
    public UserDTO {
        if (age < 0) throw new IllegalArgumentException();
    }
}
```

### Extracted TypeRegistry
```csv
name: UserDTO
qualifiedName: com.example.dto.UserDTO
typeCategory: RECORD_TYPE
typeAccess: PUBLIC_ACCESS
typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Supports modern Java records
- ✅ Identifies record type category

---

## Example 6: Nested Static Class

### Input Java Code
```java
package com.example.util;

public class ResponseBuilder {
    
    public static class SuccessResponse {
        private Object data;
    }
    
    public static class ErrorResponse {
        private String message;
    }
}
```

### Extracted TypeRegistries (3 total)
```csv
1. name: ResponseBuilder
   qualifiedName: com.example.util.ResponseBuilder
   typeCategory: CLASS_TYPE
   typePlacement: TOP_LEVEL_PLACEMENT

2. name: SuccessResponse
   qualifiedName: com.example.util.ResponseBuilder.SuccessResponse
   typeCategory: CLASS_TYPE
   typeModifier: STATIC_MODIFIER
   typePlacement: STATIC_NESTED_PLACEMENT

3. name: ErrorResponse
   qualifiedName: com.example.util.ResponseBuilder.ErrorResponse
   typeCategory: CLASS_TYPE
   typeModifier: STATIC_MODIFIER
   typePlacement: STATIC_NESTED_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Extracts nested types
- ✅ Detects static modifier on nested classes
- ✅ Correctly identifies STATIC_NESTED_PLACEMENT
- ✅ Builds qualified names with parent prefix

---

## Example 7: Inner (Non-Static) Class

### Input Java Code
```java
package com.example.collections;

public class TreeNode {
    private int value;
    
    public class Iterator {
        private TreeNode current;
        
        public boolean hasNext() {
            return current != null;
        }
    }
}
```

### Extracted TypeRegistries
```csv
1. name: TreeNode
   typePlacement: TOP_LEVEL_PLACEMENT

2. name: Iterator
   qualifiedName: com.example.collections.TreeNode.Iterator
   typePlacement: INNER_PLACEMENT
   (note: no STATIC_MODIFIER)
```

**Capabilities Demonstrated**:
- ✅ Distinguishes inner from static nested
- ✅ Correctly identifies INNER_PLACEMENT

---

## Example 8: Package-Private Class

### Input Java Code
```java
package com.example.internal;

class InternalHelper {
    void doSomething() {
    }
}
```

### Extracted TypeRegistry
```csv
name: InternalHelper
typeAccess: PACKAGE_ACCESS
typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Detects package-private (no modifier)
- ✅ Assigns PACKAGE_ACCESS correctly

---

## Example 9: Final Class

### Input Java Code
```java
package com.example.util;

public final class Constants {
    public static final String APP_NAME = "MyApp";
}
```

### Extracted TypeRegistry
```csv
name: Constants
typeModifier: FINAL_MODIFIER
typeAccess: PUBLIC_ACCESS
```

**Capabilities Demonstrated**:
- ✅ Detects final modifier
- ✅ Recognizes utility class pattern

---

## Example 10: Annotation Type Declaration

### Input Java Code
```java
package com.example.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
public @interface Auditable {
    String value() default "";
}
```

### Extracted TypeRegistry
```csv
name: Auditable
qualifiedName: com.example.annotations.Auditable
typeCategory: ANNOTATION_TYPE
typeAccess: PUBLIC_ACCESS
```

**Capabilities Demonstrated**:
- ✅ Identifies annotation type declarations
- ✅ Distinguishes from annotation usage

---

## Example 11: Multiple Top-Level Types (Same File)

### Input Java Code
```java
package com.example.model;

public class User {
    private String id;
}

class UserHelper {
    void help(User user) {
    }
}
```

### Extracted TypeRegistries
```csv
1. name: User
   typeAccess: PUBLIC_ACCESS
   typePlacement: TOP_LEVEL_PLACEMENT

2. name: UserHelper
   typeAccess: PACKAGE_ACCESS
   typePlacement: TOP_LEVEL_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Extracts all top-level types from single file
- ✅ Handles mixed access modifiers

---

## Example 12: Generic Class Declaration

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

### Extracted TypeRegistry
```csv
name: Box
qualifiedName: com.example.container.Box
typeCategory: CLASS_TYPE
typeAccess: PUBLIC_ACCESS
```

**Note**: Type parameters (`<T>`) are extracted separately by `TypeParameterExtractor`

**Capabilities Demonstrated**:
- ✅ Handles generic type declarations
- ✅ Extracts base type information (parameters handled separately)

---

## Example 13: Sealed Class (Java 15+)

### Input Java Code
```java
package com.example.geometry;

public sealed class Shape permits Circle, Rectangle {
    private String id;
}

final class Circle extends Shape {
}

final class Rectangle extends Shape {
}
```

### Extracted TypeRegistries
```csv
1. name: Shape
   typeModifier: SEALED_MODIFIER
   typeCategory: CLASS_TYPE

2. name: Circle
   typeModifier: FINAL_MODIFIER

3. name: Rectangle
   typeModifier: FINAL_MODIFIER
```

**Capabilities Demonstrated**:
- ✅ Detects sealed modifier
- ✅ Handles modern Java sealed classes

---

## Example 14: Complex Nested Structure

### Input Java Code
```java
package com.example.complex;

public class OuterClass {
    
    public static class StaticNested {
        
        public class DoublyNested {
            private int value;
        }
    }
    
    public class InnerClass {
        private String name;
    }
}
```

### Extracted TypeRegistries
```csv
1. name: OuterClass
   qualifiedName: com.example.complex.OuterClass
   typePlacement: TOP_LEVEL_PLACEMENT

2. name: StaticNested
   qualifiedName: com.example.complex.OuterClass.StaticNested
   typeModifier: STATIC_MODIFIER
   typePlacement: STATIC_NESTED_PLACEMENT

3. name: DoublyNested
   qualifiedName: com.example.complex.OuterClass.StaticNested.DoublyNested
   typePlacement: INNER_PLACEMENT
   (nested inside static class, but itself is inner)

4. name: InnerClass
   qualifiedName: com.example.complex.OuterClass.InnerClass
   typePlacement: INNER_PLACEMENT
```

**Capabilities Demonstrated**:
- ✅ Handles arbitrary nesting depth
- ✅ Correctly tracks qualified names through nesting
- ✅ Properly identifies placement at each level

---

## Example 15: Anonymous Class (Limited Support)

### Input Java Code
```java
package com.example.pattern;

public class EventHandler {
    
    public void setup() {
        Runnable task = new Runnable() {
            @Override
            public void run() {
                System.out.println("Running");
            }
        };
    }
}
```

### Extracted TypeRegistry
```csv
name: EventHandler
qualifiedName: com.example.pattern.EventHandler
typePlacement: TOP_LEVEL_PLACEMENT

(Anonymous Runnable implementation may have limited extraction)
```

**Note**: Anonymous classes have special handling and may not generate full TypeRegistry entries

---

## Summary of Extraction Capabilities

### ✅ Fully Supported

- **Type Categories**: CLASS, INTERFACE, ENUM, RECORD, ANNOTATION
- **Access Modifiers**: PUBLIC, PRIVATE, PROTECTED, PACKAGE
- **Type Modifiers**: STATIC, ABSTRACT, FINAL, SEALED, NON_SEALED
- **Placements**: TOP_LEVEL, STATIC_NESTED, INNER
- **Multiple types per file**
- **Nested types at any depth**
- **Generic type declarations** (type parameters extracted separately)
- **Modern Java features** (records, sealed classes)

### ⚠️ Not Yet Implemented

- **LOCAL_PLACEMENT**: Types defined inside methods (requires checking for method/constructor/block parents)
- **ANONYMOUS_PLACEMENT**: Anonymous inner classes (requires special handling of object creation expressions)

### 📊 Additional Context

For each type, the extractor also coordinates:
- **Type parameters** → `TypeParameterExtractor`
  - Extracts type parameters like `<T>`, `<K, V>`, `<T extends Number>`
  - Also extracts **annotations on type parameters** (Java 8+) like `<@TypeAnno T>`
- **Type references** → `TypeReferenceExtractor`
  - Extracts superclass, interfaces, type parameter bounds
  - Also extracts **class references from annotation arguments**
- **Annotations** → `AnnotationExtractor`
  - Extracts type-level annotations like `@RestController`
  - Used internally by `TypeParameterExtractor` for type parameter annotations

These are accumulated and accessible via getter methods:
- `getExtractedTypeParameters()` - Type parameter declarations
- `getExtractedTypeReferences()` - All type usages (inheritance, bounds, annotation arguments)
- `getExtractedAnnotations()` - Type-level annotations AND type parameter annotations
- `getExtractedAnnotationArguments()` - Arguments from all annotations (including type parameter annotations)

**Note**: Starting with Java 8+, type parameters can have annotations:
```java
public class Container<
    @TypeAnno("Simple") T,
    @Validated(validator = CustomValidator.class) U
> { }
```
The `TypeParameterExtractor` delegates to `AnnotationExtractor` to handle these annotations, and `TypeRegistryExtractor` collects all the results.
