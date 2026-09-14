package com.inventory.auth.examples14;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Test cases for INSTANCEOF_EXPRESSION and INSTANCEOF_PATTERN extraction.
 *
 * INSTANCEOF_EXPRESSION: obj instanceof Type (basic check)
 * INSTANCEOF_PATTERN: obj instanceof Type varName (Java 16+ pattern matching)
 */
public class InstanceofPatternExamples {

    Object obj = "hello";
    Object numObj = 42;

    // ==================== BASIC INSTANCEOF (INSTANCEOF_EXPRESSION) ====================

    // Simple instanceof check
    boolean isString = obj instanceof String;
    boolean isInteger = numObj instanceof Integer;

    // instanceof with qualified type
    boolean isList = obj instanceof java.util.List;

    // instanceof with generic type (raw check)
    boolean isArrayList = obj instanceof java.util.ArrayList;

    // ==================== INSTANCEOF WITH PATTERN (INSTANCEOF_PATTERN) ====================

    // Basic pattern variable (Java 16+)
    // obj instanceof String s - binds 's' to the casted value
    String patternResult = (obj instanceof String s) ? s.toUpperCase() : "not a string";

    // Pattern with different types
    Integer intPattern = numObj instanceof Integer i ? i * 2 : 0;

    // Pattern with qualified type
    java.util.List<?> listPattern = obj instanceof java.util.List<?> list ? list : null;

    // ==================== INSTANCEOF IN EXPRESSIONS ====================

    // instanceof in ternary condition
    int length = obj instanceof String ? ((String) obj).length() : 0;
    int length2 = obj instanceof String ? ((String) new Object()).length() : 0;

    // instanceof with pattern in ternary - cleaner Java 16+ style
    int lengthPattern = obj instanceof String str ? str.length() : 0;

    // instanceof in binary expression
    boolean bothStrings = obj instanceof String && numObj instanceof String;

    // instanceof with pattern in method argument
    void processIfString(Object o) {
        // Pattern matching in method body - uses pattern variable in scope
    }

    // ==================== COMPLEX INSTANCEOF PATTERNS ====================

    // Nested instanceof checks
    boolean nestedCheck = obj instanceof Object && obj instanceof String;

    // Pattern with final modifier (if supported)
    // Note: final in pattern is optional and typically inferred

    // ==================== INSTANCEOF WITH GENERICS ====================

    // Cannot use instanceof with parameterized type directly (compile error)
    // boolean isStringList = obj instanceof List<String>; // ERROR
    // But can use wildcard
    boolean isWildcardList = obj instanceof java.util.List<?>;

    // ==================== EDGE CASES ====================

    // instanceof on method return
    boolean methodResultCheck = getString() instanceof String;

    // instanceof on array access
    Object[] objects = {obj, numObj};
    boolean arrayElementCheck = objects[0] instanceof String;

    // instanceof on field access
    static class Container {
        Object value = "test";
    }
    Container container = new Container();
    boolean fieldCheck = container.value instanceof String;

    // Pattern on field access
    String fieldPattern = container.value instanceof String s ? s : null;

    private Object getString() {
        String patternResultStr = (obj instanceof String s) ? s.toUpperCase() : "not a string";

        List<Map<String, Integer>> listOfMaps = new ArrayList<>();
        listOfMaps.add(Map.of("one", 1, "two", 2));
        listOfMaps.add(Map.of("three", 3, "four", 4));

        return "test";
    }
}
