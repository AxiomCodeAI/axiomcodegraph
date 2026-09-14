package com.inventory.auth.examples21;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Complex return expression examples for testing method body extraction.
 * Tests various scenarios involving method parameters, fields, and expressions.
 */
public class ReturnExpressionExamples {
    
    // Fields for testing field vs parameter disambiguation
    private int count = 0;
    private String name = "default";
    private List<String> items;
    
    // =========================================================================
    // SIMPLE RETURN - Parameter references
    // =========================================================================
    
    /** Direct parameter return */
    public int identity(int value) {
        return value;  // value is PARAMETER
    }
    
    /** Multiple parameters in return */
    public int add(int a, int b) {
        return a + b;  // a is PARAMETER, b is PARAMETER
    }
    
    /** Parameter with field - disambiguation test */
    public int addToCount(int count) {
        return count + this.count;  // first count is PARAMETER, this.count is FIELD
    }
    
    // =========================================================================
    // METHOD CHAIN RETURNS - Parameters in chains
    // =========================================================================
    
    /** Stream chain with parameter */
    public int sumList(List<Integer> numbers) {
        return numbers.stream()
            .mapToInt(Integer::intValue)
            .sum() + count;  // numbers is PARAMETER
    }
    
    /** Complex stream with multiple operations */
    public List<String> filterAndMap(List<String> input, String prefix) {
        return input.stream()
            .filter(s -> s.startsWith(prefix))  // input is PARAMETER, prefix is PARAMETER
            .map(String::toUpperCase)
            .collect(Collectors.toList());
    }
    
    /** Nested method calls */
    public String processInput(String input, int limit) {
        return input.substring(0, Math.min(input.length(), limit)).trim();
        // input is PARAMETER (3 times), limit is PARAMETER
    }
    
    // =========================================================================
    // CONDITIONAL RETURNS - Ternary with parameters
    // =========================================================================
    
    /** Ternary operator with parameters */
    public int max(int x, int y) {
        return x > y ? x : y;  // x is PARAMETER (2 times), y is PARAMETER (2 times)
    }
    
    /** Nested ternary */
    public int clamp(int value, int min, int max) {
        return value < min ? min : (value > max ? max : value);
        // value is PARAMETER (3 times), min is PARAMETER (2 times), max is PARAMETER (2 times)
    }
    
    /** Ternary with method calls */
    public String formatOrDefault(String input, String defaultValue) {
        return input != null ? input.toUpperCase() : defaultValue;
        // input is PARAMETER (2 times), defaultValue is PARAMETER
    }
    
    // =========================================================================
    // LAMBDA IN RETURN - Lambda expressions as return values
    // =========================================================================
    
    /** Return a lambda that captures parameter */
    public Function<Integer, Integer> createAdder(int addend) {
        return x -> x + addend;  // addend is PARAMETER (captured)
    }
    
    /** Return a supplier capturing parameter */
    public Supplier<String> createGreeter(String greeting) {
        return () -> greeting + "!";  // greeting is PARAMETER (captured)
    }
    
    /** Return lambda with parameter in transformation */
    public <T, R> Function<T, R> compose(Function<T, R> first, Function<R, R> second) {
        return t -> second.apply(first.apply(t));
        // first is PARAMETER, second is PARAMETER
    }
    
    // =========================================================================
    // OBJECT CREATION IN RETURN
    // =========================================================================
    
    /** Return new object with parameters */
    public StringBuilder createBuilder(String initial, int capacity) {
        return new StringBuilder(capacity).append(120);
        // capacity is PARAMETER, initial is PARAMETER
    }
    
    /** Return array with parameters */
    public int[] createArray(int a, int b, int c) {
        return new int[] { a, b, c };  // a, b, c are PARAMETER
    }
    
    /** Return Optional with parameter */
    public Optional<String> wrapIfPresent(String value) {
        return value != null ? Optional.of(value) : Optional.empty();
        // value is PARAMETER (2 times)
    }
    
    // =========================================================================
    // CAST EXPRESSIONS IN RETURN
    // =========================================================================
    private final int counters = (int) 120.90;
    /** Cast parameter */
    public long toLong(int value) {
        return (long) value;  // value is PARAMETER
    }
    
    /** Cast with computation */
    public double average(int sum, int count) {
        return (double) sum / count;  // sum is PARAMETER, count is PARAMETER
    }
    
    // =========================================================================
    // SWITCH EXPRESSION IN RETURN (Java 14+)
    // =========================================================================
    
    /** Return switch expression with parameter */
    public String dayType(int day) {
        return switch (day) {
            case 1, 7 -> "weekend";
            case 2, 3, 4, 5, 6 -> "weekday";
            default -> "invalid";
        };  // day is PARAMETER
    }
    
    /** Switch with parameter in cases */
    public int calculate(String op, int a, int b) {
        return switch (op) {
            case "add" -> a + b;
            case "sub" -> a - b;
            case "mul" -> a * b;
            case "div" -> b != 0 ? a / b : 0;
            default -> 0;
        };  // op is PARAMETER, a is PARAMETER, b is PARAMETER
    }
    
    // =========================================================================
    // NESTED RETURNS - Multiple return statements
    // =========================================================================
    
    /** Early return with parameter check */
    public String validate(String input) {
        if (input == null) {
            return "null input";  // no parameters here
        }
        if (input.isEmpty()) {
            return "empty input";  // no parameters here
        }
        return input.trim();  // input is PARAMETER
    }
    
    /** Return in try-catch */
    public int parseOrDefault(String text, int defaultValue) {
        try {
            return Integer.parseInt(text);  // text is PARAMETER
        } catch (NumberFormatException e) {
            return defaultValue;  // defaultValue is PARAMETER
        }
    }
    
    // =========================================================================
    // GENERIC METHOD RETURNS
    // =========================================================================
    
    /** Generic identity */
    public <T> T genericIdentity(T value) {
        return value;  // value is PARAMETER
    }
    
    /** Generic with bounds */
    public <T extends Comparable<T>> T minOf(T a, T b) {
        return a.compareTo(b) < 0 ? a : b;
        // a is PARAMETER (2 times), b is PARAMETER (2 times)
    }
    
    /** Generic with multiple type params */
    public <K, V> Map.Entry<K, V> createEntry(K key, V value) {
        return Map.entry(key, value);  // key is PARAMETER, value is PARAMETER
    }
    
    // =========================================================================
    // VARARGS IN RETURN
    // =========================================================================
    
    /** Varargs sum */
    public int sumAll(int... values) {
        int sum = 0;
        for (int v : values) {
            sum += v;
        }
        return sum;  // sum is LOCAL_VARIABLE (not yet implemented)
    }
    
    /** Return first vararg */
    public <T> T firstOrNull(T... items) {
        return items.length > 0 ? items[0] : null;  // items is PARAMETER (2 times)
    }
    
    // =========================================================================
    // METHOD REFERENCE RETURNS (not inside streams)
    // =========================================================================
    
    /** Method reference as direct return value */
    public Function<Object, String> getConverter() {
        return String::valueOf;  // METHOD_REFERENCE as return value itself
    }
    
    /** Method reference with specific type */
    public Function<Integer, String> getIntConverter() {
        return Object::toString;  // METHOD_REFERENCE - using Object to avoid ambiguity
    }
    
    // =========================================================================
    // ANONYMOUS CLASS RETURNS
    // =========================================================================
    
    /** Return anonymous class implementing Comparator */
    public java.util.Comparator<String> getComparator(boolean reverse) {
        return new java.util.Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return reverse ? b.compareTo(a) : a.compareTo(b);
            }

            public void fix() {

            }
        };
    }
    
    /** Return anonymous Runnable */
    public Runnable getTask(String message) {
        return new Runnable() {
            @Override
            public void run() {
                System.out.println(message);
            }
        };
    }
    
    // =========================================================================
    // THIS RETURN (builder pattern)
    // =========================================================================
    
    /** Builder pattern - return this */
    public ReturnExpressionExamples withName(String name) {
        this.name = name;
        return this;  // THIS reference
    }
    
    /** Chained builder */
    public ReturnExpressionExamples withCount(int count) {
        this.count = count;
        return this;  // THIS reference
    }
    
    // =========================================================================
    // SUPER METHOD CALL RETURN
    // =========================================================================
    
    /** Override toString with super call */
    @Override
    public String toString() {
        int x = 5;
        java.util.function.Supplier<Integer> tempLocalVar = () -> {
            int y = x * 2;  // internal variable with operation
            return y;
        };
        return super.toString() + "[" + name + "]" + x;  // super method call + field
    }
    
    /** Override hashCode with super */
    @Override
    public int hashCode() {
        return super.hashCode() + count;  // super method call + field
    }
    
    // =========================================================================
    // UNARY OPERATORS
    // =========================================================================
    
    /** Unary minus */
    public int negate(int value) {
        return -value;  // UNARY_MINUS on PARAMETER
    }
    
    /** Logical not */
    public boolean invert(boolean flag) {
        return !flag;  // LOGICAL_NOT on PARAMETER
    }
    
    /** Bitwise complement */
    public int complement(int bits) {
        return ~bits;  // BITWISE_NOT on PARAMETER
    }
    
    /** Unary plus (rare but valid) */
    public int positive(int value) {
        return +value;  // UNARY_PLUS on PARAMETER
    }
    
    // =========================================================================
    // INSTANCEOF PATTERN MATCHING (Java 16+)
    // =========================================================================
    
    /** instanceof with pattern variable */
    public int getLength(Object obj) {
        return obj instanceof String s ? s.length() : -1;
    }
    
    /** instanceof pattern in complex expression */
    public String describeObject(Object obj) {
        return obj instanceof Number n ? "Number: " + n.intValue() : "Not a number";
    }
    
    // =========================================================================
    // ARRAY ACCESS
    // =========================================================================
    
    /** Array access with parameter index */
    public String getAtIndex(String[] arr, int index) {
        return arr[index];  // ARRAY_ACCESS with PARAMETER array and PARAMETER index
    }
    
    /** Array access with literal index */
    public String getFirst(String[] arr) {
        return arr[0];  // ARRAY_ACCESS with PARAMETER array and literal index
    }
    
    /** Multidimensional array access */
    public int getElement(int[][] matrix, int row, int col) {
        return matrix[row][col];  // Nested ARRAY_ACCESS
    }
    
    // =========================================================================
    // STRING CONCATENATION
    // =========================================================================
    
    /** Binary + with mixed types */
    public String format(String prefix, int value, String suffix) {
        return prefix + value + suffix;  // Binary + with PARAMETER (string, int, string)
    }
    
    /** Concatenation with field and parameter */
    public String describe(String adjective) {
        return name + " is " + adjective;  // FIELD + literal + PARAMETER
    }
    
    // =========================================================================
    // PARENTHESIZED EXPRESSIONS
    // =========================================================================
    
    /** Parentheses affecting precedence */
    public int compute(int a, int b, int c) {
        return (a + b) * c;  // Parenthesized expression
    }
    
    /** Complex parenthesized expression */
    public int complexCompute(int x, int y, int z) {
        return ((x + y) * (y + z)) / (x + z);  // Multiple parenthesized expressions
    }
    
    // =========================================================================
    // CLASS LITERAL RETURN
    // =========================================================================
    
    /** Return class literal */
    public Class<?> getStringType() {
        return String.class;  // CLASS_LITERAL
    }
    
    /** Return parameterized class */
    public Class<Integer> getIntegerType() {
        return Integer.class;  // CLASS_LITERAL
    }
    
    /** Return array class type */
    public Class<?> getArrayType() {
        return int[].class;  // CLASS_LITERAL for array
    }
    
    // =========================================================================
    // NULL LITERAL
    // =========================================================================
    
    /** Direct null return */
    public String getNullString() {
        return null;  // NULL_LITERAL
    }
    
    /** Null in ternary */
    public String getNullable(boolean flag) {
        return flag ? name : null;  // NULL_LITERAL in ternary false branch
    }
    
    // =========================================================================
    // FIELD ACCESS ON PARAMETER OBJECTS
    // =========================================================================
    
    /** Access field on parameter object */
    public int getPointX(java.awt.Point point) {
        return point.x;  // Field access on PARAMETER
    }
    
    /** Access field on parameter with computation */
    public int getPointSum(java.awt.Point point) {
        return point.x + point.y;  // Multiple field accesses on PARAMETER
    }
    
    // =========================================================================
    // PRE/POST INCREMENT
    // =========================================================================
    
    /** Pre-increment on field */
    public int incrementAndReturn() {
        return ++count;  // PRE_INCREMENT on FIELD
    }
    
    /** Pre-decrement on field */
    public int decrementAndReturn() {
        return --count;  // PRE_DECREMENT on FIELD
    }
    
    /** Post-increment (value before increment) */
    public int returnThenIncrement() {
        return count++;  // POST_INCREMENT on FIELD
    }
    
    /** Post-decrement (value before decrement) */
    public int returnThenDecrement() {
        return count--;  // POST_DECREMENT on FIELD
    }
}
