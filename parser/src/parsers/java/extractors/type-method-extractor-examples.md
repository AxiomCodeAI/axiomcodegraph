# TypeMethodExtractor - Examples

This document shows concrete examples of what the TypeMethodExtractor extracts from Java source code.

## Overview

The TypeMethodExtractor identifies and extracts **method declarations** from Java type bodies - including regular methods, constructors, abstract methods, default interface methods, static initializers, and annotation elements. It orchestrates the extraction of method parameters, type parameters, annotations, and type references.

## What It Extracts

For each method, it captures:
- **methodName**: The method name
- **signature**: Canonical signature for identity (e.g., `process(String,int):void`)
- **detailedSignature**: Display signature with names (e.g., `process(String name, int count):void`)
- **qualifiedName**: Fully qualified method name
- **methodAccess**: PUBLIC, PRIVATE, PROTECTED, PACKAGE
- **methodModifier**: STATIC, ABSTRACT, FINAL, SYNCHRONIZED, NATIVE, DEFAULT
- **returnType**: Method return type
- **methodKind**: CONSTRUCTOR, INSTANCE_METHOD, STATIC_METHOD, ABSTRACT_METHOD, etc.
- **parameterCount**: Number of parameters
- **hasVarArgs**: Whether method has varargs parameter
- **hasReceiverParameter**: Whether method has receiver parameter
- **hasTypeParameters**: Whether method has generic type parameters
- **throwsExceptions**: Whether method declares thrown exceptions

Additionally, it extracts:
- **MethodParameters**: All parameter entities
- **MethodTypeParameters**: All method-level type parameters
- **TypeReferences**: Return types, throws clauses, parameter types
- **TypeAnnotations**: Method-level annotations

---

## Example 1: Simple Instance Method

### Input Java Code
```java
package com.example.service;

public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature           detailedSignature              methodKind        returnType    paramCount
add           add(int,int):int    add(int a, int b):int          INSTANCE_METHOD   int           2
```

**Capabilities Demonstrated**:
- ✅ Extracts method name and signatures
- ✅ Identifies instance methods
- ✅ Captures return type and parameter count

---

## Example 2: Constructor

### Input Java Code
```java
package com.example.model;

public class User {
    private String name;
    private int age;
    
    public User(String name, int age) {
        this.name = name;
        this.age = age;
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                   detailedSignature                    methodKind    returnType    paramCount
User          User(String,int):void       User(String name, int age):void      CONSTRUCTOR   (null)        2
```

**Capabilities Demonstrated**:
- ✅ Extracts constructors
- ✅ Uses class name as method name
- ✅ Constructor has no return type

---

## Example 3: Static Method

### Input Java Code
```java
package com.example.util;

public class StringUtils {
    public static boolean isEmpty(String str) {
        return str == null || str.isEmpty();
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                detailedSignature                  methodKind       methodModifier
isEmpty       isEmpty(String):boolean  isEmpty(String str):boolean        STATIC_METHOD    STATIC_MODIFIER
```

**Capabilities Demonstrated**:
- ✅ Identifies static methods
- ✅ Captures static modifier

---

## Example 4: Abstract Method

### Input Java Code
```java
package com.example.service;

public abstract class BaseService {
    public abstract void process();
    
    protected abstract String getName();
}
```

### Extracted MethodRegistry
```csv
methodName    signature           methodKind         methodAccess    methodModifier
process       process():void      ABSTRACT_METHOD    PUBLIC          ABSTRACT_MODIFIER
getName       getName():String    ABSTRACT_METHOD    PROTECTED       ABSTRACT_MODIFIER
```

**Capabilities Demonstrated**:
- ✅ Identifies abstract methods (no body)
- ✅ Captures access levels
- ✅ Captures abstract modifier

---

## Example 5: Interface Default Method

### Input Java Code
```java
package com.example.service;

public interface Processor {
    void process();
    
    default void processAll(List<String> items) {
        items.forEach(this::process);
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                  methodKind         methodModifier
process       process():void             ABSTRACT_METHOD    (null)
processAll    processAll(List):void      DEFAULT_METHOD     DEFAULT_MODIFIER
```

**Capabilities Demonstrated**:
- ✅ Distinguishes abstract interface methods
- ✅ Identifies default interface methods
- ✅ Captures default modifier

---

## Example 6: Method with Generic Type Parameters

### Input Java Code
```java
package com.example.util;

import java.util.List;

public class Converter {
    public <T, U> List<U> convert(List<T> input, Function<T, U> mapper) {
        return input.stream().map(mapper).collect(Collectors.toList());
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                      hasTypeParams    paramCount
convert       convert(List,Function):List    true             2
```

### Extracted MethodTypeParameters
```csv
typeParamName    position    hasBounds
T                0           false
U                1           false
```

**Capabilities Demonstrated**:
- ✅ Detects method-level type parameters
- ✅ Extracts MethodTypeParameters separately
- ✅ Tracks hasTypeParameters flag

---

## Example 7: Method with Throws Clause

### Input Java Code
```java
package com.example.service;

import java.io.IOException;

public class FileService {
    public String readFile(String path) throws IOException, SecurityException {
        // implementation
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                 throwsExceptions    returnType
readFile      readFile(String):String   true                String
```

### Extracted TypeReferences (THROWS_CLAUSE context)
```csv
typeName            kind     context         ownerKind
IOException         CLASS    THROWS_CLAUSE   METHOD
SecurityException   CLASS    THROWS_CLAUSE   METHOD
```

**Capabilities Demonstrated**:
- ✅ Detects throws clause
- ✅ Extracts exception types as TypeReferences
- ✅ Uses THROWS_CLAUSE context

---

## Example 8: Varargs Method

### Input Java Code
```java
package com.example.util;

public class Logger {
    public void log(String format, Object... args) {
        System.out.printf(format, args);
    }
    
    @SafeVarargs
    public final <T> void logAll(T... items) {
        for (T item : items) {
            System.out.println(item);
        }
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                       detailedSignature                      hasVarArgs
log           log(String,Object[]):void       log(String format, Object... args):void    true
logAll        logAll(Object[]):void           logAll(T... items):void                    true
```

**Capabilities Demonstrated**:
- ✅ Detects varargs parameters
- ✅ Normalizes varargs to array in canonical signature
- ✅ Preserves varargs notation in detailed signature

---

## Example 9: Compact Constructor (Records)

### Input Java Code
```java
package com.example.model;

public record User(String name, int age) {
    public User {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Name required");
        }
        if (age < 0) {
            throw new IllegalArgumentException("Age must be non-negative");
        }
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                   methodKind             paramCount
User          User(String,int):void       CONSTRUCTOR            2
User          User():void                 COMPACT_CONSTRUCTOR    0
```

**Capabilities Demonstrated**:
- ✅ Creates canonical constructor from record components
- ✅ Extracts compact constructor separately
- ✅ Distinguishes CONSTRUCTOR vs COMPACT_CONSTRUCTOR

---

## Example 10: Annotation Element

### Input Java Code
```java
package com.example.annotation;

public @interface Config {
    String name();
    int priority() default 0;
    String[] tags() default {};
}
```

### Extracted MethodRegistry
```csv
methodName    signature            methodKind            returnType
name          name():String        ANNOTATION_ELEMENT    String
priority      priority():int       ANNOTATION_ELEMENT    int
tags          tags():String[]      ANNOTATION_ELEMENT    String[]
```

**Capabilities Demonstrated**:
- ✅ Extracts annotation elements
- ✅ Uses ANNOTATION_ELEMENT method kind
- ✅ Captures return types including arrays

---

## Example 11: Synchronized and Native Methods

### Input Java Code
```java
package com.example.concurrent;

public class Counter {
    private int count;
    
    public synchronized void increment() {
        count++;
    }
    
    public native int getNativeCount();
}
```

### Extracted MethodRegistry
```csv
methodName       signature                  methodKind        methodModifier
increment        increment():void           INSTANCE_METHOD   SYNCHRONIZED_MODIFIER
getNativeCount   getNativeCount():int       INSTANCE_METHOD   NATIVE_MODIFIER
```

**Capabilities Demonstrated**:
- ✅ Captures synchronized modifier
- ✅ Captures native modifier
- ✅ Native methods correctly identified as instance methods (not abstract)

---

## Example 12: Method with Annotations

### Input Java Code
```java
package com.example.controller;

import org.springframework.web.bind.annotation.*;

public class UserController {
    @GetMapping("/users/{id}")
    @ResponseBody
    public User getUser(@PathVariable String id) {
        // implementation
    }
    
    @Override
    public String toString() {
        return "UserController";
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature                methodKind
getUser       getUser(String):User     INSTANCE_METHOD
toString      toString():String        INSTANCE_METHOD
```

### Extracted TypeAnnotations
```csv
annotationName    context              ownerHash
GetMapping        METHOD_DECLARATION   METHOD_REGISTRY_xxx
ResponseBody      METHOD_DECLARATION   METHOD_REGISTRY_xxx
Override          METHOD_DECLARATION   METHOD_REGISTRY_yyy
```

**Capabilities Demonstrated**:
- ✅ Extracts method-level annotations
- ✅ Uses METHOD_DECLARATION context
- ✅ Links annotations to method hashes

---

## Example 13: Enum Methods

### Input Java Code
```java
package com.example.model;

public enum Status {
    ACTIVE("Active"),
    INACTIVE("Inactive");
    
    private final String label;
    
    Status(String label) {
        this.label = label;
    }
    
    public String getLabel() {
        return label;
    }
}
```

### Extracted MethodRegistry
```csv
methodName    signature               methodKind        methodAccess
Status        Status(String):void     CONSTRUCTOR       PRIVATE
getLabel      getLabel():String       INSTANCE_METHOD   PUBLIC
```

**Capabilities Demonstrated**:
- ✅ Extracts enum constructors (always private)
- ✅ Extracts enum instance methods
- ✅ Correctly identifies constructor access as PRIVATE

---

## Example 14: Static and Instance Initializers

### Input Java Code
```java
package com.example.init;

public class Initializers {
    private static final Map<String, Integer> CACHE;
    private List<String> items;
    
    static {
        CACHE = new HashMap<>();
        CACHE.put("default", 0);
    }
    
    {
        items = new ArrayList<>();
    }
}
```

### Extracted MethodRegistry
```csv
methodName           signature                  methodKind
<clinit>             <clinit>():void            STATIC_INITIALIZER
<init>               <init>():void              INSTANCE_INITIALIZER
```

**Capabilities Demonstrated**:
- ✅ Extracts static initializer blocks
- ✅ Extracts instance initializer blocks
- ✅ Uses special names `<clinit>` and `<init>`

---

## Signature Generation

### Canonical Signature (signature)
Used for method identity and overload resolution:
- Generics stripped: `List` not `List<User>`
- Varargs normalized: `String[]` not `String...`
- No parameter names: `method(String,int):void`

### Detailed Signature (detailedSignature)
Used for display and exact source matching:
- Full generics preserved: `List<User>`
- Varargs preserved: `String...`
- Parameter names included: `method(String name, int age):void`

### Example
```java
public <T> List<T> filter(List<T> items, Predicate<T> predicate, String... tags)
```
- **signature**: `filter(List,Predicate,String[]):List`
- **detailedSignature**: `filter(List<T> items, Predicate<T> predicate, String... tags):List<T>`

---

## Summary

### Method Kinds

| Kind | Example | When Used |
|------|---------|-----------|
| CONSTRUCTOR | `User(String name)` | Regular constructors |
| COMPACT_CONSTRUCTOR | `public User { }` | Record compact constructors |
| INSTANCE_METHOD | `void process()` | Non-static methods with body |
| STATIC_METHOD | `static void helper()` | Static methods |
| ABSTRACT_METHOD | `abstract void process()` | Methods without body (not native) |
| DEFAULT_METHOD | `default void helper()` | Interface default methods |
| ANNOTATION_ELEMENT | `String value()` | Annotation type elements |
| STATIC_INITIALIZER | `static { }` | Static initialization blocks |
| INSTANCE_INITIALIZER | `{ }` | Instance initialization blocks |
| NATIVE_METHOD | `native int count()` | Native methods |

### Access Levels

- **PUBLIC**: `public` modifier
- **PRIVATE**: `private` modifier  
- **PROTECTED**: `protected` modifier
- **PACKAGE**: No access modifier (default)

### Modifiers Captured

- STATIC_MODIFIER
- ABSTRACT_MODIFIER
- FINAL_MODIFIER
- SYNCHRONIZED_MODIFIER
- NATIVE_MODIFIER
- DEFAULT_MODIFIER
- STRICTFP_MODIFIER

### Integration

The TypeMethodExtractor orchestrates:
- **MethodParameterExtractor**: For all method parameters
- **MethodTypeParameterExtractor**: For method-level generic type parameters
- **AnnotationExtractor**: For method-level annotations
- **TypeReferenceExtractor**: For return types and throws clauses
