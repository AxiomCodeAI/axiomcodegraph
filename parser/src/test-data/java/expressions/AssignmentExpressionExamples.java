package com.inventory.auth.examples11;

import java.util.*;
import java.util.function.*;
import java.util.stream.*;
import java.io.*;
import java.nio.file.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/**
 * Comprehensive examples of ASSIGNMENT_EXPRESSION patterns.
 * 
 * ASSIGNMENT_EXPRESSION is used when assignment (=) is used as an expression,
 * meaning the assignment itself produces a value that is used elsewhere.
 * 
 * Key patterns:
 * - Chained assignments: x = y = z = value
 * - Assignment in expressions: result = (temp = getValue())
 * - Assignment with complex RHS values
 */
public class AssignmentExpressionExamples {

    class Temp {
        public static int TEMP = 10;
    }

    // =========================================================================
    // SECTION 1: Basic Chained Assignments
    // =========================================================================
    
    // Simple chained primitive assignments
    int a = 1;
    int b = a;
    int c = b;
    
    // Triple chain - classic ASSIGNMENT_EXPRESSION
    int x, y, z;
    int chainResult = x = y = z = 100;

    int anotherCheck = (x = y = z += Temp.TEMP + 10);
    
    // Quadruple chain
    int p, q, r, s;
    int quadChain = p = q = r = s = 50;
    
    // Chain with different compatible types
    long longVal;
    int intVal;
    long chainedLong = longVal = intVal = 42;
    
    // Double chain
    double d1, d2, d3;
    double doubleChain = d1 = d2 = d3 = 3.14159;
    
    // Float chain
    float f1, f2;
    float floatChain = f1 = f2 = 2.5f;
    
    // =========================================================================
    // SECTION 2: Chained Assignments with Object Types
    // =========================================================================
    
    // String chain
    String str1, str2, str3;
    String stringChain = str1 = str2 = str3 = "chained";
    
    // Object chain
    Object obj1, obj2;
    Object objectChain = obj1 = obj2 = new Object();
    
    // StringBuilder chain
    StringBuilder sb1, sb2;
    StringBuilder sbChain = sb1 = sb2 = new StringBuilder("builder");
    
    // =========================================================================
    // SECTION 3: Chained Assignments with Generic Types
    // =========================================================================
    
    // List chain with generics
    List<String> list1, list2;
    List<String> listChain = list1 = list2 = new ArrayList<>();
    
    // Map chain with generics
    Map<String, Integer> map1, map2;
    Map<String, Integer> mapChain = map1 = map2 = new HashMap<>();
    
    // Set chain
    Set<Double> set1, set2;
    Set<Double> setChain = set1 = set2 = new HashSet<>();
    
    // Nested generic chain
    Map<String, List<Integer>> nestedMap1, nestedMap2;
    Map<String, List<Integer>> nestedMapChain = nestedMap1 = nestedMap2 = new HashMap<>();
    
    // Wildcard generic chain
    List<?> wildList1, wildList2;
    List<?> wildListChain = wildList1 = wildList2 = new ArrayList<String>();
    
    // Bounded wildcard chain
    List<? extends Number> boundedList1, boundedList2;
    List<? extends Number> boundedListChain = boundedList1 = boundedList2 = new ArrayList<Integer>();
    
    // =========================================================================
    // SECTION 4: Chained Assignments with Array Types
    // =========================================================================
    
    // Primitive array chain
    int[] arr1, arr2;
    int[] arrayChain = arr1 = arr2 = new int[10];
    
    // Object array chain
    String[] strArr1, strArr2;
    String[] strArrayChain = strArr1 = strArr2 = new String[]{"a", "b", "c"};
    
    // Multi-dimensional array chain
    int[][] matrix1, matrix2;
    int[][] matrixChain = matrix1 = matrix2 = new int[3][3];
    
    // 3D array chain
    double[][][] cube1, cube2;
    double[][][] cubeChain = cube1 = cube2 = new double[2][2][2];
    
    // =========================================================================
    // SECTION 5: Chained Assignments with Functional Types
    // =========================================================================
    
    // Supplier chain
    Supplier<Integer> supplier1, supplier2;
    Supplier<Integer> supplierChain = supplier1 = supplier2 = () -> 42;
    
    // Function chain
    Function<String, Integer> func1, func2;
    Function<String, Integer> funcChain = func1 = func2 = String::length;
    
    // Consumer chain
    Consumer<String> consumer1, consumer2;
    Consumer<String> consumerChain = consumer1 = consumer2 = System.out::println;
    
    // Predicate chain
    Predicate<Integer> pred1, pred2;
    Predicate<Integer> predChain = pred1 = pred2 = n -> n > 0;
    
    // BiFunction chain
    BiFunction<Integer, Integer, Integer> biFunc1, biFunc2;
    BiFunction<Integer, Integer, Integer> biFuncChain = biFunc1 = biFunc2 = (a1, b1) -> a1 + b1;
    
    // =========================================================================
    // SECTION 6: Assignment in Parenthesized Expressions
    // =========================================================================
    
    int tempA;
    int parenAssign = (tempA = 10) + 5;
    
    int tempB;
    int parenMultiply = (tempB = 20) * 2;
    
    int tempC, tempD;
    int nestedParen = ((tempC = 5) + (tempD = 10));
    
    String tempStr;
    int lengthFromAssign = (tempStr = "hello").length();
    
    // =========================================================================
    // SECTION 7: Assignment with Object Creation Expressions
    // =========================================================================
    
    // Chain with ArrayList creation and method arguments
    List<String> createdList;
    int listSize = (createdList = new ArrayList<>(Arrays.asList("a", "b", "c"))).size();
    
    // Chain with HashMap and initial capacity
    Map<String, Object> createdMap;
    boolean mapEmpty = (createdMap = new HashMap<>(16, 0.75f)).isEmpty();
    
    // Chain with StringBuilder and initial content
    StringBuilder createdSb;
    int sbLength = (createdSb = new StringBuilder("initial")).length();
    
    // =========================================================================
    // SECTION 8: Assignment with Generic Method Calls
    // =========================================================================
    
    List<Integer> genericResult;
    List<Integer> fromGenericMethod = genericResult = Collections.<Integer>emptyList();
    
    Set<String> genericSetResult;
    Set<String> fromGenericSet = genericSetResult = Collections.<String>emptySet();
    
    Map<String, Integer> genericMapResult;
    Map<String, Integer> fromGenericMap = genericMapResult = Collections.<String, Integer>emptyMap();
    
    // =========================================================================
    // SECTION 9: Assignment with Complex Type Creations
    // =========================================================================
    
    // Anonymous class in chain
    Runnable runnableTemp;
    Runnable runnableChain = runnableTemp = new Runnable() {
        @Override
        public void run() {
            System.out.println("Running");
        }
    };
    
    // Comparator anonymous class chain
    Comparator<String> compTemp;
    Comparator<String> compChain = compTemp = new Comparator<String>() {
        @Override
        public int compare(String o1, String o2) {
            return o1.compareTo(o2);
        }
    };
    
    // =========================================================================
    // SECTION 10: Assignment with Ternary Expressions
    // =========================================================================
    
    int ternaryTemp;
    int ternaryChain = ternaryTemp = (10 > 5) ? 100 : 200;
    
    String strTernaryTemp;
    String strTernaryChain = strTernaryTemp = (true) ? "yes" : "no";
    
    // Nested ternary with assignment
    int nestedTernaryTemp;
    int nestedTernaryChain = nestedTernaryTemp = (5 > 3) ? ((2 > 1) ? 10 : 20) : 30;
    
    // =========================================================================
    // SECTION 11: Assignment with Cast Expressions
    // =========================================================================
    
    Object objTemp;
    String castChain = (String)(objTemp = "casted");
    
    Number numTemp;
    int castIntChain = (int)(double)(numTemp = 42.5).doubleValue();
    
    // =========================================================================
    // SECTION 12: Assignment with Binary Expressions
    // =========================================================================
    
    int binTemp1, binTemp2;
    int binarySum = (binTemp1 = 10) + (binTemp2 = 20);
    
    int binTemp3, binTemp4;
    int binaryProduct = (binTemp3 = 5) * (binTemp4 = 6);
    
    boolean boolTemp1, boolTemp2;
    boolean logicalAnd = (boolTemp1 = true) && (boolTemp2 = false);
    
    int bitTemp1, bitTemp2;
    int bitwiseOr = (bitTemp1 = 0xFF) | (bitTemp2 = 0x0F);
    
    // =========================================================================
    // SECTION 13: Assignment with Unary Expressions
    // =========================================================================
    
    int unaryTemp;
    int negatedAssign = -(unaryTemp = 42);
    
    boolean boolUnaryTemp;
    boolean notAssign = !(boolUnaryTemp = true);
    
    // =========================================================================
    // SECTION 14: Assignment with Array Access
    // =========================================================================
    
    int[] arrayForAccess = new int[10];
    int arrayIndexTemp;
    int arrayAccessResult = arrayForAccess[arrayIndexTemp = 5];
    
    int[][] matrix = new int[5][5];
    int rowTemp, colTemp;
    int matrixAccess = matrix[rowTemp = 2][colTemp = 3];
    
    // =========================================================================
    // SECTION 15: Assignment with Method Reference Targets
    // =========================================================================
    
    Function<String, String> methodRefTemp;
    Function<String, String> methodRefChain = methodRefTemp = String::toUpperCase;
    
    Supplier<List<String>> constructorRefTemp;
    Supplier<List<String>> constructorRefChain = constructorRefTemp = ArrayList::new;
    
    BiFunction<String, String, String> instanceMethodRefTemp;
    BiFunction<String, String, String> instanceMethodRefChain = instanceMethodRefTemp = String::concat;
    
    // =========================================================================
    // SECTION 16: Assignment with Stream Operations
    // =========================================================================
    
    Stream<Integer> streamTemp;
    List<Integer> streamResult = (streamTemp = Stream.of(1, 2, 3, 4, 5)).collect(Collectors.toList());
    
    IntStream intStreamTemp;
    int streamSum = (intStreamTemp = IntStream.range(1, 10)).sum();
    
    // =========================================================================
    // SECTION 17: Assignment with Optional
    // =========================================================================
    
    Optional<String> optTemp;
    String optResult = (optTemp = Optional.of("value")).orElse("default");
    
    Optional<Integer> optIntTemp;
    int optIntResult = (optIntTemp = Optional.of(42)).orElseThrow();
    
    // =========================================================================
    // SECTION 18: Assignment with Concurrent Types
    // =========================================================================
    
    AtomicInteger atomicTemp;
    int atomicValue = (atomicTemp = new AtomicInteger(100)).get();
    
    AtomicReference<String> atomicRefTemp;
    String atomicRefValue = (atomicRefTemp = new AtomicReference<>("atomic")).get();
    
    ConcurrentHashMap<String, Integer> concurrentMapTemp;
    boolean concurrentEmpty = (concurrentMapTemp = new ConcurrentHashMap<>()).isEmpty();
    
    // =========================================================================
    // SECTION 19: Assignment with File/Path Types
    // =========================================================================
    
    Path pathTemp;
    String pathString = (pathTemp = Paths.get("/tmp/test")).toString();
    
    File fileTemp;
    String fileName = (fileTemp = new File("/tmp/test.txt")).getName();
    
    // =========================================================================
    // SECTION 20: Complex Nested Assignment Chains
    // =========================================================================
    
    // Triple object creation chain
    List<String> listA, listB, listC;
    int tripleListSize = (listA = listB = listC = new ArrayList<>()).size();
    
    // Chain with method call result
    String strA, strB, strC;
    int tripleStrLen = (strA = strB = strC = String.valueOf(12345)).length();
    
    // Deep nesting with multiple assignments
    int deepA, deepB, deepC, deepD;
    int deepResult = ((deepA = (deepB = (deepC = (deepD = 1) + 1) + 1) + 1));
    
    // Mixed type chain through common supertype
    Number numA, numB;
    Number numChain = numA = numB = Integer.valueOf(42);
    
    // =========================================================================
    // SECTION 21: Assignment with Varargs Method Calls
    // =========================================================================
    
    List<String> varargListTemp;
    List<String> varargResult = varargListTemp = Arrays.asList("one", "two", "three", "four", "five");
    
    String joinedTemp;
    String joinedResult = joinedTemp = String.join(", ", "a", "b", "c", "d");
    
    // =========================================================================
    // SECTION 22: Assignment with Builder Pattern
    // =========================================================================
    
    StringBuilder builderTemp;
    String builderResult = (builderTemp = new StringBuilder())
            .append("Hello")
            .append(" ")
            .append("World")
            .toString();
    
    StringJoiner joinerTemp;
    String joinerResult = (joinerTemp = new StringJoiner(", ", "[", "]"))
            .add("item1")
            .add("item2")
            .toString();
}

// =============================================================================
// SECTION 23: Nested Class with Assignment Expressions
// =============================================================================

class InnerAssignmentExamples {
    
    int innerA, innerB;
    int innerChain = innerA = innerB = 999;
    
    static int staticA, staticB;
    static int staticChain = staticA = staticB = 888;
    
    // Generic inner class
    static class GenericHolder<T> {
        T value1, value2;
        T valueChain;
        
        void initChain(T val) {
            valueChain = value1 = value2 = val;
        }
    }
    
    GenericHolder<String> holder1, holder2;
    GenericHolder<String> holderChain = holder1 = holder2 = new GenericHolder<>();
}

// =============================================================================
// SECTION 24: Interface with Assignment Expressions in Default Fields
// =============================================================================

interface AssignmentInterface {
    // Interface constants with complex initialization
    int CONST_A = 10;
    int CONST_B = CONST_A;
    int CONST_C = CONST_B * 2;
    
    List<String> EMPTY_LIST = Collections.emptyList();
    Map<String, Integer> EMPTY_MAP = Collections.emptyMap();
    
    Supplier<String> DEFAULT_SUPPLIER = () -> "default";
    Function<Integer, String> INT_TO_STRING = String::valueOf;
}

// =============================================================================
// SECTION 25: Enum with Assignment Expressions
// =============================================================================

enum AssignmentEnum {
    FIRST(1),
    SECOND(2),
    THIRD(3);
    
    private final int value;
    private static int staticTemp;
    private static int staticInitialized = staticTemp = 100;
    
    AssignmentEnum(int value) {
        this.value = value;
    }
    
    public int getValue() {
        return value;
    }
}

// =============================================================================
// SECTION 26: Abstract Class with Assignment Expressions
// =============================================================================

abstract class AbstractAssignmentExamples {
    
    protected int protectedA, protectedB;
    protected int protectedChain = protectedA = protectedB = 777;
    
    abstract void process();
    
    // Non-abstract method with assignment
    int getChainedValue() {
        int local1, local2;
        return local1 = local2 = 42;
    }
}

// =============================================================================
// SECTION 27: Record with Assignment Expressions (Java 16+)
// =============================================================================

// Note: Records have restrictions but can have static fields with assignments
// Uncomment if using Java 16+
/*
record AssignmentRecord(int x, int y) {
    static int staticA, staticB;
    static int staticChain = staticA = staticB = 123;
    
    static List<String> recordList;
    static List<String> recordListChain = recordList = new ArrayList<>();
}
*/

// =============================================================================
// SECTION 28: Multiple Type Parameters with Assignment
// =============================================================================

class MultiTypeAssignment<T, U, V> {
    
    T tValue1, tValue2;
    U uValue1, uValue2;
    V vValue1, vValue2;
    
    Map<T, U> mapTU1, mapTU2;
    Map<T, U> mapTUChain;
    
    BiFunction<T, U, V> biFunc1, biFunc2;
    BiFunction<T, U, V> biFuncChain;
    
    void initializeAll(T t, U u, V v, Map<T, U> map, BiFunction<T, U, V> func) {
        T localT = tValue1 = tValue2 = t;
        U localU = uValue1 = uValue2 = u;
        V localV = vValue1 = vValue2 = v;
        mapTUChain = mapTU1 = mapTU2 = map;
        biFuncChain = biFunc1 = biFunc2 = func;
    }
}

// =============================================================================
// SECTION 29: Bounded Type Parameters with Assignment
// =============================================================================

class BoundedTypeAssignment<T extends Number & Comparable<T>> {
    
    T value1, value2, value3;
    T valueChain;
    
    List<T> list1, list2;
    List<T> listChain;
    
    Comparator<T> comp1, comp2;
    Comparator<T> compChain;
    
    void initialize(T val, List<T> list, Comparator<T> comp) {
        valueChain = value1 = value2 = value3 = val;
        listChain = list1 = list2 = list;
        compChain = comp1 = comp2 = comp;
    }
}

// =============================================================================
// SECTION 30: Static Initializer Block Assignments
// =============================================================================

class StaticInitializerAssignments {
    
    static int staticA, staticB, staticC;
    static List<String> staticList1, staticList2;
    static Map<String, Integer> staticMap1, staticMap2;
    
    static {
        int localResult = staticA = staticB = staticC = 500;
        List<String> localList = staticList1 = staticList2 = new ArrayList<>();
        Map<String, Integer> localMap = staticMap1 = staticMap2 = new HashMap<>();
    }
}

// =============================================================================
// SECTION 31: Instance Initializer Block Assignments
// =============================================================================

class InstanceInitializerAssignments {
    
    int instanceA, instanceB, instanceC;
    List<String> instanceList1, instanceList2;
    
    {
        int localResult = instanceA = instanceB = instanceC = 300;
        List<String> localList = instanceList1 = instanceList2 = new ArrayList<>();
    }
}
