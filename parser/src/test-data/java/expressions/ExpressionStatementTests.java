package com.inventory.auth.examples22;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Comprehensive test file for expression statement extraction.
 * Tests all types of expression statements that can appear in method bodies.
 * 
 * Expression statements are standalone expressions used as statements:
 * - Assignment expressions (simple and compound)
 * - Method invocations
 * - Object creation
 * - Pre/post increment/decrement
 */
public class ExpressionStatementTests {
    
    // Fields for testing
    private int count = 0;
    private String name = "default";
    private List<String> items = new ArrayList<>();
    private int[] numbers = new int[10];
    private int x = 0;
    private static int staticCount = 0;
    
    // ========================================
    // STATIC INITIALIZER BLOCK
    // ========================================
    static {
        staticCount = 100;  // ASSIGNMENT_EXPRESSION in static initializer
        staticCount++;      // UNARY_EXPRESSION in static initializer
        System.out.println("Static initializer");  // METHOD_INVOCATION in static initializer
        
        // Lambda expression in static initializer
        java.util.function.Consumer<String> printer = s -> System.out.println(s);
        
        // Anonymous class in static initializer
        new Runnable() {
            @Override
            public void run() {
                System.out.println("Anonymous in static init");
            }
        };
    }
    
    // ========================================
    // INSTANCE INITIALIZER BLOCK
    // ========================================
    {
        count = 50;  // ASSIGNMENT_EXPRESSION in instance initializer
        count++;     // UNARY_EXPRESSION in instance initializer
        doSomething();  // METHOD_INVOCATION in instance initializer
        
        // Object creation in instance initializer
        new ArrayList<String>();
        
        // Ternary/conditional in instance initializer
        count = count > 0 ? count : 1;
    }
    
    // ========================================
    // ASSIGNMENT EXPRESSIONS (=)
    // ========================================
    
    /** Simple field assignment: this.field = value */
    public void testSimpleFieldAssignment(String newName) {
        this.name = newName;  // ASSIGNMENT_EXPRESSION with FIELD_ACCESS target
        this.x = (int) (Math.random() * 10);
    }
    
    /** Field assignment without this qualifier */
    public void testFieldAssignmentNoThis(int value) {
        count = value;  // ASSIGNMENT_EXPRESSION with IDENTIFIER_REFERENCE target
    }
    
    /** Chain assignment: a = b = c */
    public void testChainAssignment(int value) {
        int a = 0;
        int b = 0;
        a = b = value;  // Nested ASSIGNMENT_EXPRESSION
    }
    
    /** Assignment with expression on right side */
    public void testAssignmentWithExpression(int a, int b) {
        this.count = a + b;  // ASSIGNMENT_EXPRESSION with BINARY_EXPRESSION value
    }
    
    /** Assignment with method call on right side */
    public void testAssignmentWithMethodCall() {
        this.name = getName();  // ASSIGNMENT_EXPRESSION with METHOD_INVOCATION value
    }
    
    /** Assignment with ternary on right side */
    public void testAssignmentWithTernary(boolean flag, String a, String b) {
        this.name = flag ? a : b;  // ASSIGNMENT_EXPRESSION with TERNARY_EXPRESSION value
    }
    
    /** Assignment to array element */
    public void testArrayAssignment(int index, int value) {
        numbers[index] = value;  // ASSIGNMENT_EXPRESSION with ARRAY_ACCESS target
    }
    
    /** Assignment with cast */
    public void testAssignmentWithCast(Object obj) {
        this.name = (String) obj;  // ASSIGNMENT_EXPRESSION with CAST_EXPRESSION value
    }
    
    /** Assignment with object creation */
    public void testAssignmentWithObjectCreation() {
        this.items = new ArrayList<>();  // ASSIGNMENT_EXPRESSION with OBJECT_CREATION value
    }
    
    // ========================================
    // COMPOUND ASSIGNMENT EXPRESSIONS (+=, -=, etc.)
    // ========================================
    
    /** Compound addition assignment */
    public void testCompoundAddition(int value) {
        count += value;  // COMPOUND_ASSIGNMENT (+=)
    }
    
    /** Compound subtraction assignment */
    public void testCompoundSubtraction(int value) {
        count -= value;  // COMPOUND_ASSIGNMENT (-=)
    }
    
    /** Compound multiplication assignment */
    public void testCompoundMultiplication(int value) {
        count *= value;  // COMPOUND_ASSIGNMENT (*=)
    }
    
    /** Compound division assignment */
    public void testCompoundDivision(int value) {
        count /= value;  // COMPOUND_ASSIGNMENT (/=)
    }
    
    /** Compound modulo assignment */
    public void testCompoundModulo(int value) {
        count %= value;  // COMPOUND_ASSIGNMENT (%=)
    }
    
    /** Compound bitwise AND assignment */
    public void testCompoundBitwiseAnd(int value) {
        count &= value;  // COMPOUND_ASSIGNMENT (&=)
    }
    
    /** Compound bitwise OR assignment */
    public void testCompoundBitwiseOr(int value) {
        count |= value;  // COMPOUND_ASSIGNMENT (|=)
    }
    
    /** Compound bitwise XOR assignment */
    public void testCompoundBitwiseXor(int value) {
        count ^= value;  // COMPOUND_ASSIGNMENT (^=)
    }
    
    /** Compound left shift assignment */
    public void testCompoundLeftShift(int value) {
        count <<= value;  // COMPOUND_ASSIGNMENT (<<=)
    }
    
    /** Compound right shift assignment */
    public void testCompoundRightShift(int value) {
        count >>= value;  // COMPOUND_ASSIGNMENT (>>=)
    }
    
    /** Compound unsigned right shift assignment */
    public void testCompoundUnsignedRightShift(int value) {
        count >>>= value;  // COMPOUND_ASSIGNMENT (>>>=)
    }
    
    /** String concatenation assignment */
    public void testStringConcatAssignment(String suffix) {
        name += suffix;  // COMPOUND_ASSIGNMENT (+=) on String
    }
    
    // ========================================
    // METHOD INVOCATION STATEMENTS
    // ========================================
    
    /** Simple method call statement */
    public void testSimpleMethodCall() {
        doSomething();  // METHOD_INVOCATION (no receiver)
    }
    
    /** Method call on this */
    public void testMethodCallOnThis() {
        this.doSomething();  // METHOD_INVOCATION with THIS_REFERENCE receiver
    }
    
    /** Static method call */
    public void testStaticMethodCall() {
        System.out.println("test");  // METHOD_INVOCATION with FIELD_ACCESS receiver
    }
    
    /** Chained method calls */
    public void testChainedMethodCalls() {
        items.clear();  // METHOD_INVOCATION on field
        items.add("item");  // METHOD_INVOCATION with argument
    }
    
    /** Method call with multiple arguments */
    public void testMethodWithMultipleArgs(String a, String b, String c) {
        processItems(a, b, c);  // METHOD_INVOCATION with 3 IDENTIFIER_REFERENCE args
    }
    
    /** Method call with expression arguments */
    public void testMethodWithExpressionArgs(int a, int b) {
        processNumber(a + b);  // METHOD_INVOCATION with BINARY_EXPRESSION arg
    }
    
    /** Method call with lambda argument */
    public void testMethodWithLambdaArg() {
        items.forEach(item -> System.out.println(item));  // METHOD_INVOCATION with LAMBDA_EXPRESSION arg
    }
    
    /** Method call with method reference argument */
    public void testMethodWithMethodRefArg() {
        items.forEach(System.out::println);  // METHOD_INVOCATION with METHOD_REFERENCE arg

    }
    
    // ========================================
    // INCREMENT/DECREMENT STATEMENTS
    // ========================================
    
    /** Pre-increment statement */
    public void testPreIncrement() {
        ++count;  // UNARY_EXPRESSION (PREFIX ++)
    }
    
    /** Post-increment statement */
    public void testPostIncrement() {
        count++;  // UNARY_EXPRESSION (POSTFIX ++)
    }
    
    /** Pre-decrement statement */
    public void testPreDecrement() {
        --count;  // UNARY_EXPRESSION (PREFIX --)
    }
    
    /** Post-decrement statement */
    public void testPostDecrement() {
        count--;  // UNARY_EXPRESSION (POSTFIX --)
    }
    
    /** Increment on array element */
    public void testArrayIncrement(int index) {
        numbers[index]++;  // UNARY_EXPRESSION on ARRAY_ACCESS
    }
    
    /** Increment on field access */
    public void testFieldAccessIncrement() {
        this.count++;  // UNARY_EXPRESSION on FIELD_ACCESS
    }
    
    // ========================================
    // OBJECT CREATION STATEMENTS
    // ========================================
    
    /** Object creation as statement (result discarded) */
    public void testObjectCreationStatement() {
        new ArrayList<String>();  // OBJECT_CREATION as statement
    }
    
    /** Object creation with arguments */
    public void testObjectCreationWithArgs() {
        new StringBuilder("initial");  // OBJECT_CREATION with LITERAL arg
    }
    
    /** Anonymous class creation as statement */
    public void testAnonymousClassStatement() {
        new Runnable() {  // ANONYMOUS_CLASS_CREATION as statement
            @Override
            public void run() {
                System.out.println("running");
            }
        };
    }
    
    // ========================================
    // CONSTRUCTOR INVOCATION STATEMENTS
    // ========================================
    
    /** Constructor with this() call */
    public ExpressionStatementTests() {
        this(0);  // CONSTRUCTOR_INVOCATION (this)
    }
    
    /** Constructor with super() and expression */
    public ExpressionStatementTests(int initialCount) {
        super();  // CONSTRUCTOR_INVOCATION (super)
        this.count = initialCount;
        this.count++;
        new Object() {
            @Override   
            public String toString() {
                return "anonymous";
            }
        };
    }
    
    // ========================================
    // MIXED/COMPLEX EXPRESSION STATEMENTS
    // ========================================
    
    /** Multiple expression statements in sequence */
    public void testMultipleStatements(int a, int b) {
        count = a;
        count += b;
        count++;
        doSomething();
    }
    
    /** Field access chain assignment */
    public void testFieldAccessChain() {
        this.x = this.count;  // Both sides are FIELD_ACCESS
    }
    
    /** Expression statement with instanceof and cast */
    public void testInstanceofAndCast(Object obj) {
        if (obj instanceof String) {
            name = (String) obj;
        }
    }
    
    // ========================================
    // HELPER METHODS
    // ========================================
    
    private void doSomething() {
        // Empty helper
    }
    
    private String getName() {
        return this.name;
    }
    
    private void processItems(String... items) {
        // Varargs helper
    }
    
    private void processNumber(int value) {
        // Helper for number processing
    }

    private void doingSomething() {
        this.x = ((java.util.function.IntUnaryOperator) n -> n * n).applyAsInt(this.x);
    }
}
