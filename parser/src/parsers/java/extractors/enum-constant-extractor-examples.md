# EnumConstantExtractor - Examples

This document shows concrete examples of what the EnumConstantExtractor can extract from Java source code.

## Overview

The EnumConstantExtractor identifies and extracts **enum constants** - the individual values defined within Java enum types. It also extracts **enum constant arguments** (constructor parameters) and **annotations** applied to enum constants.

## What It Extracts

### EnumConstant
For each enum constant, it captures:
- **Name**: The constant identifier (e.g., `ACTIVE`, `PENDING`)
- **Qualified name**: Full path including enum type (e.g., `com.example.Status.ACTIVE`)
- **Ordinal**: Position in the enum (0, 1, 2, ...)
- **Arguments**: Constructor arguments as strings
- **Has body**: Whether the constant has an anonymous class body
- **Owner**: Hash of the containing enum type
- **Location**: startLine, endLine

### EnumConstantArgumentReference
For each constructor argument, it captures:
- **Argument value**: The actual value as string
- **Value type**: STRING_LITERAL, NUMBER_LITERAL, BOOLEAN_LITERAL, ENUM_CONSTANT, CLASS_REFERENCE, CONSTANT_EXPRESSION, etc.
- **Position**: Order in argument list (0, 1, 2, ...)
- **Potential qualified name**: Resolved type for class/enum references
- **Location**: startLine, endLine

### Annotations on Enum Constants
Reuses the AnnotationExtractor to capture annotations applied to individual enum constants.

---

## Example 1: Simple Enum Constants (No Arguments)

### Input Java Code
```java
package com.example.status;

public enum Status {
    ACTIVE,
    INACTIVE,
    PENDING
}
```

### Extracted EnumConstants
| name | qualifiedName | ordinal | arguments | hasBody |
|------|---------------|---------|-----------|---------|
| ACTIVE | com.example.status.Status.ACTIVE | 0 | [] | false |
| INACTIVE | com.example.status.Status.INACTIVE | 1 | [] | false |
| PENDING | com.example.status.Status.PENDING | 2 | [] | false |

### Extracted EnumConstantArgumentReferences
```csv
(none - no constructor arguments)
```

**Capabilities Demonstrated**:
- ✅ Extracts all enum constants
- ✅ Assigns correct ordinals (0-indexed)
- ✅ Builds qualified names
- ✅ Handles constants without arguments

---

## Example 2: Enum Constants with Constructor Arguments

### Input Java Code
```java
package com.example.http;

public enum HttpStatus {
    OK(200, "Success"),
    NOT_FOUND(404, "Not Found"),
    INTERNAL_ERROR(500, "Internal Server Error");
    
    private final int code;
    private final String message;
    
    HttpStatus(int code, String message) {
        this.code = code;
        this.message = message;
    }
}
```

### Extracted EnumConstants
| name | qualifiedName | ordinal | arguments | hasBody |
|------|---------------|---------|-----------|---------|
| OK | com.example.http.HttpStatus.OK | 0 | ["200", "\"Success\""] | false |
| NOT_FOUND | com.example.http.HttpStatus.NOT_FOUND | 1 | ["404", "\"Not Found\""] | false |
| INTERNAL_ERROR | com.example.http.HttpStatus.INTERNAL_ERROR | 2 | ["500", "\"Internal Server Error\""] | false |

### Extracted EnumConstantArgumentReferences
| argumentValue | valueType | position | enumConstant |
|---------------|-----------|----------|--------------|
| 200 | NUMBER_LITERAL | 0 | OK |
| "Success" | STRING_LITERAL | 1 | OK |
| 404 | NUMBER_LITERAL | 0 | NOT_FOUND |
| "Not Found" | STRING_LITERAL | 1 | NOT_FOUND |
| 500 | NUMBER_LITERAL | 0 | INTERNAL_ERROR |
| "Internal Server Error" | STRING_LITERAL | 1 | INTERNAL_ERROR |

**Capabilities Demonstrated**:
- ✅ Extracts constructor arguments
- ✅ Identifies NUMBER_LITERAL and STRING_LITERAL types
- ✅ Preserves argument order via position

---

## Example 3: Enum Constants with Enum/Class References

### Input Java Code
```java
package com.example.priority;

import com.example.colors.Color;

public enum Priority {
    HIGH(Color.RED, 1),
    MEDIUM(Color.YELLOW, 2),
    LOW(Color.GREEN, 3);
    
    private final Color color;
    private final int level;
    
    Priority(Color color, int level) {
        this.color = color;
        this.level = level;
    }
}
```

### Extracted EnumConstantArgumentReferences
| argumentValue | valueType | position | potentialQualifiedName |
|---------------|-----------|----------|------------------------|
| Color.RED | ENUM_CONSTANT | 0 | com.example.colors.Color |
| 1 | NUMBER_LITERAL | 1 | |
| Color.YELLOW | ENUM_CONSTANT | 0 | com.example.colors.Color |
| 2 | NUMBER_LITERAL | 1 | |
| Color.GREEN | ENUM_CONSTANT | 0 | com.example.colors.Color |
| 3 | NUMBER_LITERAL | 1 | |

**Capabilities Demonstrated**:
- ✅ Identifies ENUM_CONSTANT value type for field access
- ✅ Resolves qualified names using imports
- ✅ Mixed argument types in same constructor

---

## Example 4: Enum Constants with Anonymous Class Bodies

### Input Java Code
```java
package com.example.operation;

public enum Operation {
    ADD("+") {
        @Override
        public int apply(int a, int b) {
            return a + b;
        }
    },
    SUBTRACT("-") {
        @Override
        public int apply(int a, int b) {
            return a - b;
        }
    };
    
    private final String symbol;
    
    Operation(String symbol) {
        this.symbol = symbol;
    }
    
    public abstract int apply(int a, int b);
}
```

### Extracted EnumConstants
| name | qualifiedName | ordinal | arguments | hasBody |
|------|---------------|---------|-----------|---------|
| ADD | com.example.operation.Operation.ADD | 0 | ["\"+\""] | **true** |
| SUBTRACT | com.example.operation.Operation.SUBTRACT | 1 | ["\"-\""] | **true** |

**Capabilities Demonstrated**:
- ✅ Detects anonymous class bodies (`hasBody: true`)
- ✅ Still extracts name and arguments correctly
- ✅ Anonymous class methods are handled by separate extractors

---

## Example 5: Annotated Enum Constants

### Input Java Code
```java
package com.example.status;

public enum TaskStatus {
    @Deprecated
    LEGACY_ACTIVE,
    
    @JsonValue("active")
    ACTIVE,
    
    @JsonValue("pending")
    @Description("Task is waiting for processing")
    PENDING
}
```

### Extracted EnumConstants
| name | ordinal | hasBody |
|------|---------|---------|
| LEGACY_ACTIVE | 0 | false |
| ACTIVE | 1 | false |
| PENDING | 2 | false |

### Extracted TypeAnnotations (via AnnotationExtractor)
| annotationName | context | ownerHash |
|----------------|---------|-----------|
| Deprecated | ENUM_CONSTANT | (hash of LEGACY_ACTIVE) |
| JsonValue | ENUM_CONSTANT | (hash of ACTIVE) |
| JsonValue | ENUM_CONSTANT | (hash of PENDING) |
| Description | ENUM_CONSTANT | (hash of PENDING) |

### Extracted AnnotationArgumentReferences
| argumentName | argumentValue | valueType | parentAnnotation |
|--------------|---------------|-----------|------------------|
| value | "active" | STRING_LITERAL | JsonValue on ACTIVE |
| value | "pending" | STRING_LITERAL | JsonValue on PENDING |
| value | "Task is waiting..." | STRING_LITERAL | Description on PENDING |

**Capabilities Demonstrated**:
- ✅ Extracts annotations on enum constants
- ✅ Links annotations to correct enum constant via hash
- ✅ Multiple annotations on same constant
- ✅ Reuses AnnotationExtractor for annotation arguments

---

## Example 6: Complex Argument Expressions

### Input Java Code
```java
package com.example.timeout;

public enum Timeout {
    SHORT(1000),
    MEDIUM(5 * 1000),
    LONG(60 * 1000),
    CUSTOM(-1);
    
    private final int millis;
    
    Timeout(int millis) {
        this.millis = millis;
    }
}
```

### Extracted EnumConstantArgumentReferences
| argumentValue | valueType | position |
|---------------|-----------|----------|
| 1000 | NUMBER_LITERAL | 0 |
| 5 * 1000 | CONSTANT_EXPRESSION | 0 |
| 60 * 1000 | CONSTANT_EXPRESSION | 0 |
| -1 | CONSTANT_EXPRESSION | 0 |

**Capabilities Demonstrated**:
- ✅ Simple number literals detected as NUMBER_LITERAL
- ✅ Binary expressions (multiplication) detected as CONSTANT_EXPRESSION
- ✅ Unary expressions (negative numbers) detected as CONSTANT_EXPRESSION

---

## Example 7: Class Literal and Array Creation Arguments

### Input Java Code
```java
package com.example.type;

public enum TypeMapping {
    STRING(String.class, new String[]{"str", "string"}),
    INTEGER(Integer.class, new String[]{"int", "integer"});
    
    private final Class<?> type;
    private final String[] aliases;
    
    TypeMapping(Class<?> type, String[] aliases) {
        this.type = type;
        this.aliases = aliases;
    }
}
```

### Extracted EnumConstantArgumentReferences
| argumentValue | valueType | position | potentialQualifiedName |
|---------------|-----------|----------|------------------------|
| String.class | CLASS_REFERENCE | 0 | java.lang.String |
| new String[]{"str", "string"} | CONSTANT_EXPRESSION | 1 | java.lang.String |
| Integer.class | CLASS_REFERENCE | 0 | java.lang.Integer |
| new String[]{"int", "integer"} | CONSTANT_EXPRESSION | 1 | java.lang.String |

**Capabilities Demonstrated**:
- ✅ CLASS_REFERENCE detection for `.class` literals
- ✅ Resolves class literal qualified names
- ✅ Array creation expressions captured as CONSTANT_EXPRESSION

---

## Tree-Sitter Node Structure

For reference, here's how tree-sitter parses enum constants:

```
enum_declaration
├── modifiers (public)
├── "enum"
├── identifier: "Status"
└── enum_body
    ├── "{"
    ├── enum_constant
    │   ├── modifiers
    │   │   └── marker_annotation
    │   │       └── identifier: "Deprecated"
    │   ├── identifier: "ACTIVE"
    │   ├── argument_list
    │   │   ├── "("
    │   │   ├── string_literal: "\"Active\""
    │   │   ├── ","
    │   │   ├── decimal_integer_literal: "1"
    │   │   └── ")"
    │   └── class_body (optional, for anonymous classes)
    ├── ","
    ├── enum_constant
    │   └── identifier: "INACTIVE"
    ├── ";"
    └── "}"
```

---

## Value Type Detection Summary

| Node Type | ArgumentValueType |
|-----------|-------------------|
| `string_literal` | STRING_LITERAL |
| `decimal_integer_literal`, `hex_integer_literal`, etc. | NUMBER_LITERAL |
| `decimal_floating_point_literal`, `hex_floating_point_literal` | NUMBER_LITERAL |
| `true`, `false` | BOOLEAN_LITERAL |
| `null_literal` | NULL |
| `character_literal` | CHAR_LITERAL |
| `class_literal` | CLASS_REFERENCE |
| `field_access` | ENUM_CONSTANT |
| `identifier` | ENUM_CONSTANT |
| `object_creation_expression` | CONSTANT_EXPRESSION |
| `array_creation_expression` | CONSTANT_EXPRESSION |
| `array_initializer` | CONSTANT_EXPRESSION |
| `unary_expression` | CONSTANT_EXPRESSION |
| `binary_expression` | CONSTANT_EXPRESSION |
| (other) | UNKNOWN |

---

## Related Extractors

- **AnnotationExtractor**: Reused to extract annotations on enum constants
- **TypeRegistryExtractor**: Extracts the parent enum type declaration
- **FieldExtractor**: Extracts fields within the enum (like `private final int code`)
- **TypeMethodExtractor**: Extracts methods within the enum
