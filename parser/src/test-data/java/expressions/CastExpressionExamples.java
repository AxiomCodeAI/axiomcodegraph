package com.inventory.auth.examples12;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.io.Serializable;

/**
 * Test cases for CAST_EXPRESSION extraction.
 */
public class CastExpressionExamples {
    
    // Simple primitive cast
    Object numObj = 42;
    int simpleInt = (int) numObj;
    
    // Simple reference cast
    Object strObj = "hello";
    String simpleStr = (String) strObj;
    
    // Cast with chained operations
    Object obj1 = "world";
    int length = ((String) obj1).length();
    
    // Nested casts
    Object nested = 100;
    long nestedCast = (long) (int) nested;
    
    // Cast in binary expression
    Object leftObj = 10;
    Object rightObj = 20;
    int sum = (int) leftObj + (int) rightObj;
    
    // Generic type cast
    Object listObj = new ArrayList<String>();
    List<String> genericCast = (List<String>) listObj;
    
    // Complex generic cast
    Object mapObj = null;
    Map<String, List<Integer>> complexCast = (Map<String, List<Integer>>) mapObj;
    
    // Array type cast
    Object arrObj = new int[]{1, 2, 3};
    int[] arrayCast = (int[]) arrObj;
    
    // 2D array cast
    Object matrix = new int[][]{{1, 2}, {3, 4}};
    int[][] matrixCast = (int[][]) matrix;
    
    // Cast in ternary expression
    Object condObj = "test";
    String ternaryCast = condObj != null ? (String) condObj : "default";
    
    // Cast in assignment chain
    Object chainObj = 50;
    int a, b;
    int chainCast = a = b = (int) chainObj;
    
    // Cast with parenthesized expression
    Object parenObj = 100;
    int parenCast = (int) ((Object) parenObj);

    public void someFunctions() {
        try {
            String ternaryCast = condObj != null ? (String) condObj : "default";
        List<? extends Number> upperBoundedWildcard = (List<? extends Number>) wildcardObj2;
        } catch (Exception e) {

        }
    }
    
    // ==================== ADVANCED GENERIC CASTS ====================
    
    // Wildcard - unbounded
    Object wildcardObj1 = new ArrayList<String>();
    List<?> unboundedWildcard = (List<?>) wildcardObj1;
    
    // Wildcard - upper bounded (extends)
    Object wildcardObj2 = new ArrayList<Integer>();
    List<? extends Number> upperBoundedWildcard = (List<? extends Number>) wildcardObj2;
    
    // Wildcard - lower bounded (super)
    Object wildcardObj3 = new ArrayList<Object>();
    List<? super Integer> lowerBoundedWildcard = (List<? super Integer>) wildcardObj3;
    
    // Deeply nested generics
    Object deepObj = null;
    Map<String, Map<Integer, List<Double>>> deeplyNested = 
        (Map<String, Map<Integer, List<Double>>>) deepObj;
    
    // Multiple wildcards
    Object multiWildcard = null;
    Map<? extends CharSequence, ? super Number> multiWildcardCast = 
        (Map<? extends CharSequence, ? super Number>) multiWildcard;
    
    // ==================== INNER CLASS CASTS ====================
    
    // Inner class cast (simulated with Map.Entry)
    Object entryObj = null;
    Map.Entry<String, Integer> innerClassCast = (Map.Entry<String, Integer>) entryObj;
    
    // ==================== CAST OF EXPRESSIONS ====================
    
    // Cast of method invocation result
    Object methodResult = getObject();
    String castMethodResult = (String) getObject();
    
    // Cast of field access
    Object fieldVal = this.numObj;
    Integer castFieldAccess = (Integer) this.numObj;
    
    // Cast in method argument (inline)
    int hashOfCast = ((String) strObj).hashCode();
    
    // ==================== OBJECT ARRAY CASTS ====================
    
    // Object array to specific array
    Object[] objArray = new String[]{"a", "b"};
    String[] stringArrayCast = (String[]) objArray;
    
    // Generic array (with warning)
    Object genericArrObj = new ArrayList[3];
    ArrayList<String>[] genericArrayCast = (ArrayList<String>[]) genericArrObj;
    
    // ==================== CAST WITH OTHER EXPRESSIONS ====================
    
    // Cast in unary expression
    Object boolObj = true;
    boolean notCast = !((Boolean) boolObj);
    
    // Cast result used in instanceof (rare but valid)
    Object checkObj = "test";
    boolean instanceCheck = ((Object) checkObj) instanceof String;
    
    // Multiple casts in one expression
    Object multiObj = 42;
    String multiCastExpr = String.valueOf((int) (long) (Long) (Object) 42L);
    
    // Helper method for testing
    private static Object getObject() {
        return "result";
    }
    
    // ==================== INTERSECTION TYPE CASTS (Java 8+) ====================
    // This is the most significant missing case!
    
    Object intersectObj = "hello";
    Comparable<?> intersectionCast = (Serializable & Comparable<?>) intersectObj;
    
    // Multiple intersection bounds
    Object multiIntersect = "test";
    Object tripleIntersect = (Serializable & Comparable<?> & CharSequence) multiIntersect;
    
    // ==================== CONTEXTUAL POSITIONS ====================
    
    // Cast in array initializer
    Object e1 = "a", e2 = "b";
    String[] castInArrayInit = {(String) e1, (String) e2};
    
    // Cast of array access result
    Object[] objects = {"test"};
    String castArrayAccess = (String) objects[0];
    
    // ==================== TYPE REPRESENTATION VARIANTS ====================
    
    // Fully qualified type name in cast
    Object fqnObj = new ArrayList<String>();
    java.util.List<String> fullyQualifiedCast = (java.util.List<String>) fqnObj;
    
    // Raw type cast (erased generics)
    List<String> typedList = new ArrayList<>();
    List rawTypeCast = (List) typedList;
    
    // ==================== EDGE CASES ====================
    
    // Cast of 'new' expression (unusual but valid)
    Object castOfNew = (Object) new String("direct");
    
    // Cast of literal (unusual but valid)  
    Object castOfLiteral = (Object) "literal";
    Number castNumLiteral = (Number) (Object) 42;
    
    // ==================== LAMBDA + METHOD REFERENCE CASTS (Java 8+) ====================
    
    // Cast of lambda expression to functional interface
    Object lambdaAsRunnable = (Runnable) () -> {};
    
    // Cast of generic functional interface target
    java.util.concurrent.Callable<String> lambdaAsCallable =
        (java.util.concurrent.Callable<String>) () -> "ok";
    
    // Cast of method reference to functional interface
    java.util.function.Supplier<String> methodRefAsSupplier =
        (java.util.function.Supplier<String>) String::new;
    
    // Intersection type cast with lambda (common for serializable lambdas)
    Runnable serializableLambda =
        (java.io.Serializable & Runnable) () -> {};
    
    // Intersection type cast with method reference
    Runnable serializableMethodRef =
        (java.io.Serializable & Runnable) CastExpressionExamples::staticRun;
    
    private static void staticRun() {}
    
    // ==================== TYPE-USE ANNOTATIONS IN CASTS (Java 8+) ====================
    
    @java.lang.annotation.Target({
        java.lang.annotation.ElementType.TYPE_USE,
        java.lang.annotation.ElementType.TYPE_PARAMETER
    })
    @java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME)
    @interface TA {}
    
    Object annotatedObj = "annotated";
    String annotatedCast = (@TA String) annotatedObj;
    
    Object annotatedListObj = new java.util.ArrayList<String>();
    java.util.List<@TA String> annotatedTypeArgCast =
        (java.util.List<@TA String>) annotatedListObj;
    
    Object annotatedArrayObj = new String[] {"a"};
    String @TA [] annotatedArrayDimCast =
        (String[]) annotatedArrayObj;
    
    // ==================== TYPE VARIABLE CASTS ====================
    
    static class Holder<T> {
        Object value;
        
        @SuppressWarnings("unchecked")
        T asT() { return (T) value; }
    }
    
    // ==================== QUALIFIED / PARAMETERIZED INNER TYPE CAST ====================
    
    static class Outer<T> {
        class Inner<U> {}
    }
    
    Object innerObj = null;
    Outer<String>.Inner<Integer> qualifiedInnerCast =
        (Outer<String>.Inner<Integer>) innerObj;
    
    // ==================== NULL LITERAL CAST ====================
    
    String castNullLiteral = (String) null;
}
