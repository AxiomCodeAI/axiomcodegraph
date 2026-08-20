# AnnotationExtractor - Examples

This document shows concrete examples of what the AnnotationExtractor can extract from Java source code.

## Overview

The AnnotationExtractor identifies and extracts **annotations** - the metadata declarations in Java that provide information about code elements. It also extracts **annotation arguments** - the values passed to annotations.

## What It Extracts

### TypeAnnotation
For each annotation, it captures:
- **Annotation name**: Simple or qualified name
- **Kind**: MARKER, SINGLE_VALUE, ARRAY_VALUE, NAMED_ARGUMENTS, NESTED
- **Context**: Where applied (TYPE_DECLARATION, FIELD, METHOD, PARAMETER, etc.)
- **Position**: Order in annotation list (0, 1, 2, ...)
- **Owner**: Hash of the annotated element
- **Parent**: Hash of parent annotation (for nested)
- **Depth**: Nesting level (0 = top-level)
- **Location**: startLine, endLine
- **Meta-annotation flag**: Whether it's a meta-annotation

### AnnotationArgumentReference
For each argument, it captures:
- **Argument name**: Parameter name (or "value" for shorthand)
- **Argument value**: The actual value as string
- **Value type**: CHAR_LITERAL, STRING_LITERAL, NUMBER_LITERAL, BOOLEAN_LITERAL, ENUM_CONSTANT, CONSTANT_EXPRESSION, CLASS_REFERENCE, NESTED_ANNOTATION, NULL, UNKNOWN
- **Position**: Order in argument list
- **Array index**: Position within array (if from array expansion)
- **Parent annotation**: Hash of containing annotation
- **Referenced type**: For CLASS_REFERENCE values
- **Nested annotation**: For NESTED_ANNOTATION values

---

## Example 1: Marker Annotation

### Input Java Code
```java
package com.example.model;

@Deprecated
public class OldService {
}
```

### Extracted TypeAnnotation
```csv
annotationName: Deprecated
kind: MARKER
context: TYPE_DECLARATION
position: 0
depth: 0
isMetaAnnotation: false
```

### Extracted AnnotationArgumentReference
```csv
(none - marker annotations have no arguments)
```

**Capabilities Demonstrated**:
- ✅ Identifies marker annotations
- ✅ No arguments extracted
- ✅ TYPE_DECLARATION context

---

## Example 2: Single Value Annotation

### Input Java Code
```java
package com.example.config;

@Timeout(5000)
public class SlowService {
}
```

### Extracted TypeAnnotation
```csv
annotationName: Timeout
kind: SINGLE_VALUE
context: TYPE_DECLARATION
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value (implicit)
argumentValue: 5000
valueType: NUMBER_LITERAL
position: 0
arrayIndex: (none)
```

**Capabilities Demonstrated**:
- ✅ Single value shorthand syntax
- ✅ Implicit "value" argument name
- ✅ NUMBER_LITERAL detection

---

## Example 3: Named Arguments

### Input Java Code
```java
package com.example.persistence;

@Column(name = "user_id", nullable = false, length = 50)
public class UserEntity {
}
```

### Extracted TypeAnnotation
```csv
annotationName: Column
kind: NAMED_ARGUMENTS
context: TYPE_DECLARATION
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: name
   argumentValue: "user_id"
   valueType: STRING_LITERAL
   position: 0

2. argumentName: nullable
   argumentValue: false
   valueType: BOOLEAN_LITERAL
   position: 1

3. argumentName: length
   argumentValue: 50
   valueType: NUMBER_LITERAL
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Multiple named arguments
- ✅ Mixed value types (STRING, BOOLEAN, NUMBER)
- ✅ Position tracking
- ✅ NAMED_ARGUMENTS kind

---

## Example 4: Array Value Annotation

### Input Java Code
```java
package com.example.validation;

@Target({ElementType.TYPE, ElementType.METHOD})
public @interface CustomAnnotation {
}
```

### Extracted TypeAnnotation
```csv
annotationName: Target
kind: ARRAY_VALUE
context: TYPE_DECLARATION
```

### Extracted AnnotationArgumentReferences (Array Expanded)
```csv
1. argumentName: value
   argumentValue: ElementType.TYPE
   valueType: ENUM_CONSTANT
   position: 0
   arrayIndex: 0

2. argumentName: value
   argumentValue: ElementType.METHOD
   valueType: ENUM_CONSTANT
   position: 0
   arrayIndex: 1
```

**Capabilities Demonstrated**:
- ✅ Array value shorthand
- ✅ **Array expansion** - each element as separate row
- ✅ arrayIndex tracking (0, 1, 2, ...)
- ✅ ENUM_CONSTANT detection
- ✅ Same argumentName and position for all array elements

---

## Example 5: String Literals

### Input Java Code
```java
package com.example.web;

@RequestMapping("/api/users")
public class UserController {
}
```

### Extracted TypeAnnotation
```csv
annotationName: RequestMapping
kind: SINGLE_VALUE
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: "/api/users"
valueType: STRING_LITERAL
```

**Capabilities Demonstrated**:
- ✅ String literal extraction
- ✅ Preserves string content

---

## Example 6: Class Reference (.class syntax)

### Input Java Code
```java
package com.example.json;

@JsonDeserialize(using = CustomDeserializer.class)
public class DataObject {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: using
argumentValue: CustomDeserializer
valueType: CLASS_REFERENCE
referencedTypeHash: TYPE_REGISTRY_<hash_of_CustomDeserializer>
```

**Note**: `.class` suffix is automatically stripped from the value.

**Capabilities Demonstrated**:
- ✅ Detects CLASS_REFERENCE pattern
- ✅ Strips `.class` suffix
- ✅ Links to TypeRegistry via hash
- ✅ Enables dependency tracking

---

## Example 7: Nested Annotation

### Input Java Code
```java
package com.example.jpa;

@JoinColumn(foreignKey = @ForeignKey(name = "fk_user_id"))
public class OrderEntity {
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: JoinColumn
   kind: NESTED
   depth: 0
   parentAnnotationHash: (none)

2. annotationName: ForeignKey
   kind: NAMED_ARGUMENTS
   depth: 1
   parentAnnotationHash: <hash_of_JoinColumn>
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: foreignKey
   argumentValue: ForeignKey
   valueType: NESTED_ANNOTATION
   parentAnnotationHash: <hash_of_JoinColumn>
   nestedAnnotationHash: <hash_of_ForeignKey>

2. argumentName: name
   argumentValue: "fk_user_id"
   valueType: STRING_LITERAL
   parentAnnotationHash: <hash_of_ForeignKey>
```

**Capabilities Demonstrated**:
- ✅ Nested annotation detection
- ✅ Parent-child relationships via hashes
- ✅ Depth tracking (0 = outer, 1 = nested)
- ✅ NESTED_ANNOTATION value type
- ✅ Hierarchical structure

---

## Example 8: Multiple Annotations on One Element

### Input Java Code
```java
package com.example.service;

@Service
@Transactional
@Cacheable
public class UserService {
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: Service
   kind: MARKER
   position: 0

2. annotationName: Transactional
   kind: MARKER
   position: 1

3. annotationName: Cacheable
   kind: MARKER
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Multiple annotations per element
- ✅ Position tracking (order matters)
- ✅ All share same ownerHash

---

## Example 9: Method Annotation

### Input Java Code
```java
package com.example.web;

public class Controller {
    
    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        return null;
    }
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: GetMapping
   kind: SINGLE_VALUE
   context: METHOD
   
2. annotationName: PathVariable
   kind: MARKER
   context: PARAMETER
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: "/users/{id}"
valueType: STRING_LITERAL
parentAnnotationHash: <hash_of_GetMapping>
```

**Capabilities Demonstrated**:
- ✅ METHOD context
- ✅ PARAMETER context
- ✅ Different contexts for different annotations

---

## Example 10: Field Annotation

### Input Java Code
```java
package com.example.model;

public class User {
    
    @NotNull
    @Size(min = 3, max = 50)
    private String username;
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: NotNull
   kind: MARKER
   context: FIELD

2. annotationName: Size
   kind: NAMED_ARGUMENTS
   context: FIELD
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: min
   argumentValue: 3
   valueType: NUMBER_LITERAL

2. argumentName: max
   argumentValue: 50
   valueType: NUMBER_LITERAL
```

**Capabilities Demonstrated**:
- ✅ FIELD context
- ✅ Multiple annotations on field
- ✅ Validation annotation patterns

---

## Example 11: Enum Constant as Value

### Input Java Code
```java
package com.example.web;

@RequestMapping(method = RequestMethod.GET)
public class GetController {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: method
argumentValue: RequestMethod.GET
valueType: ENUM_CONSTANT
```

**Capabilities Demonstrated**:
- ✅ Detects enum constant references
- ✅ Preserves qualified enum syntax

---

## Example 12: Array with Mixed Values

### Input Java Code
```java
package com.example.web;

@RequestMapping(
    value = {"/api/v1", "/api/v2"},
    method = {RequestMethod.GET, RequestMethod.POST}
)
public class MultiPathController {
}
```

### Extracted TypeAnnotation
```csv
annotationName: RequestMapping
kind: NAMED_ARGUMENTS
```

### Extracted AnnotationArgumentReferences (Arrays Expanded)
```csv
1. argumentName: value
   argumentValue: "/api/v1"
   valueType: STRING_LITERAL
   position: 0
   arrayIndex: 0

2. argumentName: value
   argumentValue: "/api/v2"
   valueType: STRING_LITERAL
   position: 0
   arrayIndex: 1

3. argumentName: method
   argumentValue: RequestMethod.GET
   valueType: ENUM_CONSTANT
   position: 1
   arrayIndex: 0

4. argumentName: method
   argumentValue: RequestMethod.POST
   valueType: ENUM_CONSTANT
   position: 1
   arrayIndex: 1
```

**Capabilities Demonstrated**:
- ✅ Multiple array arguments
- ✅ Each array expanded separately
- ✅ Position distinguishes different arguments
- ✅ arrayIndex distinguishes elements within array

---

## Example 13: Meta-Annotation

### Input Java Code
```java
package com.example.annotations;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface CustomAnnotation {
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: Target
   context: TYPE_DECLARATION
   isMetaAnnotation: true
   (annotation on annotation definition)

2. annotationName: Retention
   context: TYPE_DECLARATION
   isMetaAnnotation: true
```

**Capabilities Demonstrated**:
- ✅ Detects meta-annotations
- ✅ isMetaAnnotation flag set
- ✅ Special meta-annotation tracking

---

## Example 14: Null Value (Rare)

### Input Java Code
```java
package com.example.json;

@JsonProperty(defaultValue = null)
public class OptionalField {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: defaultValue
argumentValue: null
valueType: NULL
```

**Capabilities Demonstrated**:
- ✅ Handles null literals
- ✅ NULL value type

---

## Example 15: Type Parameter Annotation (Java 8+)

### Input Java Code
```java
package com.inventory.auth.domain;

public class GenericsTortureTest<@TypeAnno("Outer") T> {
    private T value;
}
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
isMetaAnnotation: false
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: "Outer"
valueType: STRING_LITERAL
position: 0
parentAnnotationHash: TYPE_ANNOTATION_<hash>
```

**Capabilities Demonstrated**:
- ✅ TYPE_PARAMETER context
- ✅ typeParameterHash field links annotation to type parameter
- ✅ Single-value annotation on type parameter

---

## Example 16: Type Parameter with Class Reference Arguments

### Input Java Code
```java
package com.inventory.auth.domain;

public class ValidatedContainer<
    @Validated(validator = StringValidator.class, groups = ValidationGroup.class) S
> {
    private S value;
}
```

### Extracted TypeAnnotation
```csv
annotationName: Validated
kind: NAMED_ARGUMENTS
context: TYPE_PARAMETER
ownerHash: TYPE_PARAMETER_<hash_of_S>
typeParameterHash: TYPE_PARAMETER_<hash_of_S>
position: 0
depth: 0
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: validator
   argumentValue: StringValidator
   valueType: CLASS_REFERENCE
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_<hash>

2. argumentName: groups
   argumentValue: ValidationGroup
   valueType: CLASS_REFERENCE
   position: 1
   parentAnnotationHash: TYPE_ANNOTATION_<hash>
```

### Related TypeReferences (from annotation arguments)
```csv
1. typeName: StringValidator
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash>

2. typeName: ValidationGroup
   context: TYPE_PARAMETER_ANNOTATION
   ownerKind: ANNOTATION_ARGUMENT
   ownerHash: ANNOTATION_ARGUMENT_<hash>
```

**Capabilities Demonstrated**:
- ✅ Named arguments on type parameter annotations
- ✅ Class reference arguments extracted
- ✅ TypeReference entries created for class literals
- ✅ TYPE_PARAMETER_ANNOTATION context for type references

---

## Example 17: Nested Annotation on Type Parameter

### Input Java Code
```java
package com.inventory.auth.domain;

public class NestedAnnotationTest<
    @Wrapper(value = "NestedValue", inner = @TypeAnno("Inner")) K
> {
    private K key;
}
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
- ✅ Parent-child linking via parentAnnotationHash
- ✅ Depth tracking for nested annotations
- ✅ Arguments from both outer and inner annotations

---

## Example 18: Complex Nested Structure

### Input Java Code
```java
package com.example.jpa;

@JoinTable(
    name = "user_roles",
    joinColumns = @JoinColumn(name = "user_id"),
    inverseJoinColumns = @JoinColumn(name = "role_id")
)
private Set<Role> roles;
```

### Extracted TypeAnnotations
```csv
1. annotationName: JoinTable
   kind: NESTED
   depth: 0
   hash: TYPE_ANNOTATION_a1b2c3d4...

2. annotationName: JoinColumn
   kind: NAMED_ARGUMENTS
   depth: 1
   parentAnnotationHash: TYPE_ANNOTATION_a1b2c3d4...
   hash: TYPE_ANNOTATION_e5f6g7h8...

3. annotationName: JoinColumn
   kind: NAMED_ARGUMENTS
   depth: 1
   parentAnnotationHash: TYPE_ANNOTATION_a1b2c3d4...
   hash: TYPE_ANNOTATION_i9j0k1l2...
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: name
   argumentValue: "user_roles"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_a1b2c3d4...

2. argumentName: joinColumns
   argumentValue: JoinColumn
   valueType: NESTED_ANNOTATION
   position: 1
   parentAnnotationHash: TYPE_ANNOTATION_a1b2c3d4...
   nestedAnnotationHash: TYPE_ANNOTATION_e5f6g7h8...

3. argumentName: inverseJoinColumns
   argumentValue: JoinColumn
   valueType: NESTED_ANNOTATION
   position: 2
   parentAnnotationHash: TYPE_ANNOTATION_a1b2c3d4...
   nestedAnnotationHash: TYPE_ANNOTATION_i9j0k1l2...

4. argumentName: name
   argumentValue: "user_id"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_e5f6g7h8...

5. argumentName: name
   argumentValue: "role_id"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_i9j0k1l2...
```

### Understanding Nested Annotation Linkage

**Row 2 - The Reference (joinColumns argument):**
- Says: "There is an argument named 'joinColumns' whose VALUE is a nested annotation"
- `parentAnnotationHash`: `a1b2...` (belongs to JoinTable)
- `nestedAnnotationHash`: `e5f6...` (references first JoinColumn annotation)
- Think: `joinColumns = @JoinColumn(...)`

**Row 4 - The Content (name argument in first JoinColumn):**
- Says: "There is an argument named 'name' with value 'user_id'"
- `parentAnnotationHash`: `e5f6...` (belongs to first JoinColumn)
- Think: `name = "user_id"`

**The Linkage via Hash e5f6...:**
```
Row 2: nestedAnnotationHash=e5f6... ──┐
                                       │ Links to:
                                       ↓
Row 4: parentAnnotationHash=e5f6... ───┘
```

This enables traversal:
1. **From parent to nested**: Filter arguments where `parentAnnotationHash=a1b2...` → Find `joinColumns` → Get `nestedAnnotationHash=e5f6...`
2. **From nested to content**: Filter arguments where `parentAnnotationHash=e5f6...` → Find `name="user_id"`

**Capabilities Demonstrated**:
- ✅ Mixed argument types (STRING_LITERAL, NESTED_ANNOTATION)
- ✅ Multiple nested annotations in same parent
- ✅ Nested annotation argument with `nestedAnnotationHash`
- ✅ Proper parent-child linking via hashes
- ✅ Position tracking at each level
- ✅ Two-row pattern: reference row + content row(s)
- ✅ Real-world JPA many-to-many relationship pattern

---

## Example 16: Boolean Literals

### Input Java Code
```java
package com.example.jpa;

@Column(nullable = false, unique = true)
public class UniqueField {
}
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: nullable
   argumentValue: false
   valueType: BOOLEAN_LITERAL

2. argumentName: unique
   argumentValue: true
   valueType: BOOLEAN_LITERAL
```

**Capabilities Demonstrated**:
- ✅ Boolean literal detection
- ✅ true/false values

---

## Example 17: Constructor Parameter Annotation

### Input Java Code
```java
package com.example.di;

public class Service {
    
    public Service(@Autowired UserRepository repo) {
    }
}
```

### Extracted TypeAnnotation
```csv
annotationName: Autowired
kind: MARKER
context: PARAMETER
ownerKind: CONSTRUCTOR_PARAMETER
```

**Capabilities Demonstrated**:
- ✅ Constructor parameter context
- ✅ Dependency injection patterns

---

## Example 18: Type Use Annotation

### Input Java Code
```java
package com.example.nullsafe;

public class SafeCode {
    private List<@NonNull String> names;
}
```

### Extracted TypeAnnotation
```csv
annotationName: NonNull
kind: MARKER
context: TYPE_USE
```

**Capabilities Demonstrated**:
- ✅ Type use annotations
- ✅ Annotations on generic type arguments

---

## Example 19: Package Annotation

### Input Java Code (package-info.java)
```java
@ParametersAreNonnullByDefault
package com.example.service;

import javax.annotation.ParametersAreNonnullByDefault;
```

### Extracted TypeAnnotation
```csv
annotationName: ParametersAreNonnullByDefault
kind: MARKER
context: PACKAGE
```

**Capabilities Demonstrated**:
- ✅ Package-level annotations
- ✅ PACKAGE context

---

## Example 20: Annotation on Annotation Method

### Input Java Code
```java
package com.example.annotations;

public @interface ConfigProperty {
    
    @AliasFor("name")
    String value() default "";
    
    @AliasFor("value")
    String name() default "";
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: AliasFor
   context: METHOD
   (on annotation method)
   
2. annotationName: AliasFor
   context: METHOD
```

**Capabilities Demonstrated**:
- ✅ Annotations on annotation methods
- ✅ Meta-level annotation usage

---

## Example 21: Character Literal

### Input Java Code
```java
package com.example.config;

@Delimiter(',')
public class CsvParser {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: ','
valueType: CHAR_LITERAL
position: 0
```

**Capabilities Demonstrated**:
- ✅ Character literal detection
- ✅ CHAR_LITERAL value type
- ✅ Preserves single quotes in value

---

## Example 22: Constant Expression (Arithmetic)

### Input Java Code
```java
package com.example.config;

@Timeout(60 * 1000)  // 60 seconds in milliseconds
public class Service {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: 60 * 1000
valueType: CONSTANT_EXPRESSION
position: 0
```

**Capabilities Demonstrated**:
- ✅ Compile-time arithmetic expression detection
- ✅ CONSTANT_EXPRESSION value type
- ✅ Preserves full expression text
- ✅ Maintains semantic meaning (60 seconds)

---

## Example 23: Constant Expression (Bitwise)

### Input Java Code
```java
package com.example.config;

@Permission(READ | WRITE | EXECUTE)  // Assuming these are constants
@BitMask(1 << 3)
public class FileAccess {
}
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: value
   argumentValue: READ | WRITE | EXECUTE
   valueType: CONSTANT_EXPRESSION
   
2. argumentName: value
   argumentValue: 1 << 3
   valueType: CONSTANT_EXPRESSION
```

**Capabilities Demonstrated**:
- ✅ Bitwise operations (OR, left shift)
- ✅ Complex constant expressions
- ✅ Preserves operator semantics

---

## Example 24: Constant Expression (String Concatenation)

### Input Java Code
```java
package com.example.config;

@Message("Error: " + "Connection failed")
public class ErrorHandler {
}
```

### Extracted AnnotationArgumentReference
```csv
argumentName: value
argumentValue: "Error: " + "Connection failed"
valueType: CONSTANT_EXPRESSION
position: 0
```

**Capabilities Demonstrated**:
- ✅ String concatenation detection
- ✅ Preserves compile-time string building
- ✅ Full expression captured

---

## Example 25: Static Final Constant Reference

### Input Java Code
```java
package com.example.config;

public class Constants {
    public static final int DEFAULT_TIMEOUT = 5000;
    public static final String ERROR_MESSAGE = "Connection failed";
}

@Timeout(Constants.DEFAULT_TIMEOUT)
@Message(Constants.ERROR_MESSAGE)
public class ConfiguredService {
}
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: value
   argumentValue: Constants.DEFAULT_TIMEOUT
   valueType: ENUM_CONSTANT
   (Note: Cannot distinguish from enum without type resolution)
   
2. argumentName: value
   argumentValue: Constants.ERROR_MESSAGE
   valueType: ENUM_CONSTANT
```

**Capabilities Demonstrated**:
- ✅ Static final field references detected
- ✅ Classified as ENUM_CONSTANT (same pattern as enums)
- ✅ Qualified name preserved
- ⚠️ Limitation: Cannot distinguish constant from enum without type resolution

---

## Example 26: Mixed Constant Expressions

### Input Java Code
```java
package com.example.config;

@Config(
    timeout = Constants.BASE_TIMEOUT * 2,
    message = "Prefix: " + Constants.ERROR_MESSAGE,
    flags = FLAG_A | FLAG_B
)
public class AdvancedConfig {
}
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: timeout
   argumentValue: Constants.BASE_TIMEOUT * 2
   valueType: CONSTANT_EXPRESSION
   position: 0
   
2. argumentName: message
   argumentValue: "Prefix: " + Constants.ERROR_MESSAGE
   valueType: CONSTANT_EXPRESSION
   position: 1
   
3. argumentName: flags
   argumentValue: FLAG_A | FLAG_B
   valueType: CONSTANT_EXPRESSION
   position: 2
```

**Capabilities Demonstrated**:
- ✅ Mixed constant/expression combinations
- ✅ Field access within expressions
- ✅ All operators preserved (*, +, |)

---

## Example 27: Nested Annotations in Arrays

### Input Java Code
```java
package com.example.config;

@AnnotationContainer(annotations = {
    @Nested("first"),
    @Nested("second"),
    @Nested("third")
})
public class NestedAnnotationTest {
}
```

### Extracted TypeAnnotations
```csv
1. annotationName: AnnotationContainer
   kind: NESTED
   depth: 0
   hash: TYPE_ANNOTATION_dc5f3e57...

2. annotationName: Nested
   kind: SINGLE_VALUE
   depth: 1
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   hash: TYPE_ANNOTATION_ea806d6d...
   arrayPosition: 0

3. annotationName: Nested
   kind: SINGLE_VALUE
   depth: 1
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   hash: TYPE_ANNOTATION_3e033ac3...
   arrayPosition: 1

4. annotationName: Nested
   kind: SINGLE_VALUE
   depth: 1
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   hash: TYPE_ANNOTATION_9d9bfd36...
   arrayPosition: 2
```

### Extracted AnnotationArgumentReferences
```csv
1. argumentName: annotations
   argumentValue: Nested
   valueType: NESTED_ANNOTATION
   position: 0
   arrayIndex: 0
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   nestedAnnotationHash: TYPE_ANNOTATION_ea806d6d...

2. argumentName: annotations
   argumentValue: Nested
   valueType: NESTED_ANNOTATION
   position: 0
   arrayIndex: 1
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   nestedAnnotationHash: TYPE_ANNOTATION_3e033ac3...

3. argumentName: annotations
   argumentValue: Nested
   valueType: NESTED_ANNOTATION
   position: 0
   arrayIndex: 2
   parentAnnotationHash: TYPE_ANNOTATION_dc5f3e57...
   nestedAnnotationHash: TYPE_ANNOTATION_9d9bfd36...

4. argumentName: value
   argumentValue: "first"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_ea806d6d...

5. argumentName: value
   argumentValue: "second"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_3e033ac3...

6. argumentName: value
   argumentValue: "third"
   valueType: STRING_LITERAL
   position: 0
   parentAnnotationHash: TYPE_ANNOTATION_9d9bfd36...
```

### Understanding Array-Based Nested Annotations

**Key Pattern**: When nested annotations are in an array, each gets:
- Its own `TypeAnnotation` entry with unique hash
- A corresponding `AnnotationArgumentReference` with `arrayIndex`
- Proper `nestedAnnotationHash` linking

**Rows 1-3: Array Element References**
- All have same `argumentName` ("annotations") and `position` (0)
- Distinguished by `arrayIndex` (0, 1, 2)
- Each has different `nestedAnnotationHash` linking to its respective nested annotation

**Rows 4-6: Content of Each Nested Annotation**
- Each belongs to a different nested annotation (via different `parentAnnotationHash`)
- Contains the actual argument values for that nested annotation instance

**Linkage Example for First Element**:
```
Row 1: annotations[0] → nestedAnnotationHash=ea806d6d...
                              ↓
Row 4: parentAnnotationHash=ea806d6d... → value="first"
```

**Capabilities Demonstrated**:
- ✅ Arrays of nested annotations
- ✅ Each array element gets unique hash
- ✅ `arrayIndex` tracks position in array
- ✅ `nestedAnnotationHash` links array element to annotation
- ✅ Multiple annotation instances with same type but different arguments
- ✅ Full traversal from container → array element → nested content

---

## Summary of Extraction Capabilities

### ✅ Annotation Kinds

- **MARKER**: No arguments (e.g., `@Override`)
- **SINGLE_VALUE**: Single value shorthand (e.g., `@Timeout(5000)`)
- **ARRAY_VALUE**: Array shorthand (e.g., `@Target({TYPE, METHOD})`)
- **NAMED_ARGUMENTS**: Named parameters (e.g., `@Column(name="id", nullable=false)`)
- **NESTED**: Contains nested annotations

### ✅ Annotation Contexts

- **TYPE_DECLARATION**: On classes, interfaces, enums, records
- **TYPE_PARAMETER**: On type parameters (Java 8+) - e.g., `<@Anno T>`
- **FIELD**: On field declarations
- **METHOD**: On method declarations
- **PARAMETER**: On method parameters
- **CONSTRUCTOR**: On constructors
- **PACKAGE**: On package declarations
- **TYPE_USE**: On type usage (Java 8+)
- **LOCAL_VARIABLE**: On local variables

### ✅ Argument Value Types Supported

- **CHAR_LITERAL**: 'x', 'A', '\n' (character constants)
- **STRING_LITERAL**: "text" (string constants)
- **NUMBER_LITERAL**: 123, 3.14, 0xFF, -1, 999L (numeric literals)
- **BOOLEAN_LITERAL**: true/false (boolean constants)
- **ENUM_CONSTANT**: Enum values and static final constants (e.g., `ElementType.TYPE`, `Constants.MAX_RETRIES`)
- **CONSTANT_EXPRESSION**: Compile-time expressions (e.g., `60 * 1000`, `1 << 3`, `"a" + "b"`)
- **CLASS_REFERENCE**: Class literals (e.g., `User.class`, `int.class`, `String[].class`)
- **NESTED_ANNOTATION**: Nested annotations (e.g., `@ForeignKey(name = "fk")`)
- **NULL**: Null literal
- **UNKNOWN**: Unrecognized patterns

### 🎯 Array Handling

**Key Feature**: Arrays are **expanded**

Input:
```java
@Target({TYPE, METHOD, FIELD})
```

Output (3 separate AnnotationArgumentReference entries):
```csv
1. argumentName=value, value=TYPE, arrayIndex=0
2. argumentName=value, value=METHOD, arrayIndex=1
3. argumentName=value, value=FIELD, arrayIndex=2
```

**Empty Array Handling**:

Java distinguishes between omitted arguments (use default) and explicit empty arrays:

```java
@Config(
    intArray = {},        // Explicitly empty
    stringArray = {"x"}   // Has element
    // timeout omitted - will use default
)
```

Output:
```csv
1. argumentName=intArray, argumentValue=[], valueType=NULL, arrayIndex=0
2. argumentName=stringArray, argumentValue="x", valueType=STRING_LITERAL, arrayIndex=0
(no row for timeout - omitted argument)
```

**Key Distinction**:
- **Empty array `{}`**: Creates 1 row with value `[]`, type `NULL`, arrayIndex `0`
- **Omitted argument**: No rows (relies on annotation default)

**Benefits**:
- Each element has its own type (ENUM_CONSTANT, STRING_LITERAL, etc.)
- Empty arrays are distinguishable from omitted arguments
- Easy to query individual array elements
- No special handling needed for arrays in consumers
- Flat CSV structure

### 🔗 Linking and Relationships

- **Parent-child**: Nested annotations linked via hashes
- **Owner**: Each annotation linked to annotated element
- **Class references**: Linked to TypeRegistry entries
- **Depth tracking**: Nesting level (0, 1, 2, ...)

### 🎯 Cross-Referencing with all-types.csv

**Determining CIA (Codebase-In-Analysis) Scope**:

For non-literal argument values, cross-reference with `all-types.csv` to determine if the referenced type is internal (within your codebase) or external (framework/library):

#### Example: Enum Constant
```csv
argumentValue: HttpMethod.POST
valueType: ENUM_CONSTANT
```

**Analysis Steps**:
1. Extract type name: `HttpMethod`
2. Search `all-types.csv` for `simpleName=HttpMethod`
3. **If found** → Internal enum defined in your codebase
4. **If not found** → External type (e.g., Spring's `HttpMethod`)

#### Example: Class Reference
```csv
argumentValue: UserRepository
valueType: CLASS_REFERENCE
```

**Analysis Steps**:
1. Type name: `UserRepository`
2. Search `all-types.csv` for `simpleName=UserRepository`
3. **If found** → Internal repository interface, get its `TYPE_REGISTRY_xxx` hash
4. **If not found** → External class (e.g., `java.lang.String`)

#### Example: Nested Annotation
```csv
argumentValue: Nested
valueType: NESTED_ANNOTATION
nestedAnnotationHash: TYPE_ANNOTATION_ea806d6d...
```

**Analysis Steps**:
1. Use `nestedAnnotationHash` to link to `all-type-annotations.csv`
2. Get annotation's `ownerHash` from type annotations
3. Look up `ownerHash` in `all-types.csv`
4. **If found** → Internal annotation interface
5. **If not found** → External annotation (e.g., `@Override`)

#### Example: Constant Reference
```csv
argumentValue: AnnotationTestConstants.DEFAULT_TIMEOUT
valueType: ENUM_CONSTANT
```

**Analysis Steps**:
1. Extract class name: `AnnotationTestConstants`
2. Search `all-types.csv` for `simpleName=AnnotationTestConstants`
3. **If found** → Internal constants class
4. **If not found** → External constants (e.g., `MediaType.APPLICATION_JSON_VALUE` from Spring)

**Benefits**:
- **Dependency Analysis**: Identify which external frameworks are referenced
- **Internal Cohesion**: Find all internal types used as annotation arguments
- **Scope Queries**: "Show me all annotations that reference types outside this codebase"
- **Type Resolution**: Distinguish between internal and external references without symbol resolution

### 📊 Special Features

- **Meta-annotation detection**: Flags annotations on annotation definitions
- **Position tracking**: Order in annotation lists
- **Line ranges**: Exact source location
- **Value normalization**: `.class` suffix stripped from class references
- **Qualified names**: Annotation name with package (when needed)

### 🔄 Coordination

AnnotationExtractor is called by:
- **TypeRegistryExtractor** - for type-level annotations
- **TypeParameterExtractor** - for type parameter annotations (Java 8+)
- Processes all annotation contexts during type extraction
- Accumulates results accessible via `getExtractedArguments()` and `getExtractedTypeReferences()`
- Resets internal state between type declarations to prevent cross-contamination

**Data Flow for Type Parameter Annotations:**
```
TypeRegistryExtractor
    ↓ calls
TypeParameterExtractor.extract()
    ↓ calls (for annotations on type params)
AnnotationExtractor.extractFromTypeParameter()
    ↓ extracts
- TypeAnnotation (context=TYPE_PARAMETER, typeParameterHash=...)
- AnnotationArgumentReference (parentAnnotationHash=...)
- TypeReference (context=TYPE_PARAMETER_ANNOTATION, ownerKind=ANNOTATION_ARGUMENT)
    ↓ collected by
TypeParameterExtractor.getExtractedAnnotations()
TypeParameterExtractor.getAnnotationExtractor().getExtractedArguments()
TypeParameterExtractor.getAnnotationExtractor().getExtractedTypeReferences()
    ↓ consumed by
TypeRegistryExtractor
```

**Key Points:**
- AnnotationExtractor tracks `typeParameterHash` when extracting type parameter annotations
- Type references from annotation arguments get `context=TYPE_PARAMETER_ANNOTATION` (not just ANNOTATION_PARAM)
- Owner hash points to `AnnotationArgumentReference` for direct linkability
- All results flow back through TypeParameterExtractor to TypeRegistryExtractor
