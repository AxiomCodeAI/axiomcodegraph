package com.inventory.auth.examples18;

import java.util.List;

/**
 * Advanced test cases for Java 21+ Record Pattern extraction.
 * Tests: unary expressions, lambdas, OR patterns, wrapper types, 
 * inner class records, enum components, complex guards, and more.
 * 
 * NOTE: Method body expressions are NOT extracted yet - only field initializers.
 * Tests here focus on field-level expressions.
 */
public class RecordPatternAdvanced {

    // ========================================
    // Record Definitions (reused from examples17)
    // ========================================
    
    record Point(int x, int y) {}
    record Person(String name, int age) {}
    record Address(String street, String city, String zip) {}
    record Contact(String email, String phone) {}
    record Customer(String name, Address address, Contact contact) {}

    // ==================== RECORD PATTERN IN UNARY EXPRESSION ====================

    Object unaryPatternObj = new Point(1, 1);

    // Negated pattern check
    boolean notPoint = !(unaryPatternObj instanceof Point(int x, int y));

    // Double negation
    boolean doubleNot = !!(unaryPatternObj instanceof Point(int x, int y) && x > 0);

    // ==================== RECORD PATTERN IN LAMBDA (NOT IMPLEMENTED YET) ====================
    // Lambda extraction not implemented - skipping these tests
    // java.util.function.Predicate<Object> patternPredicate = 
    //     obj -> obj instanceof Point(int x, int y) && x > 0;

    // ==================== RECORD PATTERN WITH || (OR) ====================

    Object orPatternObj = new Point(1, 2);

    // Pattern result combined with ||
    boolean orPattern = orPatternObj instanceof Point(int x, int y) && x > 0 
        || orPatternObj instanceof Person(String name, int age);

    // Multiple OR conditions with different patterns
    Object orPatternObj2 = new Person("Alice", 30);
    boolean multiOr = orPatternObj instanceof Point(int px, int py)
        || orPatternObj2 instanceof Person(String pname, int page)
        || orPatternObj instanceof Customer(String cname, Address addr, Contact c);

    // ==================== INNER CLASS RECORD ====================

    static class OuterContainer {
        record InnerRecord(String value, int count) {}
        
        Object innerObj = new InnerRecord("test", 5);
        String innerPattern = innerObj instanceof InnerRecord(String v, int c)
            ? v + ":" + c
            : "not inner";
    }
    
    // Instance of outer container to test
    OuterContainer outerContainer = new OuterContainer();

    // ==================== RECORD PATTERN WITH WRAPPER TYPES ====================

    record Wrapper(Integer boxedInt, Double boxedDouble, Boolean boxedBool) {}
    Object wrapperObj = new Wrapper(42, 3.14, true);

    String wrapperPattern = wrapperObj instanceof Wrapper(Integer i, Double d, Boolean b)
        ? "boxed: " + i + ", " + d + ", " + b
        : "not wrapper";

    // ==================== RECORD WITH OBJECT/INTERFACE COMPONENT ====================

    record GenericComponents(Object any, Comparable<?> comp, java.io.Serializable ser) {}
    Object genericCompObj = new GenericComponents("str", 42, "serializable");

    // Pattern extracts as declared types
    String genericCompPattern = genericCompObj instanceof GenericComponents(Object a, Comparable<?> c, java.io.Serializable s)
        ? "generic components"
        : "not generic";

    // ==================== RECORD PATTERN WITH ENUM COMPONENT ====================

    enum Status { ACTIVE, INACTIVE }
    record StatusHolder(Status status, String message) {}
    Object enumComponentObj = new StatusHolder(Status.ACTIVE, "running");

    String enumComponentPattern = enumComponentObj instanceof StatusHolder(Status s, String msg)
        ? s.name() + ": " + msg
        : "not status holder";

    // ==================== GUARDED PATTERN WITH COMPLEX GUARD ====================

    Object complexGuardObj = new Customer("Test", new Address("St", "Boston", "02101"), new Contact("e@x.com", "555"));

    // Guard with method calls on extracted variables
    String complexGuard = complexGuardObj instanceof Customer(String name, Address(String street, String city, String zip), Contact c)
            && city.toLowerCase().startsWith("b")
            && zip.matches("\\d{5}")
        ? "valid Boston customer"
        : "invalid";

    // ==================== PATTERN VARIABLE SCOPE EDGE CASES ====================

    // Variable only in scope when pattern matches
    Object scopeObj = new Point(1, 2);
    String scopeTest = scopeObj instanceof Point(int x, int y) && x > 0
        ? "x=" + x + ", y=" + y
        : "no match";

    // Pattern in && - both sides must match for variables to be in scope
    Object scopeObj2 = new Person("Test", 30);
    boolean scopeAnd = scopeObj instanceof Point(int px, int py) 
        && scopeObj2 instanceof Person(String name, int age)
        && px + age > 0;

    // ==================== DEEPLY NESTED WITH MULTIPLE LEVELS ====================

    record Level1(Level2 l2, String name) {}
    record Level2(Level3 l3, int count) {}
    record Level3(String value) {}
    
    Object deepObj = new Level1(new Level2(new Level3("deep"), 10), "top");
    
    String deepPattern = deepObj instanceof Level1(Level2(Level3(String innerVal), int cnt), String topName)
        ? "deep: " + innerVal + ", " + cnt + ", " + topName
        : "not deep";

    // ==================== ARRAY TYPE IN RECORD PATTERN ====================

    record WithArrays(int[] ints, String[] strings, Object[] objs) {}
    Object arrayObj = new WithArrays(new int[]{1,2,3}, new String[]{"a","b"}, new Object[]{});

    String arrayPattern = arrayObj instanceof WithArrays(int[] is, String[] ss, Object[] os)
        ? "arrays: " + is.length + ", " + ss.length + ", " + os.length
        : "not arrays";

    // ==================== PARENTHESIZED PATTERN EXPRESSIONS ====================

    Object parenObj = new Point(5, 10);
    
    // Extra parentheses around instanceof
    boolean parenPattern1 = (parenObj instanceof Point(int x, int y));
    
    // Parentheses in complex expression
    boolean parenPattern2 = ((parenObj instanceof Point(int x, int y)) && (x > 0));
    
    // Parenthesized ternary with pattern
    String parenPattern3 = (parenObj instanceof Point(int x, int y) ? x + y : 0) + " total";

    // ==================== CAST AND PATTERN COMBINATION ====================

    Object castObj = new Point(3, 4);
    
    // Pattern check then cast
    String castPattern = castObj instanceof Point(int x, int y)
        ? "point sum: " + ((Point) castObj).x() + ((Point) castObj).y()
        : "not point";

    // ==================== RECORD WITH GENERIC TYPE PARAMETERS ====================

    record Box<T>(T value) {}
    record Pair<A, B>(A first, B second) {}
    
    Object boxObj = new Box<>("hello");
    Object pairObj = new Pair<>(1, "one");
    
    // Note: Generic type is erased at runtime, but we extract the declared pattern types
    String boxPattern = boxObj instanceof Box(Object v) ? "box: " + v : "not box";
    String pairPattern = pairObj instanceof Pair<Object, Object>(Object f, Object s) ? f + ":" + s : "not pair";

    // ==================== SWITCH WITH MIXED PATTERNS (field version) ====================

    Object switchMixedObj = new Point(1, 2);
    
    String switchMixed = switch (switchMixedObj) {
        case String s -> "string: " + s;
        case Integer i -> "int: " + i;
        case Point(int x, int y) -> "point: " + x + "," + y;
        case Person(String n, int a) -> "person: " + n;
        case null -> "null";
        default -> "other";
    };

    // ==================== SWITCH WITH GUARDS ====================

    Object guardedSwitchObj = new Point(0, 0);
    
    String guardedSwitch = switch (guardedSwitchObj) {
        case Point(int x, int y) when x == 0 && y == 0 -> "origin";
        case Point(int x, int y) when x == y -> "diagonal";
        case Point(int x, int y) when x > y -> "above diagonal";
        case Point(int x, int y) -> "below diagonal";
        case null, default -> "other";
    };

    // ==================== MULTIPLE PATTERNS SAME VARIABLE NAMES ====================

    Object multi1 = new Point(1, 2);
    Object multi2 = new Person("Test", 25);
    
    // Same variable names 'x' in different branches - no conflict
    String multiVars = switch (multi1) {
        case Point(int x, int y) -> "point x: " + x;
        case Person(String x, int y) -> "person x: " + x;  // x is String here
        default -> "other";
    };
}
