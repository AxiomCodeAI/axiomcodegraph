package com.inventory.auth.examples10;

import java.util.*;
import java.util.function.*;
import java.util.stream.*;

import com.inventory.auth.domain.Session;

/**
 * Comprehensive examples of method references for expression extraction testing.
 * 
 * Method Reference Forms:
 * 1. Static method:      Type::staticMethod
 * 2. Instance (bound):   instance::method
 * 3. Instance (unbound): Type::instanceMethod
 * 4. Constructor:        Type::new
 * 5. Array constructor:  Type[]::new
 * 6. this reference:     this::method
 * 7. super reference:    super::method
 * 8. Generic method:     Type::<T>method
 */
public class MethodReferenceExamples {

    // ========================================
    // 1. STATIC METHOD REFERENCES
    // ========================================
    
    // Basic static method reference: Type::staticMethod
    private Function<String, Integer> parseIntRef = Integer::parseInt;
    private DoubleSupplier randomRef = Math::random;
    private IntBinaryOperator maxRef = Integer::max;
    private IntBinaryOperator minRef = Math::min;
    
    // Static method with multiple params
    private BiFunction<String, String, String> concatRef = String::concat;
    
    // ========================================
    // 2. BOUND INSTANCE METHOD REFERENCES
    // ========================================
    
    // Reference to instance method of a particular object
    private String prefix = "Hello";
    private Function<String, String> boundConcatRef = prefix::concat;
    private Predicate<String> boundStartsWithRef = prefix::startsWith;
    private IntSupplier boundLengthRef = prefix::length;
    
    // With final field
    private final StringBuilder sb = new StringBuilder("test");
    private Consumer<String> appendRef = sb::append;
    private IntSupplier sbLengthRef = sb::length;
    
    // ========================================
    // 3. UNBOUND INSTANCE METHOD REFERENCES  
    // ========================================
    
    // Type::instanceMethod - first arg becomes receiver
    private Function<String, String> trimRef = String::trim;
    private Function<String, String> toLowerRef = String::toLowerCase;
    private Function<String, Integer> lengthRef = String::length;
    private Predicate<String> isEmptyRef = String::isEmpty;
    
    // With two params (receiver + arg)
    private BiFunction<String, String, Boolean> containsRef = String::contains;
    private BiPredicate<String, String> startsWithRef = String::startsWith;
    private Comparator<String> compareToRef = String::compareTo;
    private Comparator<String> ignoreCaseRef = String::compareToIgnoreCase;
    
    // ========================================
    // 4. CONSTRUCTOR REFERENCES
    // ========================================
    
    // Basic constructor reference
    private Supplier<ArrayList<String>> arrayListRef = ArrayList::new;
    private Supplier<HashMap<String, Integer>> hashMapRef = HashMap::new;
    private Supplier<StringBuilder> sbCreatorRef = StringBuilder::new;
    private Supplier<Object> objectCreatorRef = Object::new;
    
    // Constructor with parameters
    private Function<String, StringBuilder> sbFromStringRef = StringBuilder::new;
    private Function<Integer, ArrayList<String>> arrayListWithCapacityRef = ArrayList::new;
    private IntFunction<StringBuilder> sbWithCapacityRef = StringBuilder::new;
    
    // ========================================
    // 5. ARRAY CONSTRUCTOR REFERENCES
    // ========================================
    
    // Primitive array constructors
    private IntFunction<int[]> intArrayRef = int[]::new;
    private IntFunction<long[]> longArrayRef = long[]::new;
    private IntFunction<double[]> doubleArrayRef = double[]::new;
    private IntFunction<boolean[]> boolArrayRef = boolean[]::new;
    private IntFunction<byte[]> byteArrayRef = byte[]::new;
    private IntFunction<char[]> charArrayRef = char[]::new;
    private IntFunction<short[]> shortArrayRef = short[]::new;
    private IntFunction<float[]> floatArrayRef = float[]::new;
    private Session checkSession = ((Supplier<Session>) Session::new).get();
    private Supplier<Session> checkSession2 = Session.Inner::checkSession2;
    private Object checkSession3 = new Session().new Inner()::checkSession2;
    private static Supplier<Session> refSomething = new Session()::checkSession;

    // Object array constructors
    private IntFunction<String[]> stringArrayRef = String[]::new;
    private IntFunction<Integer[]> integerArrayRef = Integer[]::new;
    private IntFunction<Object[]> objectArrayRef = Object[]::new;
    
    // Multi-dimensional array constructors
    private IntFunction<int[][]> int2DArrayRef = int[][]::new;
    private IntFunction<String[][]> string2DArrayRef = String[][]::new;
    private IntFunction<int[][][]> int3DArrayRef = int[][][]::new;
    
    // ========================================
    // 6. this:: REFERENCES
    // ========================================
    
    private Function<String, String> thisProcessRef = this::processString;
    private Consumer<String> thisConsumeRef = this::consumeString;
    private Supplier<Integer> thisSupplyRef = this::supplyValue;
    private Predicate<String> thisCheckRef = this::checkString;
    
    private String processString(String s) { return s.toUpperCase(); }
    private void consumeString(String s) { System.out.println(s); }
    private int supplyValue() { return 42; }
    private boolean checkString(String s) { return s != null && !s.isEmpty(); }
    
    // ========================================
    // 7. GENERIC METHOD REFERENCES
    // ========================================
    
    // Generic static method with explicit type arguments
    private Supplier<List<String>> emptyListRef = Collections::<String>emptyList;
    private Supplier<Set<Integer>> emptySetRef = Collections::<Integer>emptySet;
    private Supplier<Map<String, Object>> emptyMapRef = Collections::<String, Object>emptyMap;
    
    // Generic method with type argument
    private Function<Object, String> toStringRef = Objects::<String>toString;
    
    // ========================================
    // 8. NESTED/QUALIFIED TYPE REFERENCES
    // ========================================
    
    // Inner class/interface references
    private Function<Map.Entry<String, Integer>, String> entryKeyRef = Map.Entry::getKey;
    private Function<Map.Entry<String, Integer>, Integer> entryValueRef = Map.Entry::getValue;
    private Comparator<Map.Entry<String, Integer>> entryComparatorRef = Map.Entry::comparingByKey;
    
    // ========================================
    // 9. COMPLEX EXPRESSIONS WITH METHOD REFS
    // ========================================
    
    // Method reference as argument in method invocation
    private List<String> sortedList = List.of("b", "a", "c").stream()
        .sorted(String::compareTo)
        .collect(Collectors.toList());
    
    // Multiple method references in one expression
    private Map<Integer, List<String>> groupedByLength = List.of("a", "bb", "ccc").stream()
        .collect(Collectors.groupingBy(String::length));
    
    // Method reference with toArray
    private String[] strArray = List.of("a", "b").stream()
        .toArray(String[]::new);


    static class grandParent {
        String greet() { return "P"; }
        <U> U id(U u) { return u; }
    }

    static class Parent extends grandParent {
        String greet() { return "P"; }
        <U> U id(U u) { return u; }
    }

    static class Child extends Parent {
        class Inner {
            Supplier<String> qSuperRef = Child.super::greet;
            Function<String, String> qSuperGenericRef = Child.super::<String>id;
        }
    }

    static class Type1 {
        static class Type2 {
            // Static method → STATIC method reference
            static String staticMethod() { return "static"; }
            
            // Instance method → UNBOUND method reference
            String instanceMethod() { return "instance"; }
        }
    }

    // STATIC: Type1.Type2::staticMethod
    Supplier<String> staticRef = Type1.Type2::staticMethod;

    // UNBOUND: Type1.Type2::instanceMethod (first arg becomes receiver)
    Function<Type1.Type2, String> unboundRef = Type1.Type2::instanceMethod;

    // Example: Outer.Middle.super::method
    static class Outer {
        static class MiddleParent {
            String method() { return "MiddleParent"; }
        }
        
        class Middle extends MiddleParent {
            class DeepInner {
                // Qualified super reference: Outer.Middle.super::method
                Supplier<String> refTstr = Outer.Middle.super::method;
            }
        }
    }
    
    // ========================================
    // 10. ENUM CONSTANT WITH METHOD REFERENCES
    // ========================================
    
    enum Operation {
        ADD(Integer::sum),
        SUBTRACT((a, b) -> a - b),  // lambda for comparison
        MULTIPLY(Math::multiplyExact),
        MAX(Integer::max),
        MIN(Integer::min);
        
        private final IntBinaryOperator operator;
        Operation(IntBinaryOperator operator) {
            this.operator = operator;
        }
        
        int apply(int a, int b) { return operator.applyAsInt(a, b); }
    }
    
    // Enum constant method references in field
    private IntBinaryOperator addOpRef = Integer::sum;
    private IntBinaryOperator multiplyOpRef = Math::multiplyExact;
}

/**
 * Tests super:: method references
 */
class MethodRefParent {
    protected String greet() { return "Hello from parent"; }
    protected String greetWith(String name) { return "Hello, " + name; }
    protected int compute(int x, int y) { return x + y; }
}

class MethodRefChild extends MethodRefParent {
    // super:: method reference to parent's method
    private Supplier<String> superGreetRef = super::greet;
    private Function<String, String> superGreetWithRef = super::greetWith;
    private IntBinaryOperator superComputeRef = super::compute;
    
    // Override and use super::
    @Override
    protected String greet() {
        return "Hello from child";
    }
    
    // this:: vs super::
    private Supplier<String> thisGreetRef = this::greet;   // calls child's greet
    private Supplier<String> parentGreetRef = super::greet; // calls parent's greet
}

/**
 * Generic class with method references
 */
class GenericMethodRefContainer<T> {
    private Function<T, String> toStringRef = Object::toString;
    private BiPredicate<T, Object> equalsRef = Object::equals;
    private Function<T, Integer> hashCodeRef = Object::hashCode;
    
    // Constructor reference for generic type
    private Supplier<ArrayList<T>> listSupplierRef = ArrayList::new;
    private Supplier<HashSet<T>> setSupplierRef = HashSet::new;
    
    // Method reference using type parameter
    private Function<List<T>, Integer> sizeRef = List::size;
    private Predicate<Collection<T>> isEmptyRef = Collection::isEmpty;

    // Wildcard in method reference type argument
    Function<?, String> wildcardRef = SomeClass::<T>method;

    // Bounded in method reference type argument  
    Function<Number, String> boundedRef = SomeClass::<? extends Number>method;

    // Nested parameterized in method reference type argument
    Supplier<List<String>> nestedRef = Factory::<List<String>>create;
    }

/**
 * Bounded generic method references
 */
class BoundedGenericMethodRef<T extends Comparable<T>> {
    // Method reference with bounded type
    private Comparator<T> naturalOrderRef = Comparable::compareTo;
    private BiPredicate<T, T> equalsRef = Object::equals;
}

/**
 * Wildcard type method references
 */
class WildcardMethodRef {
    // Unbounded wildcard
    private Function<List<?>, Integer> sizeRef = List::size;
    private Predicate<Collection<?>> isEmptyRef = Collection::isEmpty;
    
    // Upper bounded wildcard
    private Function<List<? extends Number>, Integer> numListSizeRef = List::size;
    
    // Lower bounded wildcard
    private Consumer<List<? super String>> clearRef = List::clear;
}

/**
 * Static inner class method references
 */
class OuterForMethodRef {
    
    static class StaticInner {
        static String process(String s) { return s.toUpperCase(); }
        String instanceProcess(String s) { return s.toLowerCase(); }
    }
    
    // Reference to static method of static inner class
    private Function<String, String> staticInnerRef = OuterForMethodRef.StaticInner::process;
    
    // Constructor reference for static inner class
    private Supplier<StaticInner> staticInnerCreatorRef = StaticInner::new;
    
    class Inner {
        String process(String s) { return s.trim(); }
    }
}

/**
 * Interface default method references (Java 8+)
 */
interface MethodRefInterface {
    default String process(String s) { return s.trim(); }
    static String staticProcess(String s) { return s.toUpperCase(); }
}

class MethodRefInterfaceImpl implements MethodRefInterface {
    // Reference to static method of interface
    private Function<String, String> interfaceStaticRef = MethodRefInterface::staticProcess;
}

/**
 * Varargs method references
 */
class VarargsMethodRef {
    private static String join(String... parts) {
        return String.join(",", parts);
    }
    
    // Note: Method reference to varargs method
    private Function<String[], String> joinRef = VarargsMethodRef::join;
    
    // String.format is varargs
    private BiFunction<String, Object[], String> formatRef = String::format;
}

/**
 * Overloaded method references
 */
class OverloadedMethodRef {
    private static void process(String s) { }
    private static void process(Integer i) { }
    private static void process(String s, Integer i) { }
    
    // Reference resolves based on functional interface type
    private Consumer<String> stringProcessRef = OverloadedMethodRef::process;
    private Consumer<Integer> intProcessRef = OverloadedMethodRef::process;
    private BiConsumer<String, Integer> biProcessRef = OverloadedMethodRef::process;
}

/**
 * Primitive specialized functional interfaces
 */
class PrimitiveMethodRef {
    // IntFunction/LongFunction/DoubleFunction
    private IntFunction<String> intToStringRef = Integer::toString;
    private LongFunction<String> longToStringRef = Long::toString;
    private DoubleFunction<String> doubleToStringRef = Double::toString;
    
    // ToIntFunction/ToLongFunction/ToDoubleFunction  
    private ToIntFunction<String> parseIntRef = Integer::parseInt;
    private ToLongFunction<String> parseLongRef = Long::parseLong;
    private ToDoubleFunction<String> parseDoubleRef = Double::parseDouble;
    
    // IntUnaryOperator/LongUnaryOperator/DoubleUnaryOperator
    private IntUnaryOperator negateIntRef = Math::negateExact;
    private LongUnaryOperator negateLongRef = Math::negateExact;
    private DoubleUnaryOperator absDoubleRef = Math::abs;
    
    // IntBinaryOperator/LongBinaryOperator/DoubleBinaryOperator
    private IntBinaryOperator addIntRef = Integer::sum;
    private LongBinaryOperator addLongRef = Long::sum;
    private DoubleBinaryOperator addDoubleRef = Double::sum;
    
    // IntPredicate/LongPredicate/DoublePredicate
    private IntPredicate isPositiveIntRef = (i) -> i > 0;  // lambda - no good method ref
    private DoublePredicate isNaNRef = Double::isNaN;
    private DoublePredicate isInfiniteRef = Double::isInfinite;
}

/**
 * Qualified Outer.this::method (from inner class)
 */
class OuterThisMethodRef {
    String outerMethod() { return "outer"; }
    
    class Inner {
        String innerMethod() { return "inner"; }
        
        // Qualified outer this method reference
        private Supplier<String> outerRef = OuterThisMethodRef.this::outerMethod;
        
        // Multi-level qualified
        class Inner2 {
            private Supplier<String> outerRef = OuterThisMethodRef.this::outerMethod;
            private Supplier<String> inner1Ref = Inner.this::innerMethod;
        }
    }
}

/**
 * Method Reference on Field Access
 */
class FieldAccessMethodRef {
    private final HelperClass helper = new HelperClass();
    
    // Method reference on field
    private Function<String, String> fieldMethodRef = helper::process;
    
    // Method reference on this.field
    private Function<String, String> thisFieldMethodRef = this.helper::process;
}

class HelperClass {
    String process(String s) { return s; }
}

/**
 * Method Reference on Array Element (rare but valid)
 */
class ArrayElementMethodRef {
    private final HelperClass[] helpers = { new HelperClass() };
    
    // Method reference on array element
    private Function<String, String> arrayElemRef = helpers[0]::process;
}

/**
 * Method Reference on Method Result (rare but valid)
 */
class MethodResultMethodRef {
    private HelperClass getHelper() { return new HelperClass(); }
    
    // Method reference on method result - captures result at field init time
    private Function<String, String> methodResultRef = getHelper()::process;
}

/**
 * Method Reference on Parenthesized Expression
 */
class ParenthesizedMethodRef {
    private final HelperClass helper1 = new HelperClass();
    private final HelperClass helper2 = new HelperClass();
    
    // Parenthesized expression
    private Function<String, String> parenRef = (helper1)::process;
    
    // Ternary as receiver (must be parenthesized)
    private Function<String, String> ternaryRef = (true ? helper1 : helper2)::process;
}

/**
 * Method Reference on Cast Expression
 */
class CastMethodRef {
    private final Object obj = new HelperClass();
    
    // Cast as receiver
    private Function<String, String> castRef = ((HelperClass) obj)::process;
}

/**
 * Method Reference on new Expression (rare)
 */
class NewExprMethodRef {
    // Method reference on newly created object
    // Note: Creates object at field init time, captures that instance
    private Function<String, String> newExprRef = new HelperClass()::process;
    private Supplier<Integer> newExprRef2 = new StringBuilder("test")::length;
}

/**
 * Fully Qualified Type Static Method Reference
 */
class FullyQualifiedMethodRef {
    // Fully qualified package path
    private Function<String, Integer> fqParseInt = java.lang.Integer::parseInt;
    private DoubleSupplier fqRandom = java.lang.Math::random;
    private Supplier<List<String>> fqEmptyList = java.util.Collections::emptyList;
}

/**
 * Generic Array Constructor Reference
 */
class GenericArrayMethodRef<T> {
    // Generic array constructor patterns
    private IntFunction<List<String>[]> listArrayRef = List[]::new;
    private IntFunction<Map<String, Integer>[]> mapArrayRef = Map[]::new;
}

/**
 * Method Reference to getClass (special case)
 */
class GetClassMethodRef {
    // Reference to Object::getClass
    private Function<Object, Class<?>> getClassRef = Object::getClass;
}

/**
 * Method Reference in Ternary Branches
 */
class TernaryBranchMethodRef {
    private static final boolean FLAG = true;
    
    // Different method references in ternary branches
    private Function<String, String> ternaryMethodRef = 
        FLAG ? String::toUpperCase : String::toLowerCase;
    
    private IntBinaryOperator ternaryOpRef = 
        FLAG ? Integer::sum : Integer::max;
}

/**
 * Method Reference in Binary Expression context
 */
class BinaryExprMethodRef {
    // Method refs as arguments in expression that's part of binary
    private String result = List.of("a", "b").stream()
        .map(String::toUpperCase)
        .collect(Collectors.joining()) + "suffix";
}

/**
 * Constructor Reference with explicit type parameter
 */
class GenericConstructorRef {
    // Constructor reference where type is inferred
    private Supplier<List<String>> listRef = ArrayList::new;
    private Supplier<Map<Integer, String>> mapRef = HashMap::new;
    
    // With explicit type parameter on constructor ref
    private Supplier<List<String>> explicitListRef = ArrayList<String>::new;
}

/**
 * Inner Class Constructor Reference
 */
class OuterForInnerCtorRef {
    class Inner {
        Inner(String s) {}
    }
    
    // Inner class constructor reference - requires enclosing instance
    private Function<String, Inner> innerCtorRef = Inner::new;
}
