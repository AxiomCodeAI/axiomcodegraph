# ImportExtractor - Examples

This document shows concrete examples of what the ImportExtractor can extract from Java source code.

## Overview

The ImportExtractor identifies and extracts **import declarations** from Java source files. It supports all five import types defined in Java (as of Java 23, JEP 476).

## What It Extracts

For each import declaration, it captures:
- **importKind**: SINGLE_TYPE, TYPE_ON_DEMAND, SINGLE_STATIC, STATIC_ON_DEMAND, MODULE
- **importedPath**: Full import path as written in source
- **packageOrTypeName**: The package (for type imports) or containing type (for static imports)
- **simpleName**: The imported type/member name, "*" for on-demand, or module name
- **filePath**: Source file containing the import
- **lineNumber**: Line number of the import declaration
- **isStatic**: true for static imports
- **isOnDemand**: true for wildcard imports
- **isModuleImport**: true for module imports (Java 23+)
- **serviceVersionLinkHash**: Link to service version
- **importRegistryUniqueHash**: Unique identifier for this import

---

## Java Import Grammar (JLS)

```
ImportDeclaration:
    SingleTypeImportDeclaration
    TypeImportOnDemandDeclaration
    SingleStaticImportDeclaration
    StaticImportOnDemandDeclaration
    ModuleImportDeclaration

SingleTypeImportDeclaration:
    import TypeName ;

TypeImportOnDemandDeclaration:
    import PackageOrTypeName . * ;

SingleStaticImportDeclaration:
    import static TypeName . Identifier ;

StaticImportOnDemandDeclaration:
    import static TypeName . * ;

ModuleImportDeclaration:
    import module ModuleName ;
```

---

## Example 1: Single Type Import

### Input Java Code
```java
package com.example.service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public class UserService {
    private List<User> users;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 3
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: java.util.Map
packageOrTypeName: java.util
simpleName: Map
lineNumber: 4
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: java.util.Optional
packageOrTypeName: java.util
simpleName: Optional
lineNumber: 5
isStatic: false
isOnDemand: false
isModuleImport: false
```

**Capabilities Demonstrated**:
- ✅ Extracts fully qualified import path
- ✅ Parses package name correctly
- ✅ Identifies simple type name
- ✅ Captures exact line number

---

## Example 2: Type On-Demand Import (Wildcard)

### Input Java Code
```java
package com.example.controller;

import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class UserController {
    // uses List, Map, etc.
}
```

### Extracted ImportRegistries
```csv
importKind: TYPE_ON_DEMAND
importedPath: java.util.*
packageOrTypeName: java.util
simpleName: *
lineNumber: 3
isStatic: false
isOnDemand: true
isModuleImport: false

importKind: TYPE_ON_DEMAND
importedPath: org.springframework.web.bind.annotation.*
packageOrTypeName: org.springframework.web.bind.annotation
simpleName: *
lineNumber: 4
isStatic: false
isOnDemand: true
isModuleImport: false
```

**Capabilities Demonstrated**:
- ✅ Recognizes wildcard imports
- ✅ Sets isOnDemand to true
- ✅ simpleName is "*" for wildcard
- ✅ Handles deep package paths

---

## Example 3: Single Static Import

### Input Java Code
```java
package com.example.util;

import static java.lang.Math.PI;
import static java.lang.Math.max;
import static java.lang.Math.min;
import static java.util.Collections.sort;
import static java.util.Collections.emptyList;

public class Calculator {
    public double circleArea(double r) {
        return PI * r * r;
    }
    
    public int largest(int a, int b) {
        return max(a, b);
    }
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_STATIC
importedPath: java.lang.Math.PI
packageOrTypeName: java.lang.Math
simpleName: PI
lineNumber: 3
isStatic: true
isOnDemand: false
isModuleImport: false

importKind: SINGLE_STATIC
importedPath: java.lang.Math.max
packageOrTypeName: java.lang.Math
simpleName: max
lineNumber: 4
isStatic: true
isOnDemand: false
isModuleImport: false

importKind: SINGLE_STATIC
importedPath: java.lang.Math.min
packageOrTypeName: java.lang.Math
simpleName: min
lineNumber: 5
isStatic: true
isOnDemand: false
isModuleImport: false

importKind: SINGLE_STATIC
importedPath: java.util.Collections.sort
packageOrTypeName: java.util.Collections
simpleName: sort
lineNumber: 6
isStatic: true
isOnDemand: false
isModuleImport: false

importKind: SINGLE_STATIC
importedPath: java.util.Collections.emptyList
packageOrTypeName: java.util.Collections
simpleName: emptyList
lineNumber: 7
isStatic: true
isOnDemand: false
isModuleImport: false
```

**Capabilities Demonstrated**:
- ✅ Detects static keyword
- ✅ Sets isStatic to true
- ✅ packageOrTypeName is the containing type (not package)
- ✅ simpleName is the static member being imported
- ✅ Works for both constants (PI) and methods (max, sort)

---

## Example 4: Static On-Demand Import (Wildcard)

### Input Java Code
```java
package com.example.test;

import static java.lang.Math.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class CalculatorTest {
    @Test
    public void testArea() {
        double area = PI * pow(5, 2);
        assertEquals(78.54, area, 0.01);
    }
}
```

### Extracted ImportRegistries
```csv
importKind: STATIC_ON_DEMAND
importedPath: java.lang.Math.*
packageOrTypeName: java.lang.Math
simpleName: *
lineNumber: 3
isStatic: true
isOnDemand: true
isModuleImport: false

importKind: STATIC_ON_DEMAND
importedPath: org.junit.Assert.*
packageOrTypeName: org.junit.Assert
simpleName: *
lineNumber: 4
isStatic: true
isOnDemand: true
isModuleImport: false

importKind: STATIC_ON_DEMAND
importedPath: org.mockito.Mockito.*
packageOrTypeName: org.mockito.Mockito
simpleName: *
lineNumber: 5
isStatic: true
isOnDemand: true
isModuleImport: false
```

**Capabilities Demonstrated**:
- ✅ Combines static and wildcard detection
- ✅ Both isStatic and isOnDemand are true
- ✅ Common pattern for test frameworks (JUnit, Mockito)
- ✅ packageOrTypeName is the class containing static members

---

## Example 5: Module Import (Java 23+, JEP 476)

### Input Java Code
```java
package com.example.app;

import module java.base;
import module java.sql;
import module com.example.mymodule;

public class Application {
    // Has access to all public types from exported packages
    // of java.base, java.sql, and com.example.mymodule
}
```

### Extracted ImportRegistries
```csv
importKind: MODULE
importedPath: java.base
packageOrTypeName: (empty)
simpleName: java.base
lineNumber: 3
isStatic: false
isOnDemand: false
isModuleImport: true

importKind: MODULE
importedPath: java.sql
packageOrTypeName: (empty)
simpleName: java.sql
lineNumber: 4
isStatic: false
isOnDemand: false
isModuleImport: true

importKind: MODULE
importedPath: com.example.mymodule
packageOrTypeName: (empty)
simpleName: com.example.mymodule
lineNumber: 5
isStatic: false
isOnDemand: false
isModuleImport: true
```

**Capabilities Demonstrated**:
- ✅ Detects module keyword (Java 23+)
- ✅ Sets isModuleImport to true
- ✅ importedPath and simpleName are both the module name
- ✅ packageOrTypeName is empty (not applicable for modules)

**Note**: Module imports are essentially "super wildcards" that import all public types from all packages exported by the module.

---

## Example 6: Mixed Import Styles (Complete File Header)

### Input Java Code
```java
package com.example.comprehensive;

// Module imports (Java 23+)
import module java.base;

// Single type imports
import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

// Type on-demand imports
import java.io.*;
import com.example.domain.*;

// Single static imports
import static java.lang.Math.PI;
import static java.lang.System.out;

// Static on-demand imports
import static java.util.Collections.*;
import static org.junit.Assert.*;

public class ComprehensiveExample {
    // implementation
}
```

### Extracted ImportRegistries (11 total)
```csv
1. MODULE         java.base                      (module)
2. SINGLE_TYPE    java.util.List                 List
3. SINGLE_TYPE    java.util.Map                  Map
4. SINGLE_TYPE    java.time.LocalDateTime        LocalDateTime
5. TYPE_ON_DEMAND java.io.*                      *
6. TYPE_ON_DEMAND com.example.domain.*           *
7. SINGLE_STATIC  java.lang.Math.PI              PI
8. SINGLE_STATIC  java.lang.System.out           out
9. STATIC_ON_DEMAND java.util.Collections.*      *
10. STATIC_ON_DEMAND org.junit.Assert.*          *
```

**Capabilities Demonstrated**:
- ✅ Handles all five import types in same file
- ✅ Maintains correct line numbers
- ✅ Each import gets unique hash
- ✅ Order preserved from source

---

## Example 7: Lombok Imports (Common Pattern)

### Input Java Code
```java
package com.example.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.extern.slf4j.Slf4j;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Slf4j
public class User {
    private String id;
    private String name;
    private String email;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: lombok.Data
packageOrTypeName: lombok
simpleName: Data

importKind: SINGLE_TYPE
importedPath: lombok.NoArgsConstructor
packageOrTypeName: lombok
simpleName: NoArgsConstructor

importKind: SINGLE_TYPE
importedPath: lombok.AllArgsConstructor
packageOrTypeName: lombok
simpleName: AllArgsConstructor

importKind: SINGLE_TYPE
importedPath: lombok.Builder
packageOrTypeName: lombok
simpleName: Builder

importKind: SINGLE_TYPE
importedPath: lombok.extern.slf4j.Slf4j
packageOrTypeName: lombok.extern.slf4j
simpleName: Slf4j
```

**Capabilities Demonstrated**:
- ✅ Handles annotation processor imports (Lombok)
- ✅ Deep package paths (lombok.extern.slf4j)
- ✅ Common real-world pattern

---

## Example 8: Spring Framework Imports (Common Pattern)

### Input Java Code
```java
package com.example.controller;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
public class UserController {
    // implementation
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: org.springframework.web.bind.annotation.RestController
packageOrTypeName: org.springframework.web.bind.annotation
simpleName: RestController

importKind: SINGLE_TYPE
importedPath: org.springframework.web.bind.annotation.GetMapping
packageOrTypeName: org.springframework.web.bind.annotation
simpleName: GetMapping

importKind: SINGLE_TYPE
importedPath: org.springframework.http.ResponseEntity
packageOrTypeName: org.springframework.http
simpleName: ResponseEntity

importKind: SINGLE_TYPE
importedPath: org.springframework.beans.factory.annotation.Autowired
packageOrTypeName: org.springframework.beans.factory.annotation
simpleName: Autowired
```

**Capabilities Demonstrated**:
- ✅ Handles Spring Framework imports
- ✅ Long package paths correctly parsed
- ✅ Real-world enterprise patterns

---

## Example 9: Jackson/JSON Imports (Common Pattern)

### Input Java Code
```java
package com.example.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.databind.ObjectMapper;

public class UserDTO {
    @JsonProperty("user_id")
    private String id;
    
    @JsonIgnore
    private String password;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: com.fasterxml.jackson.annotation.JsonIgnore
packageOrTypeName: com.fasterxml.jackson.annotation
simpleName: JsonIgnore

importKind: SINGLE_TYPE
importedPath: com.fasterxml.jackson.annotation.JsonProperty
packageOrTypeName: com.fasterxml.jackson.annotation
simpleName: JsonProperty

importKind: SINGLE_TYPE
importedPath: com.fasterxml.jackson.annotation.JsonPropertyOrder
packageOrTypeName: com.fasterxml.jackson.annotation
simpleName: JsonPropertyOrder

importKind: SINGLE_TYPE
importedPath: com.fasterxml.jackson.databind.ObjectMapper
packageOrTypeName: com.fasterxml.jackson.databind
simpleName: ObjectMapper
```

**Capabilities Demonstrated**:
- ✅ Handles JSON library imports
- ✅ Third-party library patterns
- ✅ Annotation imports

---

## Example 10: No Imports (Default Package or Implicit)

### Input Java Code
```java
// No package declaration (default package)
// No imports - only uses java.lang types

public class SimpleClass {
    public String greet(String name) {
        return "Hello, " + name;
    }
}
```

### Extracted ImportRegistries
```csv
(none - empty array returned)
```

**Capabilities Demonstrated**:
- ✅ Handles files with no imports
- ✅ Returns empty array, not error
- ✅ java.lang is implicitly imported

---

# Edge Cases

The following examples cover edge cases and less common import patterns.

---

## Example 11: Nested/Inner Class Imports

### Input Java Code
```java
package com.example.nested;

import java.util.Map.Entry;
import java.util.AbstractMap.SimpleEntry;
import java.util.AbstractMap.SimpleImmutableEntry;
import com.example.Outer.Inner;
import com.example.Outer.Inner.Deeper;

public class NestedImportExample {
    Entry<String, Integer> entry;
    Inner inner;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.Map.Entry
packageOrTypeName: java.util.Map
simpleName: Entry
lineNumber: 3
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: java.util.AbstractMap.SimpleEntry
packageOrTypeName: java.util.AbstractMap
simpleName: SimpleEntry
lineNumber: 4
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: java.util.AbstractMap.SimpleImmutableEntry
packageOrTypeName: java.util.AbstractMap
simpleName: SimpleImmutableEntry
lineNumber: 5
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: com.example.Outer.Inner
packageOrTypeName: com.example.Outer
simpleName: Inner
lineNumber: 6
isStatic: false
isOnDemand: false
isModuleImport: false

importKind: SINGLE_TYPE
importedPath: com.example.Outer.Inner.Deeper
packageOrTypeName: com.example.Outer.Inner
simpleName: Deeper
lineNumber: 7
isStatic: false
isOnDemand: false
isModuleImport: false
```

**Capabilities Demonstrated**:
- ✅ Nested class imports (Map.Entry)
- ✅ `packageOrTypeName` is the enclosing type path, not just the package
- ✅ Multi-level nesting (Outer.Inner.Deeper)
- ✅ Standard library nested types (AbstractMap.SimpleEntry)

**Important Note**: For `java.util.Map.Entry`:
- `packageOrTypeName` = `java.util.Map` (the enclosing type)
- `simpleName` = `Entry`
- The actual Java package is `java.util`, but `Map` is the enclosing type

---

## Example 12: Enum and Interface Static Imports

### Input Java Code
```java
package com.example.statics;

import static java.time.DayOfWeek.MONDAY;
import static java.time.DayOfWeek.FRIDAY;
import static java.time.DayOfWeek.*;
import static java.util.Comparator.comparing;
import static java.util.Comparator.naturalOrder;
import static java.util.Comparator.reverseOrder;
import static java.util.function.Predicate.not;
import static java.util.function.Function.identity;

public class EnumStaticExample {
    DayOfWeek day = MONDAY;
    Comparator<String> comp = naturalOrder();
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_STATIC
importedPath: java.time.DayOfWeek.MONDAY
packageOrTypeName: java.time.DayOfWeek
simpleName: MONDAY
lineNumber: 3
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: java.time.DayOfWeek.FRIDAY
packageOrTypeName: java.time.DayOfWeek
simpleName: FRIDAY
lineNumber: 4
isStatic: true
isOnDemand: false

importKind: STATIC_ON_DEMAND
importedPath: java.time.DayOfWeek.*
packageOrTypeName: java.time.DayOfWeek
simpleName: *
lineNumber: 5
isStatic: true
isOnDemand: true

importKind: SINGLE_STATIC
importedPath: java.util.Comparator.comparing
packageOrTypeName: java.util.Comparator
simpleName: comparing
lineNumber: 6
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: java.util.function.Predicate.not
packageOrTypeName: java.util.function.Predicate
simpleName: not
lineNumber: 9
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: java.util.function.Function.identity
packageOrTypeName: java.util.function.Function
simpleName: identity
lineNumber: 10
isStatic: true
isOnDemand: false
```

**Capabilities Demonstrated**:
- ✅ Enum constant static imports (MONDAY, FRIDAY)
- ✅ Enum wildcard static imports (DayOfWeek.*)
- ✅ Interface static method imports (Java 8+): comparing, naturalOrder
- ✅ Functional interface static methods: Predicate.not, Function.identity

---

## Example 13: Static Import from Nested Class

### Input Java Code
```java
package com.example.nestedstatic;

import static java.util.Map.Entry.comparingByKey;
import static java.util.Map.Entry.comparingByValue;
import static com.example.Outer.Inner.CONSTANT;
import static com.example.Outer.Inner.utilityMethod;
import static com.example.Outer.Inner.Deeper.DEEP_CONSTANT;

public class NestedStaticExample {
    Comparator<Entry<String, Integer>> comp = comparingByKey();
    int value = CONSTANT;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_STATIC
importedPath: java.util.Map.Entry.comparingByKey
packageOrTypeName: java.util.Map.Entry
simpleName: comparingByKey
lineNumber: 3
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: java.util.Map.Entry.comparingByValue
packageOrTypeName: java.util.Map.Entry
simpleName: comparingByValue
lineNumber: 4
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: com.example.Outer.Inner.CONSTANT
packageOrTypeName: com.example.Outer.Inner
simpleName: CONSTANT
lineNumber: 5
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: com.example.Outer.Inner.utilityMethod
packageOrTypeName: com.example.Outer.Inner
simpleName: utilityMethod
lineNumber: 6
isStatic: true
isOnDemand: false

importKind: SINGLE_STATIC
importedPath: com.example.Outer.Inner.Deeper.DEEP_CONSTANT
packageOrTypeName: com.example.Outer.Inner.Deeper
simpleName: DEEP_CONSTANT
lineNumber: 7
isStatic: true
isOnDemand: false
```

**Capabilities Demonstrated**:
- ✅ Static imports from nested types (Map.Entry)
- ✅ `packageOrTypeName` reflects full nesting path
- ✅ Deep nesting (Outer.Inner.Deeper)
- ✅ Both constants and methods from nested classes

---

## Example 14: Annotation Type Imports

### Input Java Code
```java
package com.example.annotations;

import java.lang.annotation.Retention;
import java.lang.annotation.Target;
import java.lang.annotation.ElementType;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Documented;
import java.lang.annotation.Inherited;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Retention(RUNTIME)
@Target({METHOD, TYPE})
@Documented
public @interface Auditable {
    String value() default "";
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.lang.annotation.Retention
packageOrTypeName: java.lang.annotation
simpleName: Retention
lineNumber: 3

importKind: SINGLE_TYPE
importedPath: java.lang.annotation.Target
packageOrTypeName: java.lang.annotation
simpleName: Target
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: java.lang.annotation.ElementType
packageOrTypeName: java.lang.annotation
simpleName: ElementType
lineNumber: 5

importKind: SINGLE_STATIC
importedPath: java.lang.annotation.ElementType.METHOD
packageOrTypeName: java.lang.annotation.ElementType
simpleName: METHOD
lineNumber: 9
isStatic: true

importKind: SINGLE_STATIC
importedPath: java.lang.annotation.ElementType.TYPE
packageOrTypeName: java.lang.annotation.ElementType
simpleName: TYPE
lineNumber: 10
isStatic: true

importKind: SINGLE_STATIC
importedPath: java.lang.annotation.RetentionPolicy.RUNTIME
packageOrTypeName: java.lang.annotation.RetentionPolicy
simpleName: RUNTIME
lineNumber: 11
isStatic: true
```

**Capabilities Demonstrated**:
- ✅ Meta-annotation imports (Retention, Target)
- ✅ Enum type imports (ElementType, RetentionPolicy)
- ✅ Static imports of enum constants for annotation arguments

---

## Example 15: Contextual Keyword Package Names

### Input Java Code
```java
package com.example.keywords;

import com.example.record.RecordUtils;
import com.example.sealed.SealedHelper;
import com.example.permits.PermitChecker;
import com.example.var.VarProcessor;
import com.example.yield.YieldManager;
import com.example.module.ModuleInfo;
import com.example.non.sealed.NonSealedType;

public class KeywordPackageExample {
    RecordUtils utils;
    SealedHelper helper;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: com.example.record.RecordUtils
packageOrTypeName: com.example.record
simpleName: RecordUtils
lineNumber: 3

importKind: SINGLE_TYPE
importedPath: com.example.sealed.SealedHelper
packageOrTypeName: com.example.sealed
simpleName: SealedHelper
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: com.example.permits.PermitChecker
packageOrTypeName: com.example.permits
simpleName: PermitChecker
lineNumber: 5

importKind: SINGLE_TYPE
importedPath: com.example.var.VarProcessor
packageOrTypeName: com.example.var
simpleName: VarProcessor
lineNumber: 6

importKind: SINGLE_TYPE
importedPath: com.example.yield.YieldManager
packageOrTypeName: com.example.yield
simpleName: YieldManager
lineNumber: 7

importKind: SINGLE_TYPE
importedPath: com.example.module.ModuleInfo
packageOrTypeName: com.example.module
simpleName: ModuleInfo
lineNumber: 8
```

**Capabilities Demonstrated**:
- ✅ Package names using contextual keywords: `record`, `sealed`, `permits`, `var`, `yield`, `module`
- ✅ These are legal package names because they are **contextual** keywords (not reserved)
- ✅ Parser correctly handles these without confusion

---

## Example 16: Imports Shadowing java.lang

### Input Java Code
```java
package com.example.shadowing;

import com.example.custom.String;
import com.example.custom.Integer;
import com.example.custom.System;
import com.example.custom.Object;
import com.example.custom.Class;

public class ShadowingExample {
    String customString;        // Uses com.example.custom.String
    java.lang.String javaString; // Must be fully qualified
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: com.example.custom.String
packageOrTypeName: com.example.custom
simpleName: String
lineNumber: 3

importKind: SINGLE_TYPE
importedPath: com.example.custom.Integer
packageOrTypeName: com.example.custom
simpleName: Integer
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: com.example.custom.System
packageOrTypeName: com.example.custom
simpleName: System
lineNumber: 5

importKind: SINGLE_TYPE
importedPath: com.example.custom.Object
packageOrTypeName: com.example.custom
simpleName: Object
lineNumber: 6

importKind: SINGLE_TYPE
importedPath: com.example.custom.Class
packageOrTypeName: com.example.custom
simpleName: Class
lineNumber: 7
```

**Capabilities Demonstrated**:
- ✅ Imports that shadow java.lang types
- ✅ ImportExtractor captures these without special handling
- ✅ Shadowing is a compile-time concern, not an extraction concern

---

## Example 17: Duplicate Imports

### Input Java Code
```java
package com.example.duplicate;

import java.util.List;
import java.util.Map;
import java.util.List;  // Duplicate - legal but compiler warns
import java.util.List;  // Another duplicate

public class DuplicateExample {
    List<String> list;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 3
importRegistryUniqueHash: IMPORT_REGISTRY_abc123

importKind: SINGLE_TYPE
importedPath: java.util.Map
packageOrTypeName: java.util
simpleName: Map
lineNumber: 4
importRegistryUniqueHash: IMPORT_REGISTRY_def456

importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 5
importRegistryUniqueHash: IMPORT_REGISTRY_ghi789

importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 6
importRegistryUniqueHash: IMPORT_REGISTRY_jkl012
```

**Capabilities Demonstrated**:
- ✅ **Each duplicate import is captured separately** (no deduplication)
- ✅ Different line numbers → different unique hashes
- ✅ Preserves source-level information for analysis

**Note**: The ImportExtractor does NOT deduplicate. Each import declaration in source becomes one ImportRegistry record. This allows detecting duplicate imports during analysis.

---

## Example 18: Comments and Whitespace in Imports

### Input Java Code
```java
package com.example.formatting;
import java.util.List;  // inline comment
// Comment between imports
import java.util.Map;
/* Multi-line
   comment */
import java.util.Set;
import    java.util.Queue;
import java.util.Deque     ;

public class FormattingExample {
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 2

importKind: SINGLE_TYPE
importedPath: java.util.Map
packageOrTypeName: java.util
simpleName: Map
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: java.util.Set
packageOrTypeName: java.util
simpleName: Set
lineNumber: 7

importKind: SINGLE_TYPE
importedPath: java.util.Queue
packageOrTypeName: java.util
simpleName: Queue
lineNumber: 8

importKind: SINGLE_TYPE
importedPath: java.util.Deque
packageOrTypeName: java.util
simpleName: Deque
lineNumber: 9
```

**Capabilities Demonstrated**:
- ✅ Line numbers are accurate (reflect actual import, not comments)
- ✅ Comments between imports don't affect extraction
- ✅ Extra whitespace is normalized (tree-sitter handles this)
- ✅ Inline comments don't affect extraction

---

## Example 19: Single-Character Names and Unicode

### Input Java Code
```java
package com.example.edge;

import a.b.C;
import x.Y;
import com.example.日本語.MyClass;
import org.société.données.Utilisateur;
import _underscore.pkg.Type;
import $dollar.pkg.Money;

public class EdgeNameExample {
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: a.b.C
packageOrTypeName: a.b
simpleName: C
lineNumber: 3

importKind: SINGLE_TYPE
importedPath: x.Y
packageOrTypeName: x
simpleName: Y
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: com.example.日本語.MyClass
packageOrTypeName: com.example.日本語
simpleName: MyClass
lineNumber: 5

importKind: SINGLE_TYPE
importedPath: org.société.données.Utilisateur
packageOrTypeName: org.société.données
simpleName: Utilisateur
lineNumber: 6

importKind: SINGLE_TYPE
importedPath: _underscore.pkg.Type
packageOrTypeName: _underscore.pkg
simpleName: Type
lineNumber: 7

importKind: SINGLE_TYPE
importedPath: $dollar.pkg.Money
packageOrTypeName: $dollar.pkg
simpleName: Money
lineNumber: 8
```

**Capabilities Demonstrated**:
- ✅ Single-character package and class names
- ✅ Unicode/non-ASCII identifiers (Japanese, French)
- ✅ Underscore-prefixed identifiers
- ✅ Dollar sign identifiers (legal but unconventional)

---

## Example 20: Conflicting Wildcards with Explicit Import

### Input Java Code
```java
package com.example.conflict;

import java.util.*;        // Has List
import java.awt.*;         // Also has List
import java.util.List;     // Explicit import resolves conflict

public class ConflictExample {
    List<String> list;     // Uses java.util.List (explicit wins)
}
```

### Extracted ImportRegistries
```csv
importKind: TYPE_ON_DEMAND
importedPath: java.util.*
packageOrTypeName: java.util
simpleName: *
lineNumber: 3

importKind: TYPE_ON_DEMAND
importedPath: java.awt.*
packageOrTypeName: java.awt
simpleName: *
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 5
```

**Capabilities Demonstrated**:
- ✅ Multiple wildcard imports captured
- ✅ Explicit import for conflict resolution captured
- ✅ Import order preserved (relevant for understanding developer intent)

**Note**: ImportExtractor captures what's declared, not how conflicts are resolved. Conflict resolution is the compiler's job.

---

## Example 21: Import Immediately After Package

### Input Java Code
```java
package com.example;
import java.util.List;
import java.util.Map;

public class NoBlankLine {
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 2

importKind: SINGLE_TYPE
importedPath: java.util.Map
packageOrTypeName: java.util
simpleName: Map
lineNumber: 3
```

**Capabilities Demonstrated**:
- ✅ No blank line between package and imports is valid Java
- ✅ Extraction works regardless of formatting style

---

## Example 22: Generics Note

### Input Java Code
```java
package com.example.generics;

import java.util.Map;
import java.util.List;
import java.util.function.Function;

public class GenericsExample {
    Map<String, List<Integer>> map;
    Function<String, List<Map<Integer, String>>> complex;
}
```

### Extracted ImportRegistries
```csv
importKind: SINGLE_TYPE
importedPath: java.util.Map
packageOrTypeName: java.util
simpleName: Map
lineNumber: 3

importKind: SINGLE_TYPE
importedPath: java.util.List
packageOrTypeName: java.util
simpleName: List
lineNumber: 4

importKind: SINGLE_TYPE
importedPath: java.util.function.Function
packageOrTypeName: java.util.function
simpleName: Function
lineNumber: 5
```

**Important Note**: 
- ✅ Import statements **never** contain generics
- The generic type arguments (`<String, List<Integer>>`) appear only in **usage**, not in imports
- ImportExtractor correctly captures the raw type names

---

## Summary of Import Types

| ImportKind | Syntax | Example | isStatic | isOnDemand | isModuleImport |
|------------|--------|---------|----------|------------|----------------|
| `SINGLE_TYPE` | `import pkg.Type;` | `import java.util.List;` | false | false | false |
| `TYPE_ON_DEMAND` | `import pkg.*;` | `import java.util.*;` | false | true | false |
| `SINGLE_STATIC` | `import static pkg.Type.member;` | `import static java.lang.Math.PI;` | true | false | false |
| `STATIC_ON_DEMAND` | `import static pkg.Type.*;` | `import static java.lang.Math.*;` | true | true | false |
| `MODULE` | `import module name;` | `import module java.base;` | false | false | true |

---

## CSV Output Format

The ImportExtractor outputs to `all-imports.csv` with the following columns:

```
importKind | importedPath | packageOrTypeName | simpleName | filePath | lineNumber | isStatic | isOnDemand | isModuleImport | serviceVersionLinkHash | importRegistryUniqueHash
```

### Example CSV Row
```
SINGLE_STATIC	java.lang.Math.PI	java.lang.Math	PI	/path/to/Calculator.java	5	true	false	false	SERVICE_VERSION_abc123	IMPORT_REGISTRY_def456
```

---

## Integration with Other Extractors

The ImportExtractor operates independently from `TypeRegistryExtractor` but is called during the same file processing loop in `JavaProjectAnalyzer`. Unlike type and method extractors which build hierarchical relationships, imports are flat file-level declarations.

### Relationship to Type Resolution
- Imports provide context for resolving unqualified type names
- `TypeRegistryExtractor` internally builds an import map for type resolution
- `ImportExtractor` captures imports as first-class entities for analysis

---

## Capabilities Summary

### ✅ Fully Supported
- **All 5 Import Types**: SINGLE_TYPE, TYPE_ON_DEMAND, SINGLE_STATIC, STATIC_ON_DEMAND, MODULE
- **Static imports**: Both single member and wildcard
- **Deep package paths**: Any nesting depth
- **Multiple imports per file**: All captured with unique hashes
- **Line number tracking**: Exact source location
- **Modern Java**: Module imports (Java 23+)
- **Nested class imports**: Map.Entry, AbstractMap.SimpleEntry, Outer.Inner.Deeper
- **Enum constant imports**: DayOfWeek.MONDAY, TimeUnit.SECONDS
- **Interface static method imports**: Comparator.comparing, Predicate.not (Java 8+)
- **Annotation type imports**: Retention, Target, ElementType
- **Contextual keyword packages**: record, sealed, permits, var, yield, module
- **Unicode identifiers**: Japanese, French, and other non-ASCII names
- **Single-character names**: a.b.C, x.Y
- **Special characters**: _underscore, $dollar prefixed identifiers
- **Shadowing imports**: Types that shadow java.lang (String, Integer, etc.)
- **Conflicting wildcards**: Multiple wildcards with explicit resolution
- **Comments and whitespace**: Correctly handled, accurate line numbers
- **Duplicate imports**: Each captured separately with unique hash

### ⚠️ Edge Cases Handled
- **Module imports**: Require Java 23+ and tree-sitter support for module syntax
- **Comments in imports**: Line numbers reflect actual import statement, not comments
- **Duplicate imports**: Each instance captured separately (no deduplication)
- **Nested types**: `packageOrTypeName` is the enclosing type, not just the package
- **Whitespace variations**: Extra spaces, trailing spaces normalized by tree-sitter

### 🚫 Not Captured (By Design)
- **Generics in imports**: Import statements never contain generic type arguments
- **Import conflict resolution**: Which import "wins" is compiler logic, not extraction
- **Implicit java.lang imports**: Not declared in source, so not extracted

### 📊 Output
- CSV file: `all-imports.csv`
- One row per import declaration
- Unique hash per import for tracking
- Hash based on: filePath + importKind + importedPath + lineNumber + serviceVersionHash
