package com.inventory.auth.examples9;

import java.util.*;
import java.util.concurrent.*;

import javax.validation.constraints.NotNull;

import com.inventory.auth.examples4.TypeUseAnnotationPatterns.NotEmpty;

import java.io.*;
import java.lang.annotation.Target;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.ElementType;

@Target(ElementType.TYPE_USE)
@Retention(RetentionPolicy.RUNTIME)
@interface TA {}

/**
 * Comprehensive test cases for OBJECT_CREATION expression kind.
 */
public class ObjectCreationTestCases {

    // =========================================================================
    // SIMPLE OBJECT CREATION
    // =========================================================================
    
    private Object simpleObject = new Object();
    private String simpleString = new String("hello");
    private StringBuilder builder = new StringBuilder();
    private StringBuilder builderWithArg = new StringBuilder("initial");
    private Integer boxedInt = new Integer(42);
    
    // =========================================================================
    // GENERIC OBJECT CREATION
    // =========================================================================
    
    private ArrayList<String> explicitTypeArg = new ArrayList<String>();
    private ArrayList<Integer> diamond = new ArrayList<>();
    private HashMap<String, Integer> multipleTypeArgs = new HashMap<String, Integer>();
    private HashMap<String, Object> multipleWithDiamond = new HashMap<>();
    private ArrayList<List<String>> nestedGeneric = new ArrayList<List<String>>();
    private HashMap<String, List<Map<Integer, String>>> complexNested = 
        new HashMap<String, List<Map<Integer, String>>>();
    
    // =========================================================================
    // FULLY QUALIFIED TYPE NAMES
    // =========================================================================
    
    private java.util.Date fullyQualifiedDate = new java.util.Date();
    private java.util.Map.Entry<String, String> fullyQualifiedNested = 
        new java.util.AbstractMap.SimpleEntry<>("key", "value");
    
    // =========================================================================
    // ANONYMOUS CLASS CREATION
    // =========================================================================
    
    // Anonymous implementing interface
    private Runnable anonymousRunnable = new Runnable() {
            VarargFunction varargLambda = args -> String.join("-", args);

        @Override
        public void run() {
            System.out.println("running");
        }
    };
    
    // Anonymous extending class
    private Thread anonymousThread = new Thread() {
        @Override
        public void run() {
            System.out.println("thread");
        }
    };
    
    // Anonymous with generic interface
    private Comparator<String> anonymousComparator = new Comparator<String>() {
        @Override
        public int compare(String o1, String o2) {
            return o1.compareTo(o2);
        }
    };
    
    // Anonymous with fields and methods
    private Object complexAnonymous = new Object() {
        private int count = 0;
        public void increment() { count++; }
    };
    
    // =========================================================================
    // QUALIFIED INNER CLASS INSTANTIATION (outer.new Inner())
    // =========================================================================
    
    private OuterForInner outerInstance = new OuterForInner();
    private OuterForInner.Inner qualifiedInner = outerInstance.new Inner("test");
    private OuterForInner.Inner chainedQualified = new OuterForInner().new Inner("chained");
    
    // =========================================================================
    // STATIC AND NON-STATIC INNER CLASS
    // =========================================================================
    
    private static class StaticInner {
        StaticInner(int v) {}
    }
    
    class NonStaticInner {
        NonStaticInner(String n) {}
    }
    
    private StaticInner staticInner = new StaticInner(10);
    private NonStaticInner nonStaticInner = new NonStaticInner("test");
    
    // =========================================================================
    // OBJECT CREATION IN EXPRESSIONS
    // =========================================================================
    
    // As method argument
    private String inMethodArg = String.format("%s", new Object());
    
    // In ternary
    private List<String> inTernary = true ? new ArrayList<>() : new LinkedList<>();
    
    // Chained method on new
    private String chainedOnNew = new String("hello").toUpperCase();
    
    // In unary
    private boolean inUnary = !new ArrayList<>().isEmpty();
    
    // In binary
    private String inBinaryConcat = new String("a") + new String("b");
    private boolean inBinaryInstanceof = new Object() instanceof Object;
    
    // =========================================================================
    // CONSTRUCTOR ARGUMENT VARIATIONS
    // =========================================================================
    
    // Array as argument
    private String arrayArg = new String(new char[]{'a', 'b', 'c'});
    
    // Collection as argument
    private ArrayList<String> collectionArg = new ArrayList<>(Arrays.asList("a", "b"));
    
    // Lambda as argument
    private Thread lambdaArg = new Thread(() -> System.out.println("run"));
    
    // Method reference as argument
    private Thread methodRefArg = new Thread(System.out::println);
    
    // Ternary as argument
    private String ternaryArg = new String(true ? "yes" : "no");
    
    // Binary expression as argument
    private StringBuilder binaryExprArg = new StringBuilder(10 + 20);
    
    // Method call as argument
    private String methodCallArg = new String("hello".toUpperCase());
    
    // Nested object creation as argument
    private ArrayList<String> nestedNewArg = new ArrayList<>(new ArrayList<>());
    
    // Null as argument (cast needed)
    private RuntimeException nullArg = new RuntimeException((String) null);
    
    // =========================================================================
    // AS ARRAY ELEMENT
    // =========================================================================
    
    private Object[] inArrayInit = { new Object(), new String("test"), new Integer(42) };
    
    // =========================================================================
    // EXCEPTION CREATION
    // =========================================================================
    
    private RuntimeException rtException = new RuntimeException("error");
    private IllegalArgumentException iaException = new IllegalArgumentException("bad");
    private NullPointerException npeException = new NullPointerException();
    
    // =========================================================================
    // WILDCARD ASSIGNMENT
    // =========================================================================
    
    private List<?> wildcardAssign = new ArrayList<String>();
    private List<? extends Number> upperBoundAssign = new ArrayList<Integer>();
    private List<? super Integer> lowerBoundAssign = new ArrayList<Number>();
    
    // =========================================================================
    // CONCURRENT COLLECTIONS
    // =========================================================================
    
    private ConcurrentHashMap<String, Object> concurrentMap = new ConcurrentHashMap<>();
    private CopyOnWriteArrayList<String> cowList = new CopyOnWriteArrayList<>();
    private LinkedBlockingQueue<Runnable> blockingQueue = new LinkedBlockingQueue<>(100);
    
    // =========================================================================
    // ARRAY CREATION EXPRESSIONS (arrays are objects too!)
    // =========================================================================
    
    // Primitive array creation
    private int[] primitiveArray = new int[3];
    private double[] doubleArray = new double[10];
    private boolean[] boolArray = new boolean[5];
    
    // Reference array creation
    private String[] stringArray = new String[3];
    private Object[] objectArray = new Object[5];
    private Integer[] integerArray = new Integer[10];
    
    // Array creation with initializer (explicit new)
    private int[] arrayWithInit = new int[] { 1, 2, 3 };
    private String[] stringArrayInit = new String[] { "x", "y", "z" };
    private Object[] objectArrayInit = new Object[] { "str", 42, true };
    
    // Array initializer WITHOUT explicit new (still creates new array)
    private int[] implicitArrayInit = { 1, 2, 3 };
    private String[] implicitStringInit = { "a", "b", "c" };
    
    // Multi-dimensional arrays
    private int[][] twoDimArray = new int[2][3];
    private int[][] jaggedArray = new int[2][];
    private int[][] twoDimWithInit = new int[][] { {1, 2}, {3, 4, 5} };
    private String[][] stringMatrix = new String[3][4];
    
    // 3D array
    private int[][][] threeDimArray = new int[2][3][4];
    
    // Generic array (can't do new T[], but can do this)
    private List<List<? extends Number>>[] genericArray = new ArrayList[5]; // unchecked but valid
    
    Object o = new @TA Object();
    java.util.List<@TA String> xs = new java.util.ArrayList<>();
    @TA int[] arr 
    = new @TA int[3];

    // =========================================================================
    // ANONYMOUS CLASS + DIAMOND (Java 9+)
    // =========================================================================
    
    private List<String> anonWithDiamond = new ArrayList<>() {
        @Override
        public boolean add(String s) {
            System.out.println("Adding: " + s);
            return super.add(s);
        }
    };
    
    private Map<String, Integer> anonMapDiamond = new HashMap<>() {
        { put("default", 0); } // instance initializer
    };
    
    // =========================================================================
    // QUALIFIED INNER + ANONYMOUS COMBINED
    // =========================================================================
    
    private OuterForInner outerForAnon = new OuterForInner();
    private OuterForInner.Inner anonQualifiedInner = outerForAnon.new Inner("x") {
        @Override
        public String toString() { return "anonymous inner"; }
    };
}

// Helper class for qualified inner class tests
class OuterForInner {
    class Inner {
        Inner(String s) {}
    }
}

// Parameterized outer with parameterized inner
class ParameterizedOuter<T> {
    class ParameterizedInner<U> {
        ParameterizedInner(T t, U u) {}
    }
}

class ParameterizedInnerCreationTests {
    private ParameterizedOuter<String> outer = new ParameterizedOuter<String>();
    private ParameterizedOuter<String>.ParameterizedInner<Integer> inner = 
        outer.new ParameterizedInner<Integer>("test", 42);
}

// Generic constructor tests (rare)
class GenericConstructorClass {
    <T> GenericConstructorClass(T value) {}
}

class GenericConstructorTests {
    // Explicit type argument on constructor
    private GenericConstructorClass explicitCtorTypeArg = new <String>GenericConstructorClass("test");
}

// =========================================================================
// EXPLICIT THIS.NEW
// =========================================================================
class OuterExplicitThis {
    class Inner {
        Inner(String s) {}
    }
    
    private Inner explicitThisNew = this.new Inner("test");
    private Object explicitTest = new Interface() {
        @Override
        public void myMethod() {
            {
                this.explicitThisNew = this.new Inner("LET US GO!!!!");
            }
            this.explicitThisNew.toString();
        }
    };
}

// =========================================================================
// QUALIFIED THIS.NEW FROM SIBLING INNER
// =========================================================================
class OuterQualifiedThis {
    class Inner1 {}
    
    class Inner2 {
        // Create sibling inner via qualified this
        private Inner1 siblingNew = OuterQualifiedThis.this.new Inner1();
        private Inner1 testInner1 = Inner1.this;
    }
}

// =========================================================================
// DEEPLY CHAINED QUALIFIED NEW
// =========================================================================
class Level0 {
    class Level1 {
        class Level2 {}
    }
}

class DeepChainedNew {
    private Level0.Level1.Level2 deepChained = new Level0().new Level1().new Level2();
}

// =========================================================================
// PARENTHESIZED NEW
// =========================================================================
class ParenthesizedNewTests {
    private String parenNew = (new String("hello")).toUpperCase();
    private int parenNewLength = (new StringBuilder("test")).length();
}

// =========================================================================
// MULTIPLE NEW IN EXPRESSION
// =========================================================================
class MultipleNewTests {
    private int multiNew = new String("a").length() + new String("bb").length();
    private boolean ternaryCondNew = new java.util.Random().nextBoolean() ? true : false;
    private Object temp = new @NonNull String();
}

// =========================================================================
// NEW AS ARRAY DIMENSION
// =========================================================================
class NewAsDimensionTests {
    private String[] newAsDim = new String[new Integer(5)];
}

// =========================================================================
// RECORD CREATION (Java 16+)
// =========================================================================
record TestPoint(int x, int y) {}

class RecordCreationTests {
    private TestPoint recordInstance = new TestPoint(10, 20);
    private TestPoint recordWithExprs = new TestPoint(5 + 5, 10 * 2);
}

// =========================================================================
// CAST ON NEW EXPRESSION
// =========================================================================
class CastOnNewTests {
    // Cast the result of new expression
    private Object castNew = (Object) new String("test");
    private CharSequence castToInterface = (CharSequence) new StringBuilder("test");
}

// =========================================================================
// ANONYMOUS CLASS WITH CONSTRUCTOR ARGS
// =========================================================================
class AnonymousWithCtorArgs {
    // Anonymous extending class with constructor args
    private Thread anonWithCtorArg = new Thread("thread-name") {
        @Override
        public void run() { }
    };
}

// =========================================================================
// MULTI-LEVEL QUALIFIED THIS.NEW
// =========================================================================
class MultiLevelQualifiedThisNew {
    class Level1 {
        class Level2 {
            class Level3 {}
        }
    }
    
    class SiblingInner {
        // Access deeply nested inner from sibling
        private Level1.Level2.Level3 deepQualified = 
            MultiLevelQualifiedThisNew.this.new Level1().new Level2().new Level3();
    }
}